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

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

// Node fetch follows redirects automatically. For 301/302 that can silently turn a POST into a GET,
// which makes a write look successful while Jira only returns the current resource. Follow Jira REST
// redirects ourselves so 301/302/307/308 keep the original method and body.
async function fetchJira(url, init) {
  let current = new URL(url)
  const jiraOrigin = current.origin

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (!REDIRECTS.has(response.status)) return { response, url: current }

    const location = response.headers.get('location')
    if (!location) return { response, url: current }
    if (redirectCount === MAX_REDIRECTS) throw new Error(`Too many Jira redirects (last URL: ${current})`)

    const next = new URL(location, current)
    if (next.origin !== jiraOrigin || !next.pathname.includes('/rest/api/')) {
      throw new Error(`Refused Jira redirect outside its REST API: ${current} -> ${next}`)
    }

    current = next
    if (response.status === 303) {
      init = {
        ...init,
        method: 'GET',
        body: undefined,
        headers: Object.fromEntries(Object.entries(init.headers).filter(([name]) => name.toLowerCase() !== 'content-type')),
      }
    }
  }
}

function isAllowedOrigin(req) {
  const origin = req.headers.get('origin')
  if (!origin) return true

  let originHost = ''
  try {
    originHost = new URL(origin).hostname
  } catch {
    return false
  }

  const hostHeader = (req.headers.get('host') || '').split(',')[0].trim().split(':')[0]
  const forwardedHost = (req.headers.get('x-forwarded-host') || '').split(',')[0].trim().split(':')[0]

  if (originHost === hostHeader || (forwardedHost && originHost === forwardedHost)) {
    return true
  }

  // Internal / container hostnames (e.g. localhost, 127.0.0.1, docker container names like jira-personal-dashboard, private IPs)
  const targetHost = forwardedHost || hostHeader
  const isInternalHost =
    !targetHost ||
    targetHost === 'localhost' ||
    targetHost === '127.0.0.1' ||
    targetHost === '0.0.0.0' ||
    targetHost === '::1' ||
    !targetHost.includes('.') ||
    /^10\./.test(targetHost) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(targetHost) ||
    /^192\.168\./.test(targetHost)

  return isInternalHost
}

async function proxy(req, { params }) {
  const text = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

  // Same-origin only: blocks other sites in the browser from using this proxy.
  if (!isAllowedOrigin(req)) return text(403, 'Forbidden origin')

  const path = '/' + (await params).path.map(encodeURIComponent).join('/')
  if (req.method !== 'GET' && !WRITES[req.method]?.some((re) => re.test(path))) return text(405, 'Method not allowed')

  const base = String(req.headers.get('x-jira-url') || process.env.JIRA_URL || '').replace(/\/+$/, '')
  const token = req.headers.get('x-jira-token') || process.env.JIRA_TOKEN
  if (!base || !token) return text(401, 'Jira URL / token not configured')

  const body = req.method === 'GET' ? undefined : await req.text()
  try {
    const { response: r, url: upstreamUrl } = await fetchJira(base + path + req.nextUrl.search, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(req.method !== 'GET' && {
          'Content-Type': 'application/json',
          'X-Atlassian-Token': 'nocheck',
          'X-Requested-With': 'XMLHttpRequest',
          Origin: base,
          Referer: `${base}/`,
        }),
      },
      body,
      cache: 'no-store',
    })
    return new Response(r.status === 204 ? null : await r.arrayBuffer(), {
      status: r.status,
      headers: {
        'Content-Type': r.headers.get('content-type') ?? 'text/plain',
        'X-Jira-Proxy-Method': req.method,
        'X-Jira-Upstream-Url': upstreamUrl.toString(),
      },
    })
  } catch (e) {
    return text(502, `Cannot reach ${base}: ${e.cause?.message ?? e.message}`)
  }
}

export { proxy as GET, proxy as POST, proxy as PUT }
