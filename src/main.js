import './style.css'

const KEY = 'jira-personal-dashboard:config'
const ENV_MODE = __ENV_CONFIGURED__ // .env has URL + token: no Settings screen
const loadSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY))
  } catch {
    return null
  }
}
let cfg = ENV_MODE ? { url: __JIRA_URL__ } : loadSaved() // { url, token? }

const app = document.querySelector('#app')
const $ = (sel) => document.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('vi-VN') : '')
const jqlLink = (jql) => `${cfg.url}/issues/?jql=${encodeURIComponent(forSubject(jql))}`
const host = () => {
  try {
    return new URL(cfg.url).host
  } catch {
    return cfg.url
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  if (!ENV_MODE) Object.assign(headers, { 'X-Jira-Url': cfg.url, 'X-Jira-Token': cfg.token })
  const r = await fetch('/jira' + path, { method, headers, body: body && JSON.stringify(body) })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? null : r.json()
}

const FIELDS = 'summary,status,priority,issuetype,assignee,duedate,updated,project'
// Member being viewed ({ name, displayName }); null = the connected user.
let subject = null
const forSubject = (jql) => (subject ? jql.replaceAll('currentUser()', `"${subject.name.replace(/["\\]/g, '\\$&')}"`) : jql)
const search = (jql, max = 50, extraFields = '') =>
  api(`/rest/api/2/search?maxResults=${max}&fields=${FIELDS}${extraFields}&jql=${encodeURIComponent(forSubject(jql))}`)

// Edit freely: [title, JQL, card color]
const SECTIONS = [
  ['Đang làm', 'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC', 'c-blue'],
  ['To do', 'assignee = currentUser() AND statusCategory = "To Do" ORDER BY priority DESC, updated DESC', ''],
  ['Bugs', 'assignee = currentUser() AND issuetype = Bug AND statusCategory != Done ORDER BY priority DESC', 'c-red'],
  ['Quá hạn', 'assignee = currentUser() AND statusCategory != Done AND duedate < startOfDay() ORDER BY duedate', 'c-amber'],
  ['Đã report', 'reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC', ''],
  ['Đang watch', 'watcher = currentUser() AND statusCategory != Done ORDER BY updated DESC', 'c-sky'],
  // ponytail: workflow doesn't set resolution & DC lacks statusCategoryChangedDate, so "updated" approximates done-date
  ['Xong 14 ngày qua', 'assignee = currentUser() AND statusCategory = Done AND updated >= -14d ORDER BY updated DESC', 'c-green'],
]

// ---- Client-side filters (like gitlab-pipelines-viewer's filter bar) ----
const filters = { search: '', status: '', project: '', type: '' }
const assigneeName = (f) => f.assignee?.displayName ?? 'Unassigned'
const matches = ({ key, fields: f }) => {
  const q = filters.search.trim().toLowerCase()
  return (
    (!filters.status || f.status?.statusCategory?.key === filters.status) &&
    (!filters.project || f.project?.key === filters.project) &&
    (!filters.type || f.issuetype?.name === filters.type) &&
    (!q || key.toLowerCase().includes(q) || String(f.summary).toLowerCase().includes(q))
  )
}

function table(all) {
  if (!all.length) return '<p class="empty">Không có issue.</p>'
  const issues = all.filter(matches)
  if (!issues.length) return '<p class="empty">Không có issue khớp bộ lọc.</p>'
  const today = new Date().toLocaleDateString('sv') // YYYY-MM-DD local
  return `<table><thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Type</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Updated</th></tr></thead><tbody>${issues
    .map(({ key, fields: f }) => {
      const cat = f.status?.statusCategory?.key
      const overdue = f.duedate && cat !== 'done' && f.duedate < today
      return `<tr>
        <td class="key"><a href="${esc(cfg.url)}/browse/${esc(key)}" target="_blank" rel="noopener">${esc(key)}</a></td>
        <td>${esc(f.summary)}</td>
        <td><span class="badge st-${esc(cat)}">${esc(f.status?.name)}</span></td>
        <td>${esc(f.issuetype?.name)}</td>
        <td class="dim">${esc(assigneeName(f))}</td>
        <td>${esc(f.priority?.name)}</td>
        <td class="dim ${overdue ? 'overdue' : ''}">${fmtDate(f.duedate)}</td>
        <td class="dim">${fmtDate(f.updated)}</td>
      </tr>`
    })
    .join('')}</tbody></table>`
}

// Sprint field is a custom field; value is an object (newer DC) or a "...Sprint@x[id=1,state=ACTIVE,name=..]" string (older).
const parseSprint = (s) =>
  typeof s === 'string' ? Object.fromEntries([...s.matchAll(/(\w+)=([^,\]]*)/g)].map((m) => [m[1], m[2]])) : s

