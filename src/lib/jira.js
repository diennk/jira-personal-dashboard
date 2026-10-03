// Jira data layer: every call goes through the Next.js API route /api/jira (see app/api/jira).
import { dayOf, mondayOf, ymd } from './format'

export const CFG_KEY = 'jira-personal-dashboard:config'
export const loadSavedCfg = () => {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) ?? sessionStorage.getItem(CFG_KEY))
  } catch {
    return null
  }
}

const FIELDS = 'summary,status,priority,issuetype,assignee,duedate,updated,project'
export const PERF_FIELDS = 'summary,status,issuetype,timeoriginalestimate,timespent,timeestimate,created,updated'

// Edit freely: title, JQL, card color (Mantine color)
export const SECTIONS = [
  { title: 'Đang làm', jql: 'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC', color: 'blue.6' },
  { title: 'To do', jql: 'assignee = currentUser() AND statusCategory = "To Do" ORDER BY priority DESC, updated DESC' },
  { title: 'Bugs', jql: 'assignee = currentUser() AND issuetype = Bug AND statusCategory != Done ORDER BY priority DESC', color: 'red.6' },
  { title: 'Quá hạn', jql: 'assignee = currentUser() AND statusCategory != Done AND duedate < startOfDay() ORDER BY duedate', color: 'orange.6' },
  { title: 'Đã report', jql: 'reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC' },
  { title: 'Đang watch', jql: 'watcher = currentUser() AND statusCategory != Done ORDER BY updated DESC', color: 'cyan.7' },
  // ponytail: workflow doesn't set resolution & DC lacks statusCategoryChangedDate, so "updated" approximates done-date
  { title: 'Xong 14 ngày qua', jql: 'assignee = currentUser() AND statusCategory = Done AND updated >= -14d ORDER BY updated DESC', color: 'teal.7' },
]
export const BACKLOG_JQL = 'assignee = currentUser() AND timespent is EMPTY ORDER BY updated DESC' // any status, incl. resolved

// One client per (connection, viewed member). `subject` = { name, displayName } or null for the connected user.
export function makeJira(cfg, envMode, subject = null) {
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' }
    if (body) headers['Content-Type'] = 'application/json'
    if (!envMode) Object.assign(headers, { 'X-Jira-Url': cfg.url, 'X-Jira-Token': cfg.token })
    const r = await fetch('/api/jira' + path, { method, headers, body: body && JSON.stringify(body) })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${(await r.text()).slice(0, 200)}`)
    return r.status === 204 ? null : r.json()
  }
  const forSubject = (jql) => (subject ? jql.replaceAll('currentUser()', `"${subject.name.replace(/["\\]/g, '\\$&')}"`) : jql)
  const search = (jql, max = 50, extraFields = '') =>
    api(`/rest/api/2/search?maxResults=${max}&fields=${FIELDS}${extraFields}&jql=${encodeURIComponent(forSubject(jql))}`)
  // Every page of a search / an issue's worklogs, so nothing is dropped.
  async function pages(url, key) {
    const out = []
    for (let startAt = 0; ; ) {
      const r = await api(`${url}${url.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=500`)
      const items = r[key] ?? []
      out.push(...items)
      startAt += items.length
      if (!items.length || startAt >= (r.total ?? 0)) return out
    }
  }
  const searchAll = (jql, fields, expand = '') =>
    pages(`/rest/api/2/search?fields=${fields}${expand ? `&expand=${expand}` : ''}&jql=${encodeURIComponent(forSubject(jql))}`, 'issues')

  return {
    cfg,
    envMode,
    subject,
    api,
    search,
    searchAll,
    pages,
    browse: (key) => `${cfg.url}/browse/${key}`,
    jqlLink: (jql) => `${cfg.url}/issues/?jql=${encodeURIComponent(forSubject(jql))}`,
  }
}

