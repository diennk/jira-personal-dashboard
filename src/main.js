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
const jqlLink = (jql) => `${cfg.url}/issues/?jql=${encodeURIComponent(jql)}`
const host = () => {
  try {
    return new URL(cfg.url).host
  } catch {
    return cfg.url
  }
}

async function api(path) {
  const headers = { Accept: 'application/json' }
  if (!ENV_MODE) Object.assign(headers, { 'X-Jira-Url': cfg.url, 'X-Jira-Token': cfg.token })
  const r = await fetch('/jira' + path, { headers })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

const FIELDS = 'summary,status,priority,issuetype,duedate,updated,project'
const search = (jql, max = 50, extraFields = '') =>
  api(`/rest/api/2/search?maxResults=${max}&fields=${FIELDS}${extraFields}&jql=${encodeURIComponent(jql)}`)

// Edit freely: [title, JQL, card color]
const SECTIONS = [
  ['Đang làm', 'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC', 'c-blue'],
  ['To do', 'assignee = currentUser() AND statusCategory = "To Do" ORDER BY priority DESC, updated DESC', ''],
  ['Bugs của tôi', 'assignee = currentUser() AND issuetype = Bug AND statusCategory != Done ORDER BY priority DESC', 'c-red'],
  ['Quá hạn', 'assignee = currentUser() AND statusCategory != Done AND duedate < startOfDay() ORDER BY duedate', 'c-amber'],
  ['Tôi report', 'reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC', ''],
  ['Đang watch', 'watcher = currentUser() AND statusCategory != Done ORDER BY updated DESC', 'c-sky'],
  // ponytail: workflow doesn't set resolution & DC lacks statusCategoryChangedDate, so "updated" approximates done-date
  ['Xong 14 ngày qua', 'assignee = currentUser() AND statusCategory = Done AND updated >= -14d ORDER BY updated DESC', 'c-green'],
]

// ---- Client-side filters (like gitlab-pipelines-viewer's filter bar) ----
const filters = { search: '', status: '', project: '', type: '' }
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
  return `<table><thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Type</th><th>Priority</th><th>Due</th><th>Updated</th></tr></thead><tbody>${issues
    .map(({ key, fields: f }) => {
      const cat = f.status?.statusCategory?.key
      const overdue = f.duedate && cat !== 'done' && f.duedate < today
      return `<tr>
        <td class="key"><a href="${esc(cfg.url)}/browse/${esc(key)}" target="_blank" rel="noopener">${esc(key)}</a></td>
        <td>${esc(f.summary)}</td>
        <td><span class="badge st-${esc(cat)}">${esc(f.status?.name)}</span></td>
        <td>${esc(f.issuetype?.name)}</td>
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

async function sprints() {
  const sf = (await api('/rest/api/2/field')).find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')
  if (!sf) return { issues: [], render: () => '<p class="empty">Không thấy field Sprint (Jira Software?).</p>' }
  const res = await search('assignee = currentUser() AND sprint in openSprints() ORDER BY Rank', 200, ',' + sf.id)
  const groups = new Map()
  for (const i of res.issues)
    for (const sp of [].concat(i.fields[sf.id] ?? []).map(parseSprint)) {
      if (String(sp.state).toUpperCase() !== 'ACTIVE') continue
      if (!groups.has(String(sp.id))) groups.set(String(sp.id), { ...sp, issues: [] })
      groups.get(String(sp.id)).issues.push(i)
    }
  if (!groups.size) return { issues: [], render: () => '<p class="empty">Không có sprint active.</p>' }
  const render = () => [...groups.values()]
    .map((g) => {
      const done = g.issues.filter((i) => i.fields.status?.statusCategory?.key === 'done').length
      const pct = Math.round((done / g.issues.length) * 100)
      const end = Date.parse(g.endDate)
      const left = isNaN(end) ? '' : ` · Còn ${Math.max(0, Math.ceil((end - Date.now()) / 864e5))} ngày (${fmtDate(end)})`
      return `<div class="sprint">
        <div class="sprint-head">
          <div><b>${esc(g.name)}</b> <span class="muted">${esc(left)} · ${done}/${g.issues.length} xong (${pct}%)</span></div>
          <div class="bar"><div style="width:${pct}%"></div></div>
        </div>
        ${table(g.issues)}
      </div>`
    })
    .join('')
  return { issues: res.issues, render }
}

const errBox = (e) => `<p class="error">${esc(e.message)}</p>`
const loadingBox = '<p class="empty">Đang tải…</p>'
const set = (sel, html) => {
  const el = $(sel)
  if (el) el.innerHTML = html
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
    const cur = el.value
    const opts = [...new Set([...values, cur].filter(Boolean))].sort()
    el.innerHTML = `<option value="">${label}: All</option>` + opts.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')
  }
  fill('#f-project', 'Project', all.map((i) => i.fields.project?.key))
  fill('#f-type', 'Type', all.map((i) => i.fields.issuetype?.name))
}

