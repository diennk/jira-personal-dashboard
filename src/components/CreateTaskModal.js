'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Autocomplete, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { ddmm, hrs, parseDuration, tzOffset } from '../lib/format'
import { loadParents, subtaskType, worklogPath } from '../lib/jira'
import { StatusBadge } from './IssueTable'

const DAY_HOURS = 8 * 3600
const parentInfo = new Map() // issue key -> fields (null = not found); shared across openings
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

// target = { day, withLog } | null. withLog = false (sidebar "+ Tạo task"): task only, estimate 8h.
// loggedOn(day) = seconds I already logged that day (from the calendar). onCreated(logDay | '') after success.
export default function CreateTaskModal({ jira, me, target, projects, sprintIds, sprintNames, loggedOn, onClose, onCreated }) {
  const [project, setProject] = useState('')
  const [sub, setSub] = useState(null) // createmeta sub-task type
  const [parents, setParents] = useState({ keys: [], note: '' })
  const [v, setV] = useState({ parent: '', summary: '', estimate: '', logged: '', day: '', due: '' })
  const [dayNote, setDayNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setLookups] = useState(0) // re-render after a parent lookup
  const defaults = useRef({ est: '', log: '' }) // values we filled in; overwritten only while untouched
  const creating = useRef(false) // a double click must not create the task twice
  const withLog = !!target?.withLog

  // Default estimate / log for a day = 8h minus what I already logged that day.
  const dayDefaults = (day, cur) => {
    if (!withLog) return cur
    const done = loggedOn(day)
    const left = Math.max(0, DAY_HOURS - done)
    const d = left ? hrs(left) : ''
    const next = {
      ...cur,
      estimate: cur.estimate === defaults.current.est ? d : cur.estimate,
      logged: cur.logged === defaults.current.log ? d : cur.logged,
    }
    defaults.current = { est: d, log: d }
    setDayNote(`${ddmm(day)}${done ? ` · đã log ${hrs(done)}, còn ${left ? hrs(left) : '0h'}` : ''}`)
    return next
  }

  // Reset on open.
  useEffect(() => {
    if (!target) return
    setError('')
    setBusy(false)
    setSub(null)
    setProject(projects[0] ?? '')
    if (target.withLog) {
      defaults.current = { est: '', log: '' }
      setV(dayDefaults(target.day, { parent: '', summary: '', estimate: '', logged: '', day: target.day, due: target.day }))
    } else {
      defaults.current = { est: '8h', log: '' }
      setDayNote(ddmm(target.day))
      setV({ parent: '', summary: '', estimate: '8h', logged: '', day: target.day, due: target.day })
    }
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sub-task type + parent suggestions for the chosen project.
  useEffect(() => {
    if (!target || !project) return
    let live = true
    setParents({ keys: [], note: 'đang tải…' })
    Promise.all([subtaskType(jira, project), loadParents(jira, project, sprintIds)]).then(
      ([type, { parents: map, fromSprint }]) => {
        if (!live) return
        setSub(type)
        map.forEach((f, k) => parentInfo.set(k, f))
        const note = `${map.size} parent gợi ý${sprintIds.length ? ` · ${fromSprint} từ sprint ${sprintNames || sprintIds.join(', ')}` : ' · không có sprint active'}`
        setParents({ keys: [...map.keys()], note })
      },
      (e) => live && setError(`Không tải được thông tin project: ${e.message}`),
    )
    return () => {
      live = false
    }
  }, [target, project, jira, sprintIds, sprintNames])

  const set = (k) => (e) => setV({ ...v, [k]: typeof e === 'string' ? e : e.currentTarget.value })
  const parentKey = v.parent.trim().toUpperCase()
  const info = parentInfo.get(parentKey)

  // Typed keys that aren't suggestions: look them up when the field loses focus.
  const lookupParent = async () => {
    if (!KEY_RE.test(parentKey) || parentInfo.has(parentKey)) return
    const f = await jira.api(`/rest/api/2/issue/${encodeURIComponent(parentKey)}?fields=summary,status,issuetype`).then((r) => r.fields, () => null)
    parentInfo.set(parentKey, f)
    setLookups((n) => n + 1)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (creating.current) return
    creating.current = true
    try {
      await createAndLog()
    } finally {
      creating.current = false
    }
  }

  async function createAndLog() {
    const est = v.estimate.trim() ? parseDuration(v.estimate) : 0
    const logged = v.logged.trim() ? parseDuration(v.logged) : 0 // empty = create the task only
    if (Number.isNaN(est) || est < 0) return setError(`Estimate không hợp lệ: ${v.estimate}`)
    if (Number.isNaN(logged) || logged < 0) return setError(`Số giờ log không hợp lệ: ${v.logged}`)
    if (!parentKey) return setError('Phải chọn parent.')
    if (!v.due || (logged && !v.day)) return setError('Ngày log và due date là bắt buộc.')
    setBusy(true)
    setError('')
    let parent
    try {
      parent = await jira.api(`/rest/api/2/issue/${encodeURIComponent(parentKey)}?fields=issuetype,project,summary`)
    } catch {
      setBusy(false)
      return setError(`Parent ${parentKey} không tồn tại hoặc bạn không có quyền xem.`)
    }
    const invalid = parent.fields.issuetype?.subtask
      ? `${parentKey} là sub-task, không làm parent được.`
      : parent.fields.project?.key !== project && `${parentKey} không thuộc project ${project}.`
    if (invalid) {
      setBusy(false)
      return setError(invalid)
    }
    const fields = {
      project: { key: project },
      issuetype: { id: sub.id },
      summary: v.summary.trim(),
      duedate: v.due,
      reporter: { name: me.name },
      assignee: { name: me.name },
      parent: { key: parentKey },
      ...(est && { timetracking: { originalEstimate: `${est / 60}m` } }),
    }
    let key
    try {
      key = (await jira.api('/rest/api/2/issue', { method: 'POST', body: { fields } })).key
      if (logged)
        await jira.api(worklogPath(key), { method: 'POST', body: { started: `${v.day}T09:00:00.000${tzOffset()}`, timeSpentSeconds: logged } })
    } catch (err) {
      setBusy(false)
      return setError(key ? `Đã tạo ${key} nhưng log work lỗi: ${err.message}` : `Không tạo được task: ${err.message}`)
    }
    setBusy(false)
    onCreated(logged ? v.day : '')
  }

  const hasLog = !!v.logged.trim()
  const ready = sub && parentKey && v.summary.trim()

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      size="lg"
      title={
        <Group gap="xs">
          <Text fw={600}>{hasLog ? 'Tạo task & log work' : 'Tạo task'}</Text>
          <Text size="sm" c="dimmed">
            {dayNote}
          </Text>
        </Group>
      }
    >
      <Stack component="form" onSubmit={submit} gap="sm">
        <SimpleGrid cols={2}>
          <Select label="Project" data={projects} value={project} onChange={(p) => p && setProject(p)} allowDeselect={false} />
          <TextInput label="Loại" value={sub?.name ?? 'Đang tải…'} readOnly variant="filled" />
        </SimpleGrid>
        <Autocomplete
          label="Parent"
          description={parents.note}
          withAsterisk
          placeholder="Chọn story / task cha, VD: IVIEC2024-37007"
          data={parents.keys}
          value={v.parent}
          onChange={set('parent')}
          onBlur={lookupParent}
          data-autofocus
          maxDropdownHeight={280}
          filter={({ options, search }) => {
            const q = search.trim().toLowerCase()
            return options.filter((o) => `${o.value} ${parentInfo.get(o.value)?.summary ?? ''}`.toLowerCase().includes(q))
          }}
          renderOption={({ option }) => {
            const f = parentInfo.get(option.value)
            return (
              <div>
                <Text size="sm">{option.value}</Text>
                <Text size="xs" c="dimmed">
                  {f?.summary} {f?.status && `[${f.status.name}]`}
                </Text>
              </div>
            )
          }}
        />
        {parentKey && info !== undefined && (
          <Paper withBorder p="xs" bg="gray.0" fz="xs" style={{ overflowWrap: 'anywhere' }}>
            {info === null ? (
              <Text size="xs" c="red.7">
                ✕ Không tìm thấy {parentKey}
              </Text>
            ) : (
              <Group gap={6}>
                <Text size="xs" fw={600}>
                  {parentKey}
                </Text>
                <Text size="xs">{info.summary}</Text>
                <StatusBadge status={info.status} size="xs" />
                {info.issuetype?.subtask && (
                  <Text size="xs" c="red.7">
                    (là sub-task)
                  </Text>
                )}
              </Group>
            )}
          </Paper>
        )}
        <TextInput label="Summary" withAsterisk value={v.summary} onChange={set('summary')} autoComplete="off" />
        <SimpleGrid cols={2}>
          <TextInput label="Estimate" placeholder="8h" value={v.estimate} onChange={set('estimate')} />
          <TextInput label="Log work" placeholder="Để trống = chỉ tạo task" value={v.logged} onChange={set('logged')} />
          <TextInput
            label="Ngày log"
            type="date"
            value={v.day}
            onChange={(e) => {
              const day = e.currentTarget.value
              setV(day ? dayDefaults(day, { ...v, day }) : { ...v, day })
            }}
          />
          <TextInput label="Due date" type="date" withAsterisk value={v.due} onChange={set('due')} />
        </SimpleGrid>
        {error && (
          <Alert color="red" variant="light" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" disabled={!ready} loading={busy}>
            {hasLog ? 'Tạo & log work' : 'Tạo task'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
