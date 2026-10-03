'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Card, Group, Loader, Progress, Select, Stack, Text, Title } from '@mantine/core'
import { fmtDate } from '../lib/format'
import { loadSprints, sprintState } from '../lib/jira'
import { Empty, IssueTable } from './IssueTable'

const ACTIVE = 'active' // Select value for "active sprints"

function sprintWhen(g) {
  const end = Date.parse(g.endDate)
  const start = Date.parse(g.startDate)
  if (sprintState(g) === 'CLOSED') return isNaN(end) ? 'Đã đóng' : `Đã đóng (${fmtDate(end)})`
  if (sprintState(g) === 'FUTURE') return isNaN(start) ? 'Sắp tới' : `Bắt đầu ${fmtDate(start)}`
  return isNaN(end) ? '' : `Còn ${Math.max(0, Math.ceil((end - Date.now()) / 864e5))} ngày (${fmtDate(end)})`
}

// Sprint section; reports the member's sprint list + current pick up (the create-task popup uses them).
export default function SprintSection({ jira, tick, picked, onPick, onSprints, match }) {
  const [data, setData] = useState(null) // { missingField, list, groups } | { error }
  const req = useRef(0)

  useEffect(() => {
    const n = ++req.current // only the latest request writes (auto refresh and a pick change can overlap)
    loadSprints(jira, picked).then(
      (d) => {
        if (n !== req.current) return
        setData(d)
        onSprints(d.list)
      },
      (error) => n === req.current && setData({ error }),
    )
  }, [jira, tick, picked]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = (data?.list ?? []).map((sp) => ({ value: String(sp.id), label: `${sp.name} (${sprintState(sp).toLowerCase()})` }))
  if (picked && !options.some((o) => o.value === picked)) options.push({ value: picked, label: `Sprint #${picked}` })

  return (
    <Card withBorder padding={0} radius="md">
      <Group px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
        <Title order={5}>Sprint</Title>
        <Select
          size="xs"
          w={320}
          aria-label="Sprint"
          allowDeselect={false}
          value={picked || ACTIVE}
          onChange={(v) => onPick(v === ACTIVE ? '' : v)}
          data={[{ value: ACTIVE, label: 'Sprint đang active' }, ...options]}
        />
      </Group>
      {!data ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : data.error ? (
        <Alert color="red" m="md" style={{ whiteSpace: 'pre-wrap' }}>
          {data.error.message}
        </Alert>
      ) : data.missingField ? (
        <Empty>Không thấy field Sprint (Jira Software?).</Empty>
      ) : !data.groups.length ? (
        <Empty>{picked ? 'Không có issue trong sprint này.' : 'Không có sprint active.'}</Empty>
      ) : (
        data.groups.map((g) => {
          const done = g.issues.filter((i) => i.fields.status?.statusCategory?.key === 'done').length
          const pct = Math.round((done / g.issues.length) * 100)
          const when = sprintWhen(g)
          return (
            <Stack key={g.id} gap={6} pt="sm">
              <Group gap="xs" px="md">
                <Text fw={600}>{g.name}</Text>
                <Text size="xs" c="dimmed">
                  {when && `${when} · `}
                  {done}/{g.issues.length} xong ({pct}%)
                </Text>
              </Group>
              <Progress value={pct} color="teal" size="sm" maw={320} mx="md" />
              <IssueTable issues={g.issues} match={match} browse={jira.browse} />
            </Stack>
          )
        })
      )}
    </Card>
  )
}
