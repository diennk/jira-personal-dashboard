import { defineConfig, loadEnv } from 'vite'

// Jira Server/DC does not send CORS headers, so the browser calls /jira/* and this
// dev-server middleware forwards it. Config comes from .env (token never reaches the
// browser) or, when .env is empty, from X-Jira-Url / X-Jira-Token sent by the Settings screen.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // ponytail: process-wide TLS off for internal CAs; dev tool only
  if (env.JIRA_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  const handler = async (req, res) => {
    // Same-origin only: blocks other sites in the browser from using this proxy.
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
      res.statusCode = 403
      return res.end('Forbidden origin')
    }
    const base = String(req.headers['x-jira-url'] || env.JIRA_URL || '').replace(/\/+$/, '')
    const token = req.headers['x-jira-token'] || env.JIRA_TOKEN
    if (!base || !token) {
      res.statusCode = 401
      return res.end('Jira URL / token not configured')
    }
    // Reads, plus the only two writes the app makes: add a worklog (POST) and move one (PUT).
    const path = req.url.split('?')[0]
    const allowed =
      req.method === 'GET' ||
      (req.method === 'POST' && /^\/rest\/api\/2\/issue\/[^/]+\/worklog$/.test(path)) ||
      (req.method === 'PUT' && /^\/rest\/api\/2\/issue\/[^/]+\/worklog\/\d+$/.test(path))
    if (!allowed) {
      res.statusCode = 405
      return res.end('Method not allowed')
    }
    try {
      const body =
        req.method !== 'GET'
          ? await new Promise((ok, fail) => {
              const chunks = []
              req.on('data', (c) => chunks.push(c)).on('end', () => ok(Buffer.concat(chunks))).on('error', fail)
            })
          : undefined
      const r = await fetch(base + req.url, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body && { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' }),
        },
        body,
      })
      res.statusCode = r.status
      res.setHeader('Content-Type', r.headers.get('content-type') ?? 'text/plain')
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      res.statusCode = 502
      res.end(`Cannot reach ${base}: ${e.cause?.message ?? e.message}`)
    }
  }

  return {
    define: {
      __ENV_CONFIGURED__: JSON.stringify(!!(env.JIRA_URL && env.JIRA_TOKEN)),
      __JIRA_URL__: JSON.stringify((env.JIRA_URL ?? '').replace(/\/+$/, '')),
    },
    server: { port: Number(env.PORT) || 5190 },
    plugins: [
      {
        name: 'jira-proxy',
        configureServer: (s) => void s.middlewares.use('/jira', handler),
        configurePreviewServer: (s) => void s.middlewares.use('/jira', handler),
      },
    ],
  }
})
