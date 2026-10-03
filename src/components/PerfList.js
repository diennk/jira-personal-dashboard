'use client'

import { Fragment } from 'react'
import { Anchor, Badge, Box, Progress, Table, UnstyledButton } from '@mantine/core'
import { ddmm, hrs, isWeekend, sum, ymd } from '../lib/format'
import { Empty, StatusBadge } from './IssueTable'

// Per-period numbers: worklogs of the member, estimate / spent of tasks completed in the period.
export const stats = (w) => {
  const logs = [...w.logs.values()]
  return {
    w,
    logs,
    logged: sum(logs, (e) => e.seconds),
    est: sum(w.done, (i) => i.fields.timeoriginalestimate),
    spent: sum(w.done, (i) => i.fields.timespent),
  }
}
// Past/today weekday with no worklog, no completed and no new task.
export const isMissing = (r) =>
  r.w.days === 1 && !isWeekend(r.w.start) && r.w.key <= ymd(Date.now()) && !r.logs.length && !r.w.done.length && !r.w.created

export const MissingBadge = () => (
  <Badge size="xs" color="red" variant="light" radius="sm">
    ⚠ Chưa log
  </Badge>
)

// Issues logged / completed in one period.
export function PeriodIssues({ r, unit, browse }) {
  const issues = new Map([...r.logs.map((e) => [e.issue.key, e.issue]), ...r.w.done.map((i) => [i.key, i])])
  if (!issues.size) return <Empty>Không có log / task hoàn thành trong {unit} này.</Empty>
  const doneKeys = new Set(r.w.done.map((i) => i.key))
  return (
    <Table.ScrollContainer minWidth={720}>
      <Table verticalSpacing={6} fz="sm" bg="white">
        <Table.Thead>
          <Table.Tr>
            {['Key', 'Summary', 'Status', 'Type', 'Estimate', `Logged (${unit})`, 'Spent (tổng)', `Xong trong ${unit}`].map((h) => (
              <Table.Th key={h}>{h}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...issues.values()].map(({ key, fields: f }) => (
            <Table.Tr key={key}>
              <Table.Td>
                <Anchor href={browse(key)} target="_blank" rel="noopener" size="sm">
                  {key}
                </Anchor>
              </Table.Td>
              <Table.Td>{f.summary}</Table.Td>
              <Table.Td>
                <StatusBadge status={f.status} />
              </Table.Td>
              <Table.Td>{f.issuetype?.name}</Table.Td>
              <Table.Td c="dimmed">{hrs(f.timeoriginalestimate)}</Table.Td>
              <Table.Td c="dimmed">{hrs(r.w.logs.get(key)?.seconds)}</Table.Td>
              <Table.Td c="dimmed">{hrs(f.timespent)}</Table.Td>
              <Table.Td>{doneKeys.has(key) ? '✓' : ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

// List view: one row per week / day, newest first, expandable.
export default function PerfList({ periods, open, onToggle, browse }) {
  const rows = [...periods].reverse().map(stats)
  const max = Math.max(1, ...rows.map((r) => r.logged))
  const byDay = periods[0]?.days === 1
  const unit = byDay ? 'ngày' : 'tuần'
  const range = (w) => {
    if (byDay) return `${w.start.toLocaleDateString('vi-VN', { weekday: 'short' })}, ${ddmm(w.start)}`
    const end = new Date(w.start)
    end.setDate(end.getDate() + 6)
    return `${ddmm(w.start)} – ${ddmm(end)}`
  }
  const total = (f) => sum(rows, f)
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table highlightOnHover verticalSpacing="xs" fz="sm">
        <Table.Thead>
          <Table.Tr>
            {[byDay ? 'Ngày' : 'Tuần', 'Nhận mới', 'Hoàn thành', 'Estimate (task xong)', 'Spent (task xong)', 'Logged', 'Issues có log'].map((h) => (
              <Table.Th key={h}>{h}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => {
            const isOpen = open === r.w.key
            const weekend = byDay && isWeekend(r.w.start)
            const missing = isMissing(r)
            const color = weekend ? 'orange.8' : undefined
            return (
              <Fragment key={r.w.key}>
                <Table.Tr bg={missing ? 'red.0' : isOpen ? 'gray.0' : undefined}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <UnstyledButton onClick={() => onToggle(r.w.key)} aria-expanded={isOpen} c={color ?? 'blue.7'} fz="sm">
                      {isOpen ? '▾' : '▸'} {range(r.w)}
                    </UnstyledButton>{' '}
                    {missing && <MissingBadge />}
                  </Table.Td>
                  <Table.Td c={color}>{r.w.created}</Table.Td>
                  <Table.Td c={color}>{r.w.done.length}</Table.Td>
                  <Table.Td c={color ?? 'dimmed'}>{hrs(r.est)}</Table.Td>
                  <Table.Td c={color ?? 'dimmed'}>{hrs(r.spent)}</Table.Td>
                  <Table.Td title={`Logged ${hrs(r.logged)} · ${range(r.w)}`} c={color}>
                    <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Progress value={Math.round((r.logged / max) * 100)} size="sm" w={96} />
                      {hrs(r.logged)}
                    </Box>
                  </Table.Td>
                  <Table.Td c={color}>{r.logs.length}</Table.Td>
                </Table.Tr>
                {isOpen && (
                  <Table.Tr bg="gray.0">
                    <Table.Td colSpan={7} p={0} pb="xs">
                      <PeriodIssues r={r} unit={unit} browse={browse} />
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            )
          })}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr fw={600}>
            <Table.Td>
              Tổng {rows.length} {unit}
            </Table.Td>
            <Table.Td>{total((r) => r.w.created)}</Table.Td>
            <Table.Td>{total((r) => r.w.done.length)}</Table.Td>
            <Table.Td>{hrs(total((r) => r.est))}</Table.Td>
            <Table.Td>{hrs(total((r) => r.spent))}</Table.Td>
            <Table.Td>{hrs(total((r) => r.logged))}</Table.Td>
            <Table.Td />
          </Table.Tr>
        </Table.Tfoot>
      </Table>
    </Table.ScrollContainer>
  )
}
