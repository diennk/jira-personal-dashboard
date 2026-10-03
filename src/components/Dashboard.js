'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Anchor, Autocomplete, Button, Card, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { host } from '../lib/format'
import { loadMembers, makeJira, SECTIONS, sprintState } from '../lib/jira'
import { IssueTable } from './IssueTable'
import Performance from './Performance'
import SprintSection from './SprintSection'

const STATUS = [
  { value: 'new', label: 'To Do' },
  { value: 'indeterminate', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]
const NO_FILTERS = { search: '', status: null, project: null, type: null }

const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort()

export default function Dashboard({ cfg, envMode, me, meError, onSettings }) {
  const [subject, setSubject] = useState(null) // member being viewed; null = me
  const jira = useMemo(() => makeJira(cfg, envMode, subject), [cfg, envMode, subject])
  const [sections, setSections] = useState(() => SECTIONS.map(() => null)) // { total, issues } | { error } | null
  const [tick, setTick] = useState(0) // bumps on every refresh; Sprint and Performance reload on it
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(0)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [members, setMembers] = useState([])
  const [memberText, setMemberText] = useState('')
  const [sprintList, setSprintList] = useState([])
  const [picked, setPicked] = useState('') // sprint id; '' = active sprints
  const gen = useRef(0) // changes when the viewed member changes: stale responses are dropped
  const busy = useRef(false)
  const memberProjects = useRef('')

  // Reload everything; old data stays visible meanwhile.
  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setTick((t) => t + 1)
    const g = gen.current
    const res = await Promise.allSettled(SECTIONS.map((s) => jira.search(s.jql)))
    if (g !== gen.current) return
    setSections(res.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason })))
    busy.current = false
    setLoading(false)
    setLastUpdated(Date.now())
  }, [jira])

  useEffect(() => {
    gen.current++
    busy.current = false
    setSections(SECTIONS.map(() => null))
    refresh()
  }, [refresh])

  const allIssues = useMemo(() => sections.flatMap((s) => s?.issues ?? []), [sections])
  const projects = useMemo(() => uniq(allIssues.map((i) => i.fields.project?.key)), [allIssues])

  // Members = assignable users of the projects on screen (falls back to assignees of loaded issues).
  useEffect(() => {
    const keys = projects.join(',')
    if (!keys || keys === memberProjects.current) return
    memberProjects.current = keys
    loadMembers(jira, projects).then(setMembers, () => {})
  }, [projects, jira])

  // Member picker: me first, then everyone else; duplicate names get the username appended.
  const memberOptions = useMemo(() => {
    const seen = new Map([...members, ...allIssues.map((i) => i.fields.assignee).filter(Boolean)].map((u) => [u.name, u]))
    if (me) seen.delete(me.name)
    const list = [...(me ? [me] : []), ...[...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))]
    const count = new Map()
    list.forEach((u) => count.set(u.displayName, (count.get(u.displayName) ?? 0) + 1))
    return new Map(list.map((u) => [count.get(u.displayName) > 1 ? `${u.displayName} (${u.name})` : u.displayName, u]))
  }, [members, allIssues, me])

  const viewMember = (u) => {
    const next = u && u.name !== me?.name ? u : null
    if ((next?.name ?? null) === (subject?.name ?? null)) return
    setPicked('') // sprints differ per member
    setSprintList([])
    setSubject(next)
  }

  const match = useCallback(
    ({ key, fields: f }) => {
      const q = filters.search.trim().toLowerCase()
      return (
        (!filters.status || f.status?.statusCategory?.key === filters.status) &&
        (!filters.project || f.project?.key === filters.project) &&
        (!filters.type || f.issuetype?.name === filters.type) &&
        (!q || key.toLowerCase().includes(q) || String(f.summary).toLowerCase().includes(q))
      )
    },
    [filters],
  )
  const setFilter = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }))

  // Sprints offered as parent sources in the create-task popup: my active ones + the picked one.
  const activeSprints = sprintList.filter((sp) => sprintState(sp) === 'ACTIVE' || String(sp.id) === picked)
  const sprintKey = uniq([...activeSprints.map((sp) => String(sp.id)), picked]).join(',') // string = stable identity
  const sprintIds = useMemo(() => (sprintKey ? sprintKey.split(',') : []), [sprintKey])
  const sprintNames = activeSprints.map((sp) => sp.name).join(', ')
  const updated = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '-'

  return (
    <Stack p={{ base: 'md', sm: 'lg' }} gap="md">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Jira Personal Dashboard</Title>
          {me ? (
            <Text size="sm" c="teal.7">
              ● Connected: {me.name}{' '}
              <Text span size="xs" c="dimmed">
                ({me.displayName})
              </Text>
            </Text>
          ) : (
            <Text size="sm" c="red.7">
              ✕ {meError?.message}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Jira: {host(cfg.url)} · Last Updated: {updated}
          </Text>
        </div>
        <Group gap="xs" wrap="wrap">
          <Autocomplete
            w={240}
            aria-label="Member"
            placeholder={`Member: ${me?.displayName ?? 'me'}`}
            data={[...memberOptions.keys()]}
            value={memberText}
            onChange={(v) => {
              setMemberText(v)
              if (!v) viewMember(null)
            }}
            onOptionSubmit={(v) => viewMember(memberOptions.get(v))}
            clearable
            maxDropdownHeight={320}
            renderOption={({ option }) => (
              <div>
                <Text size="sm">{option.value}</Text>
                <Text size="xs" c="dimmed">
                  {memberOptions.get(option.value)?.name}
                </Text>
              </div>
            )}
          />
          <Button variant="default" onClick={refresh} loading={loading}>
            Refresh ↻
          </Button>
          {!envMode && (
            <Button variant="default" onClick={onSettings}>
              ⚙ Settings
            </Button>
          )}
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="sm">
        {SECTIONS.map((s, k) => (
          <Paper key={s.title} component="a" href={`#s${k}`} withBorder p="md" radius="md" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Text size="xs" fw={500} tt="uppercase" c="dimmed" style={{ letterSpacing: '.05em' }}>
              {s.title}
            </Text>
            <Text fz={30} fw={600} c={s.color ?? 'dark'} lh={1.3}>
              {!sections[k] ? '…' : sections[k].error ? '!' : sections[k].total}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Performance key={subject?.name ?? 'me'} jira={jira} me={me} tick={tick} projects={projects} sprintIds={sprintIds} sprintNames={sprintNames} onChanged={refresh} />

      <Paper withBorder p="sm" radius="md">
        <Group gap="sm" wrap="wrap">
          <TextInput
            style={{ flex: 1 }}
            miw={256}
            placeholder="🔎 Search key, summary..."
            value={filters.search}
            onChange={(e) => setFilter('search')(e.currentTarget.value)}
          />
          <Select w={150} placeholder="Status: All" data={STATUS} value={filters.status} onChange={setFilter('status')} clearable />
          <Select w={180} placeholder="Project: All" data={projects} value={filters.project} onChange={setFilter('project')} clearable searchable />
          <Select w={160} placeholder="Type: All" data={uniq(allIssues.map((i) => i.fields.issuetype?.name))} value={filters.type} onChange={setFilter('type')} clearable />
          <Button variant="default" onClick={() => setFilters(NO_FILTERS)}>
            Clear
          </Button>
        </Group>
      </Paper>

      <SprintSection key={`sprint-${subject?.name ?? 'me'}`} jira={jira} tick={tick} picked={picked} onPick={setPicked} onSprints={setSprintList} match={match} />

      {SECTIONS.map((s, k) => {
        const d = sections[k]
        return (
          <Card key={s.title} id={`s${k}`} withBorder padding={0} radius="md">
            <Group px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
              <Title order={5}>{s.title}</Title>
              <Anchor href={jira.jqlLink(s.jql)} target="_blank" rel="noopener" size="xs" ml="auto">
                Mở trong Jira ↗
              </Anchor>
            </Group>
            {!d ? (
              <Group justify="center" py="xl">
                <Loader size="sm" />
              </Group>
            ) : d.error ? (
              <Alert color="red" m="md" style={{ whiteSpace: 'pre-wrap' }}>
                {d.error.message}
              </Alert>
            ) : (
              <>
                <IssueTable issues={d.issues} match={match} browse={jira.browse} />
                {d.total > d.issues.length && (
                  <Text size="xs" c="dimmed" p="sm">
                    Hiển thị {d.issues.length}/{d.total}.
                  </Text>
                )}
              </>
            )}
          </Card>
        )
      })}

      <Text ta="center" size="xs" c="dimmed" pb="md">
        {host(cfg.url)} · Last updated {updated}
      </Text>
    </Stack>
  )
}