let sprintField // custom field id, resolved once (null = no Jira Software)
let pickedSprint = '' // sprint id; '' = active sprints
let sprintList = [] // sprints the viewed member has issues in
const sprintState = (sp) => String(sp.state).toUpperCase()
const STATE_RANK = { ACTIVE: 0, FUTURE: 1, CLOSED: 2 }

async function sprints() {
  if (sprintField === undefined)
    sprintField = (await api('/rest/api/2/field')).find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id ?? null
  const sf = sprintField
  if (!sf) return { issues: [], render: () => '<p class="empty">Không thấy field Sprint (Jira Software?).</p>' }
  const sprintsOf = (i) => [].concat(i.fields[sf] ?? []).map(parseSprint)
  const picked = pickedSprint
  const [res, hist] = await Promise.all([
    search(`assignee = currentUser() AND ${picked ? `sprint = ${Number(picked)}` : 'sprint in openSprints()'} ORDER BY Rank`, 200, ',' + sf),
    // ponytail: list built from the 200 latest-updated issues; older sprints drop off
    search('assignee = currentUser() AND sprint is not EMPTY ORDER BY updated DESC', 200, ',' + sf),
  ])
  const known = new Map()
  for (const i of [...hist.issues, ...res.issues]) for (const sp of sprintsOf(i)) known.set(String(sp.id), sp)
  sprintList = [...known.values()].sort(
    (x, y) => (STATE_RANK[sprintState(x)] ?? 3) - (STATE_RANK[sprintState(y)] ?? 3) || (Date.parse(y.startDate) || 0) - (Date.parse(x.startDate) || 0),
  )

  const groups = new Map()
  for (const i of res.issues)
    for (const sp of sprintsOf(i)) {
      if (picked ? String(sp.id) !== picked : sprintState(sp) !== 'ACTIVE') continue
      if (!groups.has(String(sp.id))) groups.set(String(sp.id), { ...sp, issues: [] })
      groups.get(String(sp.id)).issues.push(i)
    }
  if (!groups.size)
    return { issues: [], render: () => `<p class="empty">${picked ? 'Không có issue trong sprint này.' : 'Không có sprint active.'}</p>` }
  const render = () => [...groups.values()]
    .map((g) => {
      const done = g.issues.filter((i) => i.fields.status?.statusCategory?.key === 'done').length
      const pct = Math.round((done / g.issues.length) * 100)
      const end = Date.parse(g.endDate)
      const start = Date.parse(g.startDate)
      const when =
        sprintState(g) === 'CLOSED' ? (isNaN(end) ? ' · Đã đóng' : ` · Đã đóng (${fmtDate(end)})`)
        : sprintState(g) === 'FUTURE' ? (isNaN(start) ? ' · Sắp tới' : ` · Bắt đầu ${fmtDate(start)}`)
        : isNaN(end) ? '' : ` · Còn ${Math.max(0, Math.ceil((end - Date.now()) / 864e5))} ngày (${fmtDate(end)})`
      return `<div class="sprint">
        <div class="sprint-head">
          <div><b>${esc(g.name)}</b> <span class="muted">${esc(when)} · ${done}/${g.issues.length} xong (${pct}%)</span></div>
          <div class="bar"><div style="width:${pct}%"></div></div>
        </div>
        ${table(g.issues)}
      </div>`
    })
    .join('')
  return { issues: res.issues, render }
}

function fillSprintPick() {
  const opts = sprintList.map((sp) => [String(sp.id), `${sp.name} (${sprintState(sp).toLowerCase()})`])
  if (pickedSprint && !opts.some(([v]) => v === pickedSprint)) opts.push([pickedSprint, `Sprint #${pickedSprint}`])
  set('#sprint-pick', [['', 'Sprint đang active'], ...opts].map(([v, l]) => `<option value="${esc(v)}" ${v === pickedSprint ? 'selected' : ''}>${esc(l)}</option>`).join(''))
}

// Only the latest request writes the section (auto refresh and a pick change can overlap).
let sprintReq = 0
function loadSprint(live) {
  const n = ++sprintReq
  const ok = () => n === sprintReq && live()
  return sprints().then(
    (v) => {
      if (!ok()) return
      show('#sprint', v)
      fillSprintPick()
    },
    (e) => ok() && show('#sprint', { issues: [], render: () => errBox(e) }),
  )
}