// ---- Sprints ----
// Sprint field is a custom field; value is an object (newer DC) or a "...Sprint@x[id=1,state=ACTIVE,name=..]" string (older).
const parseSprint = (s) =>
  typeof s === 'string' ? Object.fromEntries([...s.matchAll(/(\w+)=([^,\]]*)/g)].map((m) => [m[1], m[2]])) : s
export const sprintState = (sp) => String(sp.state).toUpperCase()
const STATE_RANK = { ACTIVE: 0, FUTURE: 1, CLOSED: 2 }
const sprintFieldByUrl = new Map() // resolved once per Jira

// -> { missingField, list: sprints the member has issues in, groups: [{ ...sprint, issues }] }
export async function loadSprints(jira, picked) {
  const url = jira.cfg.url
  if (!sprintFieldByUrl.has(url))
    sprintFieldByUrl.set(
      url,
      jira.api('/rest/api/2/field').then((fs) => fs.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id ?? null),
    )
  const sf = await sprintFieldByUrl.get(url)
  if (!sf) return { missingField: true, list: [], groups: [] }
  const sprintsOf = (i) => [].concat(i.fields[sf] ?? []).map(parseSprint)
  const [res, hist] = await Promise.all([
    jira.search(`assignee = currentUser() AND ${picked ? `sprint = ${Number(picked)}` : 'sprint in openSprints()'} ORDER BY Rank`, 200, ',' + sf),
    // ponytail: list built from the 200 latest-updated issues; older sprints drop off
    jira.search('assignee = currentUser() AND sprint is not EMPTY ORDER BY updated DESC', 200, ',' + sf),
  ])
  const known = new Map()
  for (const i of [...hist.issues, ...res.issues]) for (const sp of sprintsOf(i)) known.set(String(sp.id), sp)
  const list = [...known.values()].sort(
    (x, y) => (STATE_RANK[sprintState(x)] ?? 3) - (STATE_RANK[sprintState(y)] ?? 3) || (Date.parse(y.startDate) || 0) - (Date.parse(x.startDate) || 0),
  )
  const groups = new Map()
  for (const i of res.issues)
    for (const sp of sprintsOf(i)) {
      if (picked ? String(sp.id) !== picked : sprintState(sp) !== 'ACTIVE') continue
      if (!groups.has(String(sp.id))) groups.set(String(sp.id), { ...sp, issues: [] })
      groups.get(String(sp.id)).issues.push(i)
    }
  return { missingField: false, list, groups: [...groups.values()] }
}

// ---- Performance ----
export const PERF_RANGES = [
  { value: 'w4', label: '4 tuần' },
  { value: 'w8', label: '8 tuần' },
  { value: 'w12', label: '12 tuần' },
  { value: 'd7', label: '7 ngày' },
  { value: 'd14', label: '14 ngày' },
  { value: 'd30', label: '30 ngày' },
]

// Periods to load: list = range ('w8' = 8 weeks, 'd14' = 14 days); calendar = full Mon–Sun weeks covering `month`.
export function perfSpec(view, range, month) {
  if (view === 'cal') {
    const first = mondayOf(month)
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
    const count = Math.ceil((Math.round((last - first) / 864e5) + 1) / 7) * 7
    return { first, step: 1, count, startOf: dayOf }
  }
  const byDay = range[0] === 'd'
  const count = Number(range.slice(1))
  const step = byDay ? 1 : 7
  const startOf = byDay ? dayOf : mondayOf
  const first = startOf(Date.now())
  first.setDate(first.getDate() - step * (count - 1))
  return { first, step, count, startOf }
}

// Resolution isn't set by this workflow, so "done at" = last status change (fallback: updated).
const doneAt = (i) =>
  (i.changelog?.histories ?? []).filter((h) => h.items.some((it) => it.field === 'status')).map((h) => h.created).sort().at(-1) ?? i.fields.updated

