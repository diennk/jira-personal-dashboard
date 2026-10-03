// Jira proxy as a Next.js route: /api/jira/<jira path>?<query> -> <JIRA_URL>/<jira path>?<query>.
// Jira Server/DC sends no CORS headers, so the browser can't call it directly.
// Config: JIRA_URL + JIRA_TOKEN from .env (token never reaches the browser), or, when .env is empty,
// X-Jira-Url / X-Jira-Token sent by the Connect screen.

// ponytail: process-wide TLS off for internal CAs; local tool only
if (process.env.JIRA_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

export const dynamic = 'force-dynamic'

// Reads, plus the only writes the app makes: create an issue, add a worklog (POST), move/edit one (PUT).
const WRITES = {
  POST: [/^\/rest\/api\/2\/issue$/, /^\/rest\/api\/2\/issue\/[^/]+\/worklog$/],
  PUT: [/^\/rest\/api\/2\/issue\/[^/]+\/worklog\/\d+$/],
}

async function proxy(req, { params }) {
  const text = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

  // Same-origin only: blocks other sites in the browser from using this proxy.
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== req.headers.get('host')) return text(403, 'Forbidden origin')

  const path = '/' + (await params).path.map(encodeURIComponent).join('/')
  if (req.method !== 'GET' && !WRITES[req.method]?.some((re) => re.test(path))) return text(405, 'Method not allowed')

  const base = String(req.headers.get('x-jira-url') || process.env.JIRA_URL || '').replace(/\/+$/, '')
  const token = req.headers.get('x-jira-token') || process.env.JIRA_TOKEN
  if (!base || !token) return text(401, 'Jira URL / token not configured')

  const body = req.method === 'GET' ? undefined : await req.text()
  try {
    const r = await fetch(base + path + req.nextUrl.search, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body && { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' }),
      },
      body,
      cache: 'no-store',
    })
    return new Response(r.status === 204 ? null : await r.arrayBuffer(), {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') ?? 'text/plain' },
    })
  } catch (e) {
    return text(502, `Cannot reach ${base}: ${e.cause?.message ?? e.message}`)
  }
}

export { proxy as GET, proxy as POST, proxy as PUT }
