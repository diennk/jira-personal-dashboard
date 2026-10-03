'use client'

import { useRef, useState } from 'react'
import { ActionIcon, Anchor, Badge, Box, Button, Group, Paper, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { ddmm, hrs, isWeekend, sum, ymd } from '../lib/format'
import { Empty, StatusBadge } from './IssueTable'
import { isMissing, MissingBadge, PeriodIssues, stats } from './PerfList'

// Cell shade = logged hours (one hue, light -> dark).
const LEVELS = [
  [0, 'Không log'],
  [1, '< 4h'],
  [2, '4–8h'],
  [3, '≥ 8h'],
]
const level = (s) => (!s ? 0 : s < 4 * 3600 ? 1 : s < 8 * 3600 ? 2 : 3)
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function Backlog({ tasks, own, browse, onDragStart, onOpen, onCreate }) {
  if (!own)
    return (
      <Paper withBorder p="sm" bg="gray.0">
        <Text fw={600} size="sm">
          Chưa logwork
        </Text>
        <Text size="xs" c="dimmed">
          Chỉ log work được cho chính bạn. Bỏ chọn member để dùng.
        </Text>
      </Paper>
    )
  return (
    <Paper withBorder p="xs" bg="gray.0">
      <Group justify="space-between" mb={4}>
        <Group gap={6}>
          <Text fw={600} size="sm">
            Chưa logwork
          </Text>
          <Badge size="sm" variant="light" color="gray">
            {tasks.length}
          </Badge>
        </Group>
        <Button size="compact-xs" variant="default" onClick={onCreate} title="Tạo sub-task mới (chưa log work)">
          + Tạo task
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mb="xs">
        Kéo task vào ô ngày để log work.
      </Text>
      <ScrollArea.Autosize mah={640}>
        <Stack gap={6}>
          {tasks.length ? (
            tasks.map(({ key, fields: f }) => {
              const est = f.timeestimate ?? f.timeoriginalestimate ?? 0
              return (
                <Paper
                  key={key}
                  withBorder
                  p={8}
                  className="todo"
                  draggable
                  onDragStart={(e) => onDragStart(e, { issue: key, est })}
                  onClick={(e) => !e.target.closest('a') && onOpen(key)}
                  title={`${key} ${f.summary} — kéo vào một ngày để log work, click để xem chi tiết`}
                >
                  <Group justify="space-between" gap={4} wrap="nowrap">
                    <Anchor href={browse(key)} target="_blank" rel="noopener" size="xs" draggable={false}>
                      {key}
                    </Anchor>
                    <Text size="xs" fw={600}>
                      {est ? hrs(est) : ''}
                    </Text>
                  </Group>
                  <Text size="xs" c="dark" my={4} style={{ overflowWrap: 'anywhere' }}>
                    {f.summary}
                  </Text>
                  <StatusBadge status={f.status} size="xs" />
                </Paper>
              )
            })
          ) : (
            <Empty>Task nào cũng đã có log.</Empty>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Paper>
  )
}

// Month grid. Callbacks: onMonth(-1|0|1), onSelect(day), onMove(chip, day), onLog(task, day), onAdd(day),
// onCreate(), onOpen(issueKey, worklogId?).
export default function PerfCalendar({ days, month, selected, backlog, own, browse, onMonth, onSelect, onMove, onLog, onAdd, onCreate, onOpen }) {
  const dragged = useRef(null) // { issue, wl?, started?, secs? } (worklog chip) | { issue, est } (sidebar task)
  const [dropDay, setDropDay] = useState('')
  const m = month.getMonth()
  const today = ymd(Date.now())
  const rows = days.map(stats)
  const inMonth = rows.filter((r) => r.w.start.getMonth() === m)
  const sel = rows.find((r) => r.w.key === selected)

  const startDrag = (e, item) => {
    dragged.current = item
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.issue)
  }
  const endDrag = () => {
    dragged.current = null
    setDropDay('')
  }
  const drop = (e, day) => {
    const item = dragged.current
    if (!item) return
    e.preventDefault()
    endDrag()
    if (item.wl) onMove(item, day)
    else onLog(item, day)
  }

  const cell = (r) => {
    const tip = `${ddmm(r.w.start)}: logged ${hrs(r.logged)} · ${r.logs.length} issue · hoàn thành ${r.w.done.length} · nhận mới ${r.w.created}`
    const missing = isMissing(r)
    const cls = [
      'day',
      `lv${level(r.logged)}`,
      isWeekend(r.w.start) && 'weekend',
      missing && 'missing',
      r.w.start.getMonth() !== m && 'out',
      r.w.key > today && 'future',
      r.w.key === today && 'today',
      r === sel && 'sel',
      dropDay === r.w.key && 'drop',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <div
        key={r.w.key}
        className={cls}
        title={tip}
        onClick={() => onSelect(r.w.key)}
        onDragOver={(e) => {
          if (!dragged.current) return
          e.preventDefault()
          if (dropDay !== r.w.key) setDropDay(r.w.key)
        }}
        onDrop={(e) => drop(e, r.w.key)}
      >
        <div className="dhead">
          <UnstyledButton className="dn" aria-pressed={r === sel} aria-label={tip}>
            {r.w.start.getDate()}
          </UnstyledButton>
          <span className="dh">{r.logged ? hrs(r.logged) : ''}</span>
        </div>
        <div className="chips">
          {r.logs.flatMap((e) =>
            e.worklogs.map((w) => (
              <div
                key={w.id}
                className="chip"
                draggable
                onDragStart={(ev) => startDrag(ev, { issue: e.issue.key, wl: w.id, started: w.started, secs: w.timeSpentSeconds })}
                onDragEnd={endDrag}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onOpen(e.issue.key, w.id)
                }}
                title={`${e.issue.key} ${e.issue.fields.summary} · ${hrs(w.timeSpentSeconds)} — kéo sang ngày khác để đổi ngày log, click để xem / sửa`}
              >
                <span className="cs">
                  {e.issue.key.split('-').pop()} {e.issue.fields.summary}
                </span>
                <span className="ch">{hrs(w.timeSpentSeconds)}</span>
              </div>
            )),
          )}
          {missing && <MissingBadge />}
        </div>
        <span className="dm">
          {r.w.done.length ? `✓${r.w.done.length}` : ''} {r.w.created ? `+${r.w.created}` : ''}
        </span>
        {own && (
          <Tooltip label={`Tạo task & log work ngày ${ddmm(r.w.start)}`} withArrow openDelay={400}>
            <ActionIcon
              className="add"
              size={20}
              variant="default"
              aria-label={`Tạo task và log work ngày ${ddmm(r.w.start)}`}
              onClick={(e) => {
                e.stopPropagation()
                onAdd(r.w.key)
              }}
            >
              +
            </ActionIcon>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <>
      <Group px="md" py="sm" gap="md" wrap="wrap">
        <Group gap="xs">
          <ActionIcon variant="default" onClick={() => onMonth(-1)} aria-label="Tháng trước">
            ‹
          </ActionIcon>
          <Text fw={600} w={130} ta="center">
            Tháng {m + 1}/{month.getFullYear()}
          </Text>
          <ActionIcon variant="default" onClick={() => onMonth(1)} aria-label="Tháng sau">
            ›
          </ActionIcon>
          <Button size="xs" variant="default" onClick={() => onMonth(0)}>
            Tháng này
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Logged {hrs(sum(inMonth, (r) => r.logged))} · Hoàn thành {sum(inMonth, (r) => r.w.done.length)} · Nhận mới{' '}
          {sum(inMonth, (r) => r.w.created)}
        </Text>
        <Group gap="sm" ml="auto" className="cal-legend">
          {LEVELS.map(([l, t]) => (
            <span key={l}>
              <i className={`lv${l}`} />
              {t}
            </span>
          ))}
          <span>
            <i className="missing" />
            Chưa có task / log
          </span>
          <span>
            <i className="weekend" />
            T7, CN
          </span>
          <span>✓ hoàn thành · + nhận mới</span>
        </Group>
      </Group>
      <Box className="cal-wrap" onDragEnd={endDrag}>
        <Backlog tasks={backlog} own={own} browse={browse} onDragStart={startDrag} onOpen={(k) => onOpen(k)} onCreate={onCreate} />
        <div className="cal">
          {DOW.map((d, k) => (
            <div key={d} className={`dow ${k > 4 ? 'weekend' : ''}`}>
              {d}
            </div>
          ))}
          {rows.map(cell)}
        </div>
      </Box>
      {sel && (
        <Box style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }} pt="sm">
          <Group gap="xs" px="md" pb="xs">
            <Text fw={600} size="sm">
              {sel.w.start.toLocaleDateString('vi-VN', { weekday: 'long' })}, {ddmm(sel.w.start)}
            </Text>
            <Text size="xs" c="dimmed">
              Logged {hrs(sel.logged)}
            </Text>
          </Group>
          <PeriodIssues r={sel} unit="ngày" browse={browse} />
        </Box>
      )}
    </>
  )
}