// Periods oldest first: { key, start, days, created, done[], logs: Map(issueKey -> { issue, seconds, worklogs[] }) }
export async function loadPerformance(jira, { first, step, count, startOf }, who) {
  const since = ymd(first)
  const [logged, done, created] = await Promise.all([
    jira.searchAll(`worklogAuthor = currentUser() AND worklogDate >= "${since}"`, PERF_FIELDS + ',worklog'),
    jira.searchAll(`assignee = currentUser() AND statusCategory = Done AND updated >= "${since}"`, PERF_FIELDS, 'changelog'),
    jira.searchAll(`assignee = currentUser() AND created >= "${since}"`, 'created'),
  ])
  const periods = Array.from({ length: count }, (_, k) => {
    const start = new Date(first)
    start.setDate(start.getDate() + step * k)
    return { key: ymd(start), start, days: step, created: 0, done: [], logs: new Map() }
  })
  const index = new Map(periods.map((w) => [w.key, w]))
  const periodOf = (d) => index.get(ymd(startOf(d)))
  for (const i of created) {
    const w = periodOf(i.fields.created)
    if (w) w.created++
  }
  for (const i of done) periodOf(doneAt(i))?.done.push(i)
  await Promise.all(
    logged.map(async (i) => {
      const wl = i.fields.worklog
      // search embeds at most 20 worklogs per issue; fetch the full list when there are more
      const worklogs = wl.total > wl.worklogs.length ? await jira.pages(`/rest/api/2/issue/${i.key}/worklog`, 'worklogs') : wl.worklogs
      for (const w of worklogs) {
        const wk = w.author?.name === who && periodOf(w.started)
        if (!wk) continue
        const e = wk.logs.get(i.key) ?? { issue: i, seconds: 0, worklogs: [] }
        e.seconds += w.timeSpentSeconds
        e.worklogs.push(w)
        wk.logs.set(i.key, e)
      }
    }),
  )
  return periods
}

// ---- Members: assignable users of every project seen in loaded issues ----
export async function loadMembers(jira, projectKeys) {
  const users = await jira.api(
    `/rest/api/2/user/assignable/multiProjectSearch?maxResults=1000&projectKeys=${encodeURIComponent(projectKeys.join(','))}`,
  )
  return users.map(({ name, displayName }) => ({ name, displayName }))
}

// ---- Create task: sub-task type + parent suggestions ----
const metaCache = new Map() // project -> createmeta issue types
export async function subtaskType(jira, project) {
  if (!metaCache.has(project))
    metaCache.set(project, jira.api(`/rest/api/2/issue/createmeta/${encodeURIComponent(project)}/issuetypes`).then((r) => r.values))
  const sub = (await metaCache.get(project)).find((t) => t.subtask)
  if (!sub) throw new Error(`Project ${project} không có loại Sub-task`)
  return sub
}

// Every non-sub-task issue in my active sprints (+ the picked sprint), parents of my recent sub-tasks first.
// -> { parents: Map(key -> fields), fromSprint, sprintNames }
export async function loadParents(jira, project, sprintIds) {
  const q = (jql) => encodeURIComponent(`project = "${project}" AND ${jql}`)
  const [recent, inSprint] = await Promise.all([
    jira
      .api(`/rest/api/2/search?maxResults=100&fields=parent&jql=${q('assignee = currentUser() AND issuetype in subTaskIssueTypes() ORDER BY updated DESC')}`)
      .then((r) => r.issues),
    sprintIds.length
      ? jira.pages(
          `/rest/api/2/search?fields=summary,status,issuetype&jql=${q(`sprint in (${sprintIds.map(Number).join(',')}) AND issuetype not in subTaskIssueTypes() ORDER BY Rank`)}`,
          'issues',
        )
      : [],
  ])
  const parents = new Map(recent.filter((i) => i.fields.parent).map((i) => [i.fields.parent.key, i.fields.parent.fields]))
  for (const i of inSprint) parents.set(i.key, i.fields) // keeps recent ones first (Map insertion order)
  return { parents, fromSprint: inSprint.length }
}

export const worklogPath = (issue, id) => `/rest/api/2/issue/${encodeURIComponent(issue)}/worklog${id ? `/${encodeURIComponent(id)}` : ''}`
