'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Card, Group, Loader, SegmentedControl, Select, Text, TextInput, Title } from '@mantine/core'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { ddmm, hrs, parseDuration, sum, tzOffset, ymd } from '../lib/format'
import { BACKLOG_JQL, loadPerformance, PERF_FIELDS, PERF_RANGES, perfSpec, worklogPath } from '../lib/jira'
import CreateTaskModal from './CreateTaskModal'
import DetailModal from './DetailModal'
import PerfCalendar from './PerfCalendar'
import PerfList from './PerfList'

const thisMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
const fail = (title, e) => notifications.show({ color: 'red', title, message: e.message ?? String(e), autoClose: 8000 })

// Performance of the viewed member (list by week/day, or month calendar with drag & drop).
// Writes (move / log / create / edit) are only offered on my own dashboard (`own`).
export default function Performance({ jira, me, tick, projects, sprintIds, sprintNames, onChanged }) {
  const own = !jira.subject
  const [view, setView] = useState('cal')
  const [range, setRange] = useState('w8')
  const [month, setMonth] = useState(thisMonth)
  const [open, setOpen] = useState('') // expanded week/day (list) or selected day (calendar)
  const [data, setData] = useState(null) // { periods, backlog } | { error }
  const [reload, setReload] = useState(0)
  const [createFor, setCreateFor] = useState(null) // { day, withLog }
  const [detailFor, setDetailFor] = useState(null) // { issue, wl? }
  const req = useRef(0)

  useEffect(() => {
    const n = ++req.current // only the latest request writes
    const who = jira.subject?.name ?? me?.name
    Promise.all([
      loadPerformance(jira, perfSpec(view, range, month), who),
      view === 'cal' && own ? jira.searchAll(BACKLOG_JQL, PERF_FIELDS) : [],
    ]).then(
      ([periods, backlog]) => n === req.current && setData({ periods, backlog }),
      (error) => n === req.current && setData({ error }),
    )
  }, [jira, me, tick, view, range, month, reload, own])

  // A new view / range / month shows a loader instead of data shaped for the old one.
  const change = (fn) => (value) => {
    fn(value)
    setOpen('')
    setData(null)
  }
  const reloadAt = (day) => {
    setOpen(day)
    setReload((n) => n + 1)
  }

  const loggedOn = (day) => sum([...(data?.periods?.find((w) => w.key === day)?.logs.values() ?? [])], (e) => e.seconds)

  // Drag a worklog chip onto another day: same time of day and offset, new date (after confirm).
  const moveWorklog = ({ issue, wl, started, secs }, to) => {
    const from = started.slice(0, 10) // ponytail: date in the worklog's own offset; assumes it matches the browser's
    if (from === to) return
    modals.openConfirmModal({
      title: 'Chuyển worklog',
      children: (
        <Text size="sm">
          Chuyển worklog {hrs(secs)} của <b>{issue}</b> từ {ddmm(from)} sang {ddmm(to)}?
        </Text>
      ),
      labels: { confirm: 'Chuyển', cancel: 'Huỷ' },
      onConfirm: async () => {
        try {
          await jira.api(`${worklogPath(issue, wl)}?adjustEstimate=leave`, {
            method: 'PUT',
            body: { started: to + started.slice(10), timeSpentSeconds: secs },
          })
          reloadAt(to)
        } catch (e) {
          fail('Không chuyển được worklog', e)
        }
      },
    })
  }

  // Drag a sidebar task onto a day: ask for hours (default = remaining estimate), worklog starts 09:00.
  const logWork = ({ issue, est }, day) => {
    let value = est ? hrs(est) : '8h'
    modals.openConfirmModal({
      title: `Log work cho ${issue} ngày ${ddmm(day)}`,
      children: (
        <TextInput label="Số giờ" description="VD 8h, 1.5h, 30m" defaultValue={value} onChange={(e) => (value = e.currentTarget.value)} data-autofocus />
      ),
      labels: { confirm: 'Log work', cancel: 'Huỷ' },
      onConfirm: async () => {
        const secs = parseDuration(value)
        if (!(secs > 0)) return fail('Số giờ không hợp lệ', value)
        try {
          await jira.api(worklogPath(issue), { method: 'POST', body: { started: `${day}T09:00:00.000${tzOffset()}`, timeSpentSeconds: secs } })
          reloadAt(day)
        } catch (e) {
          fail('Không log work được', e)
        }
      },
    })
  }

  const onMonth = (d) => {
    setMonth((m) => (d ? new Date(m.getFullYear(), m.getMonth() + d, 1) : thisMonth()))
    setOpen('')
    setData(null)
  }

  const body = !data ? (
    <Group justify="center" py="xl">
      <Loader size="sm" />
    </Group>
  ) : data.error ? (
    <Alert color="red" m="md" style={{ whiteSpace: 'pre-wrap' }}>
      {data.error.message}
    </Alert>
  ) : view === 'list' ? (
    <PerfList periods={data.periods} open={open} onToggle={(k) => setOpen((o) => (o === k ? '' : k))} browse={jira.browse} />
  ) : (
    <PerfCalendar
      days={data.periods}
      month={month}
      selected={open}
      backlog={data.backlog}
      own={own}
      browse={jira.browse}
      onMonth={onMonth}
      onSelect={(k) => setOpen((o) => (o === k ? '' : k))}
      onMove={moveWorklog}
      onLog={logWork}
      onAdd={(day) => setCreateFor({ day, withLog: true })}
      onCreate={() => setCreateFor({ day: ymd(Date.now()), withLog: false })}
      onOpen={(issue, wl) => setDetailFor({ issue, wl })}
    />
  )

  return (
    <Card withBorder padding={0} radius="md">
      <Group px="md" py="sm" gap="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={5}>Performance</Title>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={change(setView)}
          data={[
            { label: 'List', value: 'list' },
            { label: 'Calendar', value: 'cal' },
          ]}
        />
        {view === 'list' && <Select size="xs" w={110} aria-label="Khoảng thời gian" data={PERF_RANGES} value={range} onChange={(r) => r && change(setRange)(r)} allowDeselect={false} />}
        <Text size="xs" c="dimmed" ml="auto">
          Task xong = lần đổi status cuối · Logged = worklog của chính member
        </Text>
      </Group>
      {body}
      {own && (
        <CreateTaskModal
          jira={jira}
          me={me}
          target={createFor}
          projects={projects}
          sprintIds={sprintIds}
          sprintNames={sprintNames}
          loggedOn={loggedOn}
          onClose={() => setCreateFor(null)}
          onCreated={(day) => {
            setCreateFor(null)
            reloadAt(day)
            onChanged() // the new task also shows in the sections
          }}
        />
      )}
      <DetailModal jira={jira} me={me} target={detailFor} onClose={() => setDetailFor(null)} onSaved={reloadAt} />
    </Card>
  )
}
