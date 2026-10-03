'use client'

import { useEffect, useState } from 'react'
import { Alert, Anchor, Button, Collapse, Group, Loader, Modal, Paper, ScrollArea, SimpleGrid, Stack, Table, Text, Textarea, TextInput } from '@mantine/core'
import { fmtDate, hrs, parseDuration, ymd } from '../lib/format'
import { worklogPath } from '../lib/jira'
import { StatusBadge } from './IssueTable'

const ISSUE_FIELDS = 'summary,status,issuetype,priority,parent,assignee,reporter,duedate,created,updated,timetracking,description,project'
const when = (d) => (d ? new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '')

// Own worklog: editable (date / start / hours / comment). Date and time stay in the worklog's stored offset.
function WorklogForm({ jira, issue, wl, mine, onSaved }) {
  const initial = { date: wl.started.slice(0, 10), time: wl.started.slice(11, 16), spent: hrs(wl.timeSpentSeconds), comment: wl.comment ?? '' }
  const [v, setV] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dayLabel = new Date(`${initial.date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  const changed = Object.keys(initial).some((k) => v[k] !== initial[k])
  const field = (k) => ({ value: v[k], onChange: (e) => setV({ ...v, [k]: e.currentTarget.value }) })

  if (!mine)
    return (
      <Paper withBorder p="sm" bg="blue.0">
        <Text fw={600} size="sm" mb={6}>
          Worklog này{' '}
          <Text span size="xs" c="dimmed">
            · của {wl.author?.displayName}, chỉ xem
          </Text>
        </Text>
        <Text size="sm">
          {dayLabel} · bắt đầu {initial.time} · {initial.spent}
        </Text>
        <Text size="sm" c={wl.comment ? undefined : 'dimmed'} style={{ whiteSpace: 'pre-wrap' }}>
          {wl.comment || '—'}
        </Text>
      </Paper>
    )

  const save = async (e) => {
    e.preventDefault()
    const secs = parseDuration(v.spent)
    if (!(secs > 0)) return setError(`Thời gian không hợp lệ: ${v.spent}`)
    if (!v.date || !v.time) return setError('Ngày và giờ bắt đầu là bắt buộc.')
    setBusy(true)
    setError('')
    try {
      await jira.api(`${worklogPath(issue, wl.id)}?adjustEstimate=auto`, {
        method: 'PUT',
        body: { started: `${v.date}T${v.time}:00.000${wl.started.slice(23)}`, timeSpentSeconds: secs, comment: v.comment },
      })
      onSaved(v.date)
    } catch (err) {
      setError(`Không lưu được: ${err.message}`)
      setBusy(false)
    }
  }

  return (
    <Paper component="form" onSubmit={save} withBorder p="sm" bg="blue.0">
      <Stack gap="xs">
        <Text fw={600} size="sm">
          Worklog này{' '}
          <Text span size="xs" c="dimmed">
            · {dayLabel}
          </Text>
        </Text>
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
          <TextInput label="Ngày" type="date" size="xs" {...field('date')} />
          <TextInput label="Bắt đầu" type="time" size="xs" {...field('time')} />
          <TextInput label="Thời gian" size="xs" placeholder="8h, 1.5h, 30m" {...field('spent')} />
        </SimpleGrid>
        <Textarea label="Ghi chú" size="xs" autosize minRows={2} placeholder="Không bắt buộc" {...field('comment')} />
        {error && (
          <Alert color="red" variant="light" p="xs">
            {error}
          </Alert>
        )}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Đổi số giờ sẽ tự điều chỉnh remaining estimate.
          </Text>
          <Button type="submit" size="xs" disabled={!changed} loading={busy}>
            Lưu worklog
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}

// target = { issue, wl? } or null. onSaved(newDate) after a worklog edit.
export default function DetailModal({ jira, me, target, onClose, onSaved }) {
  const [data, setData] = useState(null) // { f, wl } | { error }
  const [showDesc, setShowDesc] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!target) return
    let live = true
    setData(null)
    setShowDesc(false)
    Promise.all([
      jira.api(`/rest/api/2/issue/${encodeURIComponent(target.issue)}?fields=${ISSUE_FIELDS}`).then((r) => r.fields),
      target.wl ? jira.api(worklogPath(target.issue, target.wl)) : null,
    ]).then(
      ([f, wl]) => live && setData({ f, wl }),
      (error) => live && setData({ error }),
    )
    return () => {
      live = false
    }
  }, [jira, target, reload])

  const f = data?.f
  const t = f?.timetracking ?? {}
  const rows = f && [
    ['Loại', f.issuetype?.name],
    [
      'Parent',
      f.parent && (
        <>
          <Anchor href={jira.browse(f.parent.key)} target="_blank" rel="noopener" size="sm">
            {f.parent.key}
          </Anchor>{' '}
          {f.parent.fields?.summary}
        </>
      ),
    ],
    ['Priority', f.priority?.name],
    ['Assignee', f.assignee?.displayName ?? 'Unassigned'],
    ['Reporter', f.reporter?.displayName],
    [
      'Due date',
      f.duedate && (
        <Text span size="sm" c={f.duedate < ymd(Date.now()) && f.status?.statusCategory?.key !== 'done' ? 'red.7' : undefined}>
          {fmtDate(f.duedate)}
        </Text>
      ),
    ],
    ['Estimate', hrs(t.originalEstimateSeconds)],
    ['Đã log', hrs(t.timeSpentSeconds)],
    ['Còn lại', t.remainingEstimateSeconds === 0 ? '0h' : hrs(t.remainingEstimateSeconds)],
    ['Tạo / cập nhật', `${when(f.created)} · ${when(f.updated)}`],
  ]

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      size="lg"
      title={
        target && (
          <Group gap="xs">
            <Anchor href={jira.browse(target.issue)} target="_blank" rel="noopener" fw={600}>
              {target.issue}
            </Anchor>
            {f && <StatusBadge status={f.status} />}
          </Group>
        )
      }
    >
      {!data ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : data.error ? (
        <Alert color="red">{data.error.message}</Alert>
      ) : (
        <Stack>
          <Text fw={500} size="md" style={{ overflowWrap: 'anywhere' }}>
            {f.summary}
          </Text>
          {data.wl && (
            <WorklogForm
              key={`${data.wl.id}-${data.wl.updated}`}
              jira={jira}
              issue={target.issue}
              wl={data.wl}
              mine={data.wl.author?.name === me?.name}
              onSaved={(day) => {
                onSaved(day)
                setReload((n) => n + 1) // re-read from Jira
              }}
            />
          )}
          <Table variant="vertical" layout="fixed" withTableBorder fz="sm">
            <Table.Tbody>
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Th w={140}>{k}</Table.Th>
                    <Table.Td style={{ overflowWrap: 'anywhere' }}>{v}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
          {f.description && (
            <div>
              <Button variant="subtle" size="compact-sm" onClick={() => setShowDesc((s) => !s)}>
                {showDesc ? '▾' : '▸'} Mô tả
              </Button>
              <Collapse expanded={showDesc}>
                <ScrollArea.Autosize mah={240} mt={6}>
                  <Paper withBorder p="xs" bg="gray.0" fz="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {f.description}
                  </Paper>
                </ScrollArea.Autosize>
              </Collapse>
            </div>
          )}
        </Stack>
      )}
    </Modal>
  )
}