// ---- Performance: weekly tasks / estimates / worklogs of the viewed member ----
// Range: 'w8' = 8 weeks, 'd14' = 14 days
const PERF_RANGES = [['w4', '4 tuần'], ['w8', '8 tuần'], ['w12', '12 tuần'], ['d7', '7 ngày'], ['d14', '14 ngày'], ['d30', '30 ngày']]
let perfRange = 'w8'
let perfOpen = '' // expanded period (its start as YYYY-MM-DD)
let perfData = null
const ymd = (d) => new Date(d).toLocaleDateString('sv')
const mondayOf = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const ddmm = (d) => { const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}` }
const hrs = (s) => (s ? `${+(s / 3600).toFixed(1)}h` : '-')
const PERF_FIELDS = 'summary,status,issuetype,timeoriginalestimate,timespent,created,updated'
// Every page of a search / an issue's worklogs, so no logged task is ever dropped.
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
// Resolution isn't set by this workflow, so "done at" = last status change (fallback: updated).
const doneAt = (i) =>
  (i.changelog?.histories ?? []).filter((h) => h.items.some((it) => it.field === 'status')).map((h) => h.created).sort().at(-1) ?? i.fields.updated

const dayOf = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

let perfView = 'cal' // 'cal' (default) | 'list'
let perfBacklog = [] // calendar sidebar: assigned tasks nobody has logged time on yet
const BACKLOG_JQL = 'assignee = currentUser() AND timespent is EMPTY AND (statusCategory != Done OR updated >= -30d) ORDER BY updated DESC'
let perfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1) // calendar month (1st day)

// Periods to load: list = range dropdown; calendar = full Mon–Sun weeks covering perfMonth.
function perfSpec() {
  if (perfView === 'cal') {
    const first = mondayOf(perfMonth)
    const last = new Date(perfMonth.getFullYear(), perfMonth.getMonth() + 1, 0)
    const count = Math.ceil((Math.round((last - first) / 864e5) + 1) / 7) * 7
    return { first, step: 1, count, startOf: dayOf }
  }
  const byDay = perfRange[0] === 'd'
  const count = Number(perfRange.slice(1))
  const step = byDay ? 1 : 7
  const startOf = byDay ? dayOf : mondayOf
  const first = startOf(Date.now())
  first.setDate(first.getDate() - step * (count - 1))
  return { first, step, count, startOf }
}

// Returns periods oldest first: { key, start, days, created, done[], logs: Map(key -> { issue, seconds }) }
async function performance({ first, step, count, startOf }) {
  const since = ymd(first)
  const who = subject?.name ?? me?.name
  const [logged, done, created] = await Promise.all([
    searchAll(`worklogAuthor = currentUser() AND worklogDate >= "${since}"`, PERF_FIELDS + ',worklog'),
    searchAll(`assignee = currentUser() AND statusCategory = Done AND updated >= "${since}"`, PERF_FIELDS, 'changelog'),
    searchAll(`assignee = currentUser() AND created >= "${since}"`, 'created'),
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
      const worklogs = wl.total > wl.worklogs.length ? await pages(`/rest/api/2/issue/${i.key}/worklog`, 'worklogs') : wl.worklogs
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

const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0)
const stats = (w) => {
  const logs = [...w.logs.values()]
  return { w, logs, logged: sum(logs, (e) => e.seconds), est: sum(w.done, (i) => i.fields.timeoriginalestimate), spent: sum(w.done, (i) => i.fields.timespent) }
}

function detailHtml(r, unit) {
  const issues = new Map([...r.logs.map((e) => [e.issue.key, e.issue]), ...r.w.done.map((i) => [i.key, i])])
  if (!issues.size) return `<p class="empty">Không có log / task hoàn thành trong ${unit} này.</p>`
  const doneKeys = new Set(r.w.done.map((i) => i.key))
  return `<table><thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Type</th><th>Estimate</th><th>Logged (${unit})</th><th>Spent (tổng)</th><th>Xong trong ${unit}</th></tr></thead><tbody>${[...issues.values()]
    .map(({ key, fields: f }) => `<tr>
      <td class="key"><a href="${esc(cfg.url)}/browse/${esc(key)}" target="_blank" rel="noopener">${esc(key)}</a></td>
      <td>${esc(f.summary)}</td>
      <td><span class="badge st-${esc(f.status?.statusCategory?.key)}">${esc(f.status?.name)}</span></td>
      <td>${esc(f.issuetype?.name)}</td>
      <td class="dim">${hrs(f.timeoriginalestimate)}</td>
      <td class="dim">${hrs(r.w.logs.get(key)?.seconds)}</td>
      <td class="dim">${hrs(f.timespent)}</td>
      <td>${doneKeys.has(key) ? '✓' : ''}</td>
    </tr>`)
    .join('')}</tbody></table>`
}

function perfHtml(periods) {
  const rows = [...periods].reverse().map(stats) // newest first
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
  return `<table class="perf"><thead><tr><th>${byDay ? 'Ngày' : 'Tuần'}</th><th>Nhận mới</th><th>Hoàn thành</th><th>Estimate (task xong)</th><th>Spent (task xong)</th><th>Logged</th><th>Issues có log</th></tr></thead><tbody>${rows
    .map((r) => {
      const open = perfOpen === r.w.key
      const pct = Math.round((r.logged / max) * 100)
      const weekend = byDay && [0, 6].includes(r.w.start.getDay())
      return `<tr class="${open ? 'open' : ''} ${weekend ? 'weekend' : ''} ${isMissing(r) ? 'missing' : ''}">
        <td class="key"><button class="link" data-week="${r.w.key}" aria-expanded="${open}">${open ? '▾' : '▸'} ${range(r.w)}</button>${isMissing(r) ? ' <span class="miss">⚠ Chưa log</span>' : ''}</td>
        <td>${r.w.created}</td>
        <td>${r.w.done.length}</td>
        <td class="dim">${hrs(r.est)}</td>
        <td class="dim">${hrs(r.spent)}</td>
        <td title="Logged ${hrs(r.logged)} · ${range(r.w)}"><span class="pbar"><span style="width:${pct}%"></span></span>${hrs(r.logged)}</td>
        <td>${r.logs.length}</td>
      </tr>${open ? `<tr class="detail"><td colspan="7">${detailHtml(r, unit)}</td></tr>` : ''}`
    })
    .join('')}</tbody><tfoot><tr>
      <td>Tổng ${rows.length} ${unit}</td><td>${total((r) => r.w.created)}</td><td>${total((r) => r.w.done.length)}</td>
      <td>${hrs(total((r) => r.est))}</td><td>${hrs(total((r) => r.spent))}</td><td>${hrs(total((r) => r.logged))}</td><td></td>
    </tr></tfoot></table>`
}

// Month grid; cell shade = logged hours (one hue, light -> dark).
const LEVELS = [[0, 'Không log'], [1, '< 4h'], [2, '4–8h'], [3, '≥ 8h']]
const level = (s) => (!s ? 0 : s < 4 * 3600 ? 1 : s < 8 * 3600 ? 2 : 3)
// Past/today weekday with no worklog, no completed and no new task.
const isMissing = (r) => r.w.days === 1 && ![0, 6].includes(r.w.start.getDay()) && r.w.key <= ymd(Date.now()) && !r.logs.length && !r.w.done.length && !r.w.created

function calHtml(days) {
  const month = perfMonth.getMonth()
  const today = ymd(Date.now())
  const rows = days.map(stats)
  const inMonth = rows.filter((r) => r.w.start.getMonth() === month)
  const sel = rows.find((r) => r.w.key === perfOpen)
  const cell = (r) => {
    const out = r.w.start.getMonth() !== month
    const future = r.w.key > today
    const tip = `${ddmm(r.w.start)}: logged ${hrs(r.logged)} · ${r.logs.length} issue · hoàn thành ${r.w.done.length} · nhận mới ${r.w.created}`
    const chips = r.logs
      .flatMap((e) =>
        e.worklogs.map(
          (w) => `<div class="chip" draggable="true" data-issue="${esc(e.issue.key)}" data-wl="${esc(w.id)}" data-started="${esc(w.started)}" data-secs="${w.timeSpentSeconds}"
            title="${esc(`${e.issue.key} ${e.issue.fields.summary} · ${hrs(w.timeSpentSeconds)} — kéo sang ngày khác để đổi ngày log`)}">
            <span class="cs">${esc(e.issue.key.split('-').pop())} ${esc(e.issue.fields.summary)}</span><span class="ch">${hrs(w.timeSpentSeconds)}</span>
          </div>`,
        ),
      )
      .join('')
    const weekend = [0, 6].includes(r.w.start.getDay())
    const missing = isMissing(r)
    return `<div class="day lv${level(r.logged)} ${weekend ? 'weekend' : ''} ${missing ? 'missing' : ''} ${out ? 'out' : ''} ${future ? 'future' : ''} ${r.w.key === today ? 'today' : ''} ${r === sel ? 'sel' : ''}" data-week="${r.w.key}" title="${esc(tip)}">
      <div class="dhead"><button class="dn" data-week="${r.w.key}" aria-pressed="${r === sel}" aria-label="${esc(tip)}">${r.w.start.getDate()}</button><span class="dh">${r.logged ? hrs(r.logged) : ''}</span></div>
      <div class="chips">${chips}${missing ? '<span class="miss">⚠ Chưa log</span>' : ''}</div>
      <span class="dm">${r.w.done.length ? `✓${r.w.done.length}` : ''} ${r.w.created ? `+${r.w.created}` : ''}</span>
    </div>`
  }
  return `<div class="cal-bar">
      <div class="cal-nav">
        <button data-month="-1" aria-label="Tháng trước">‹</button>
        <b>Tháng ${month + 1}/${perfMonth.getFullYear()}</b>
        <button data-month="1" aria-label="Tháng sau">›</button>
        <button data-month="0">Tháng này</button>
      </div>
      <span class="muted">Logged ${hrs(sum(inMonth, (r) => r.logged))} · Hoàn thành ${sum(inMonth, (r) => r.w.done.length)} · Nhận mới ${sum(inMonth, (r) => r.w.created)}</span>
      <span class="cal-legend">${LEVELS.map(([l, t]) => `<span><i class="lv${l}"></i>${t}</span>`).join('')}<span><i class="missing"></i>Chưa có task / log</span><span><i class="weekend"></i>T7, CN</span><span>✓ hoàn thành · + nhận mới</span></span>
    </div>
    <div class="cal-wrap">${backlogHtml()}<div class="cal">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d, k) => `<div class="dow ${k > 4 ? 'weekend' : ''}">${d}</div>`).join('')}${rows.map(cell).join('')}</div></div>
    ${sel ? `<div class="cal-detail"><b>${sel.w.start.toLocaleDateString('vi-VN', { weekday: 'long' })}, ${ddmm(sel.w.start)}</b> <span class="muted">Logged ${hrs(sel.logged)}</span>${detailHtml(sel, 'ngày')}</div>` : ''}`
}

// Sidebar: drag a task onto a day to log work on it (logs are created as the connected user).
function backlogHtml() {
  if (subject) return `<aside class="backlog"><b>Chưa logwork</b><p class="muted">Chỉ log work được cho chính bạn. Bỏ chọn member để dùng.</p></aside>`
  const items = perfBacklog
    .map(({ key, fields: f }) => {
      const est = f.timeestimate ?? f.timeoriginalestimate ?? ''
      return `<div class="todo" draggable="true" data-issue="${esc(key)}" data-est="${esc(est)}" title="${esc(`${key} ${f.summary} — kéo vào một ngày để log work`)}">
        <div class="todo-top"><a href="${esc(cfg.url)}/browse/${esc(key)}" target="_blank" rel="noopener" draggable="false">${esc(key)}</a><span class="ch">${est ? hrs(+est) : ''}</span></div>
        <div class="todo-sum">${esc(f.summary)}</div>
        <span class="badge st-${esc(f.status?.statusCategory?.key)}">${esc(f.status?.name)}</span>
      </div>`
    })
    .join('')
  return `<aside class="backlog"><b>Chưa logwork <span class="muted">${perfBacklog.length}</span></b>
    <p class="muted">Kéo task vào ô ngày để log work.</p>${items || '<p class="empty">Task nào cũng đã có log.</p>'}</aside>`
}

// "8h", "1.5", "1,5h", "30m" -> seconds (NaN if unreadable)
const parseDuration = (v) => {
  const m = String(v).trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(h|m)?$/)
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * (m[2] === 'm' ? 60 : 3600)) : NaN
}
// Jira wants e.g. 2026-10-02T09:00:00.000+0700
const tzOffset = () => {
  const o = -new Date().getTimezoneOffset()
  return `${o < 0 ? '-' : '+'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}${String(Math.abs(o) % 60).padStart(2, '0')}`
}

async function logWork({ issue, est }, day) {
  const v = prompt(`Log work cho ${issue} ngày ${ddmm(day)}\nSố giờ (vd 8h, 1.5h, 30m):`, est ? hrs(+est) : '8h')
  if (v === null) return
  const secs = parseDuration(v)
  if (!(secs > 0)) return alert(`Số giờ không hợp lệ: ${v}`)
  set('#perf', loadingBox)
  try {
    await api(`/rest/api/2/issue/${encodeURIComponent(issue)}/worklog`, {
      method: 'POST',
      body: { started: `${day}T09:00:00.000${tzOffset()}`, timeSpentSeconds: secs },
    })
    perfOpen = day
  } catch (err) {
    alert(`Không log work được: ${err.message}`)
  }
  const g = gen
  loadPerf(() => g === gen)
}

// Drag a worklog chip onto another day: same time of day and offset, new date (after confirm).
async function moveWorklog({ issue, wl, started, secs }, to) {
  const from = started.slice(0, 10) // ponytail: date in the worklog's own offset; assumes it matches the browser's
  if (from === to) return
  if (!confirm(`Chuyển worklog ${hrs(+secs)} của ${issue} từ ${ddmm(from)} sang ${ddmm(to)}?`)) return
  set('#perf', loadingBox)
  try {
    await api(`/rest/api/2/issue/${encodeURIComponent(issue)}/worklog/${encodeURIComponent(wl)}?adjustEstimate=leave`, {
      method: 'PUT',
      body: { started: to + started.slice(10), timeSpentSeconds: Number(secs) },
    })
    perfOpen = to
  } catch (err) {
    alert(`Không chuyển được worklog: ${err.message}`)
  }
  const g = gen
  loadPerf(() => g === gen)
}

const renderPerf = () => set('#perf', perfView === 'cal' ? calHtml(perfData) : perfHtml(perfData))

let perfReq = 0
function loadPerf(live) {
  const n = ++perfReq
  const ok = () => n === perfReq && live()
  return Promise.all([performance(perfSpec()), perfView === 'cal' && !subject ? searchAll(BACKLOG_JQL, PERF_FIELDS) : []]).then(
    ([periods, backlog]) => {
      if (!ok()) return
      perfData = periods
      perfBacklog = backlog
      renderPerf()
    },
    (e) => ok() && set('#perf', errBox(e)),
  )
}

const errBox = (e) => `<p class="error">${esc(e.message)}</p>`
const loadingBox = '<p class="empty">Đang tải…</p>'
const set = (sel, html) => {
  const el = $(sel)
  if (el) el.innerHTML = html
}

// Assignable users of every project seen in loaded issues (full member list, not just current assignees).
let members = [] // { name, displayName }
let me = null // connected user; listed first in the member suggestions
let memberProjects = ''
async function loadMembers() {
  const keys = [...new Set([...views.values()].flatMap((v) => v.issues.map((i) => i.fields.project?.key)).filter(Boolean))].sort().join(',')
  if (!keys || keys === memberProjects) return
  const users = await api(`/rest/api/2/user/assignable/multiProjectSearch?maxResults=1000&projectKeys=${encodeURIComponent(keys)}`)
  memberProjects = keys
  members = users.map(({ name, displayName }) => ({ name, displayName }))
}

// Last loaded data per section body, so filters re-render without refetching.
const views = new Map() // selector -> { issues, render }
const show = (sel, view) => {
  views.set(sel, view)
  set(sel, view.render())
}
function rerender() {
  for (const [sel, v] of views) set(sel, v.render())
}
function fillOptions() {
  const all = [...views.values()].flatMap((v) => v.issues)
  const fill = (sel, label, values) => {
    const el = $(sel)
    if (!el) return
    const cur = filters[el.dataset.f] // source of truth survives shell re-render
    const opts = [...new Set([...values, cur].filter(Boolean))].sort()
    el.innerHTML = `<option value="">${label}: All</option>` + opts.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')
  }
  fill('#f-project', 'Project', all.map((i) => i.fields.project?.key))
  fill('#f-type', 'Type', all.map((i) => i.fields.issuetype?.name))
  const seen = new Map([...members, ...all.map((i) => i.fields.assignee).filter(Boolean)].map((u) => [u.name, u]))
  if (me) seen.delete(me.name)
  const list = [...(me ? [me] : []), ...[...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))]
  set('#members', list.map((u) => `<option value="${esc(u.displayName)}" label="${esc(u.name)}">`).join(''))
}

// ---- Auto refresh (same options as gitlab-pipelines-viewer) ----
const INTERVALS = [['Off', 0], ['10s', 10_000], ['30s', 30_000], ['60s', 60_000], ['5m', 300_000]]
let autoMs = 30_000
let loading = false
let lastUpdated = 0

// Updates sections in place, so old data stays visible while reloading.
// `gen` changes when the dashboard is rebuilt (e.g. another member picked): stale responses are dropped.
let gen = 0
async function refresh() {
  if (loading) return
  const g = gen
  const live = () => g === gen
  loading = true
  $('#refresh').disabled = true
  set('#next', '')
  await Promise.allSettled([
    loadSprint(live),
    loadPerf(live),
    ...SECTIONS.map(([, jql], k) =>
      search(jql).then(
        (r) => {
          if (!live()) return
          set(`#n${k}`, r.total)
          const more = r.total > r.issues.length ? `<p class="muted pad">Hiển thị ${r.issues.length}/${r.total}.</p>` : ''
          show(`#b${k}`, { issues: r.issues, render: () => table(r.issues) + more })
        },
        (e) => {
          if (!live()) return
          set(`#n${k}`, '!')
          show(`#b${k}`, { issues: [], render: () => errBox(e) })
        },
      ),
    ),
  ])
  if (!live()) return // a newer refresh owns the page now
  loading = false
  lastUpdated = Date.now()
  await loadMembers().catch(() => {}) // fall back to names from loaded issues
  fillOptions()
  if (!$('#refresh')) return // left the dashboard meanwhile
  $('#refresh').disabled = false
  const t = new Date(lastUpdated).toLocaleTimeString()
  set('#updated', t)
  set('footer', `${esc(host())} · Last updated ${t}`)
}