// ---- Auto refresh (same options as gitlab-pipelines-viewer) ----
const INTERVALS = [['Off', 0], ['10s', 10_000], ['30s', 30_000], ['60s', 60_000], ['5m', 300_000]]
let autoMs = 30_000
let loading = false
let lastUpdated = 0

// Updates sections in place, so old data stays visible while reloading.
async function refresh() {
  if (loading) return
  loading = true
  $('#refresh').disabled = true
  set('#next', '')
  await Promise.allSettled([
    sprints().then((v) => show('#sprint', v), (e) => show('#sprint', { issues: [], render: () => errBox(e) })),
    ...SECTIONS.map(([, jql], k) =>
      search(jql).then(
        (r) => {
          set(`#n${k}`, r.total)
          const more = r.total > r.issues.length ? `<p class="muted pad">Hiển thị ${r.issues.length}/${r.total}.</p>` : ''
          show(`#b${k}`, { issues: r.issues, render: () => table(r.issues) + more })
        },
        (e) => {
          set(`#n${k}`, '!')
          show(`#b${k}`, { issues: [], render: () => errBox(e) })
        },
      ),
    ),
  ])
  loading = false
  lastUpdated = Date.now()
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
function showDashboard(me, err) {
  app.innerHTML = `<main>
    <header>
      <div>
        <h1>Jira Personal Dashboard</h1>
        ${me ? `<p class="ok">● Connected: ${esc(me.name)} <span class="muted">(${esc(me.displayName)})</span></p>` : `<p class="bad">✕ ${esc(err?.message)}</p>`}
        <p class="meta">Jira: ${esc(host())} · Last Updated: <span id="updated">-</span></p>
      </div>
      <div class="actions">
        <label class="auto">Auto Refresh
          <select id="auto">${INTERVALS.map(([l, v]) => `<option value="${v}" ${v === autoMs ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <span id="next" class="muted"></span>
        <button id="refresh">Refresh ↻</button>
        ${ENV_MODE ? '' : '<button id="settings">⚙ Settings</button>'}
      </div>
    </header>
    <div class="cards">${SECTIONS.map(([t, , c], k) => `<a class="card" href="#s${k}"><div class="label">${esc(t)}</div><div class="value ${c}" id="n${k}">…</div></a>`).join('')}</div>
    <div class="filters">
      <input id="f-search" data-f="search" type="search" placeholder="🔎 Search key, summary..." value="${esc(filters.search)}">
      <select data-f="status" aria-label="Status">${[['', 'Status: All'], ['new', 'To Do'], ['indeterminate', 'In Progress'], ['done', 'Done']]
        .map(([v, l]) => `<option value="${v}" ${v === filters.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="f-project" data-f="project" aria-label="Project"><option value="">Project: All</option></select>
      <select id="f-type" data-f="type" aria-label="Type"><option value="">Type: All</option></select>
      <button id="f-clear">Clear</button>
    </div>
    <section><h2>Sprint hiện tại</h2><div class="body" id="sprint">${loadingBox}</div></section>
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
    document.querySelectorAll('.filters [data-f]').forEach((el) => (el.value = ''))
    rerender()
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