setInterval(() => {
  if (!$('#next') || !autoMs || loading || !lastUpdated) return
  const left = Math.ceil((lastUpdated + autoMs - Date.now()) / 1000)
  if (left <= 0) refresh()
  else set('#next', `Next refresh: ${left}s`)
}, 1000)

// ---- Screens ----
function showDashboard(user, err) {
  me = user
  gen++
  loading = false
  app.innerHTML = `<main>
    <header>
      <div>
        <h1>Jira Personal Dashboard</h1>
        ${me ? `<p class="ok">● Connected: ${esc(me.name)} <span class="muted">(${esc(me.displayName)})</span></p>` : `<p class="bad">✕ ${esc(err?.message)}</p>`}
        <p class="meta">Jira: ${esc(host())} · Last Updated: <span id="updated">-</span></p>
      </div>
      <div class="actions">
        <input id="member" type="search" list="members" aria-label="Member" placeholder="👤 Member: ${esc(me?.displayName ?? 'me')}" value="${esc(subject?.displayName)}">
        <datalist id="members"></datalist>
        <label class="auto">Auto Refresh
          <select id="auto">${INTERVALS.map(([l, v]) => `<option value="${v}" ${v === autoMs ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <span id="next" class="muted"></span>
        <button id="refresh">Refresh ↻</button>
        ${ENV_MODE ? '' : '<button id="settings">⚙ Settings</button>'}
      </div>
    </header>
    <div class="cards">${SECTIONS.map(([t, , c], k) => `<a class="card" href="#s${k}"><div class="label">${esc(t)}</div><div class="value ${c}" id="n${k}">…</div></a>`).join('')}</div>
    <section id="perf-sec"><h2>Performance
      <span class="seg" role="group" aria-label="Kiểu xem">${[['list', 'List'], ['cal', 'Calendar']].map(([v, l]) => `<button data-view="${v}" aria-pressed="${v === perfView}">${l}</button>`).join('')}</span>
      <select id="perf-range" aria-label="Khoảng thời gian" ${perfView === 'cal' ? 'hidden' : ''}>${PERF_RANGES.map(([v, l]) => `<option value="${v}" ${v === perfRange ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted">Task xong = lần đổi status cuối · Logged = worklog của chính member</span></h2><div class="body" id="perf">${loadingBox}</div></section>
    <div class="filters">
      <input id="f-search" data-f="search" type="search" placeholder="🔎 Search key, summary..." value="${esc(filters.search)}">
      <select data-f="status" aria-label="Status">${[['', 'Status: All'], ['new', 'To Do'], ['indeterminate', 'In Progress'], ['done', 'Done']]
        .map(([v, l]) => `<option value="${v}" ${v === filters.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="f-project" data-f="project" aria-label="Project"><option value="">Project: All</option></select>
      <select id="f-type" data-f="type" aria-label="Type"><option value="">Type: All</option></select>
      <button id="f-clear">Clear</button>
    </div>
    <section><h2>Sprint <select id="sprint-pick" aria-label="Sprint"><option value="">Sprint đang active</option></select></h2><div class="body" id="sprint">${loadingBox}</div></section>
    ${SECTIONS.map(([t, jql], k) => `<section id="s${k}"><h2>${esc(t)}<a href="${esc(jqlLink(jql))}" target="_blank" rel="noopener">Mở trong Jira ↗</a></h2><div class="body" id="b${k}">${loadingBox}</div></section>`).join('')}
    <footer></footer>
  </main>`
  $('#refresh').onclick = refresh
  $('#auto').onchange = (e) => (autoMs = Number(e.target.value))
  $('.filters').oninput = (e) => {
    filters[e.target.dataset.f] = e.target.value
    rerender()
  }
  $('#f-clear').onclick = () => {
    Object.keys(filters).forEach((k) => (filters[k] = ''))
    document.querySelectorAll('[data-f]').forEach((el) => (el.value = ''))
    rerender()
  }
  // Picking a member reloads the whole dashboard for them; partial text = still typing.
  $('#member').oninput = (e) => {
    const v = e.target.value.trim()
    const all = [...(me ? [me] : []), ...members]
    const u = v ? all.find((m) => m.displayName === v || m.name === v) : null
    if (v && !u) return
    const next = u && u.name !== me?.name ? u : null
    if ((next?.name ?? null) === (subject?.name ?? null)) return
    subject = next
    pickedSprint = '' // sprints differ per member
    perfOpen = ''
    showDashboard(me)
  }
  $('#perf-range').onchange = (e) => {
    perfRange = e.target.value
    perfOpen = ''
    set('#perf', loadingBox)
    const g = gen
    loadPerf(() => g === gen)
  }
  let dragged = null // dataset of the chip being dragged
  const clearDrop = () => document.querySelectorAll('.day.drop').forEach((d) => d.classList.remove('drop'))
  const sec = $('#perf-sec')
  sec.ondragstart = (e) => {
    const c = e.target.closest?.('.chip, .todo')
    if (!c) return
    dragged = { ...c.dataset }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${c.dataset.issue} worklog ${c.dataset.wl}`)
  }
  sec.ondragover = (e) => {
    const d = dragged && e.target.closest('.day')
    if (!d) return
    e.preventDefault()
    if (!d.classList.contains('drop')) {
      clearDrop()
      d.classList.add('drop')
    }
  }
  sec.ondrop = (e) => {
    const d = dragged && e.target.closest('.day')
    if (!d) return
    e.preventDefault()
    const chip = dragged
    dragged = null
    clearDrop()
    if (chip.wl) moveWorklog(chip, d.dataset.week)
    else logWork(chip, d.dataset.week)
  }
  sec.ondragend = () => {
    dragged = null
    clearDrop()
  }
  $('#perf-sec').onclick = (e) => {
    const b = e.target.closest('[data-week],[data-month],[data-view]')
    if (!b) return
    const reload = () => {
      perfOpen = ''
      set('#perf', loadingBox)
      const g = gen
      loadPerf(() => g === gen)
    }
    if (b.dataset.view) {
      if (b.dataset.view === perfView) return
      perfView = b.dataset.view
      document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.view === perfView))
      $('#perf-range').hidden = perfView === 'cal'
      return reload()
    }
    if (b.dataset.month) {
      const d = Number(b.dataset.month)
      const now = new Date()
      perfMonth = d ? new Date(perfMonth.getFullYear(), perfMonth.getMonth() + d, 1) : new Date(now.getFullYear(), now.getMonth(), 1)
      return reload()
    }
    if (!perfData) return
    perfOpen = perfOpen === b.dataset.week ? '' : b.dataset.week
    renderPerf()
  }
  $('#sprint-pick').onchange = (e) => {
    pickedSprint = e.target.value
    set('#sprint', loadingBox)
    const g = gen
    loadSprint(() => g === gen)
  }
  views.clear()
  if (!ENV_MODE) $('#settings').onclick = () => showForm('', true)
  lastUpdated = 0
  refresh()
}

const REMEMBER_NOTE = ' Remember lưu token dạng plain text trong localStorage.'

function showForm(error = '', connected = false, draft = cfg) {
  const remembered = !!localStorage.getItem(KEY)
  app.innerHTML = `<div class="center"><form class="login">
    <h1>Jira Personal Dashboard</h1>
    <label><span class="label">Jira URL</span>
      <input name="url" type="url" required placeholder="https://jira.company.com" value="${esc(draft?.url)}"></label>
    <label><span class="label">Personal Access Token</span>
      <input name="token" type="password" required autocomplete="off" value="${esc(draft?.token)}"></label>
    <label class="check"><input name="remember" type="checkbox" ${remembered ? 'checked' : ''}> Remember configuration on this browser</label>
    <p class="warn">Token được gửi từ trình duyệt qua Vite dev server tới Jira. Muốn token không nằm trong trình duyệt thì đặt JIRA_URL / JIRA_TOKEN trong .env.<span id="note">${remembered ? REMEMBER_NOTE : ''}</span></p>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <div class="row">
      <button class="primary" type="submit">Connect to Jira</button>
      ${connected ? '<button type="button" id="cancel">Cancel</button>' : ''}
    </div>
    ${connected ? '<button type="button" id="disconnect" class="danger">Disconnect / Clear Token</button>' : ''}
  </form></div>`
  const form = $('form')
  form.remember.onchange = (e) => set('#note', e.target.checked ? REMEMBER_NOTE : '')
  if (connected) {
    $('#cancel').onclick = start
    $('#disconnect').onclick = () => {
      localStorage.removeItem(KEY)
      sessionStorage.removeItem(KEY)
      cfg = null
      showForm()
    }
  }
  form.onsubmit = async (e) => {
    e.preventDefault()
    const prev = cfg
    const tried = { url: form.url.value.trim().replace(/\/+$/, ''), token: form.token.value.trim() }
    const btn = form.querySelector('.primary')
    btn.disabled = true
    btn.textContent = 'Connecting...'
    cfg = tried
    try {
      const me = await api('/rest/api/2/myself')
      localStorage.removeItem(KEY)
      sessionStorage.removeItem(KEY)
      ;(form.remember.checked ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(cfg))
      showDashboard(me)
    } catch (err) {
      cfg = prev
      showForm(err.message, connected, tried)
    }
  }
}

async function start() {
  if (!cfg) return showForm()
  try {
    showDashboard(await api('/rest/api/2/myself'))
  } catch (e) {
    if (ENV_MODE) showDashboard(null, e)
    else showForm(e.message)
  }
}

start()
