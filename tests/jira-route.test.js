import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { POST } from '../app/api/jira/[...path]/route.js'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function postRequest(path, body) {
  const request = new Request(`https://dashboard.example/api/jira${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://dashboard.example',
      'X-Jira-Token': 'test-token',
      'X-Jira-Url': 'https://jira.example',
    },
    body: JSON.stringify(body),
  })
  request.nextUrl = new URL(request.url)
  return request
}

test('keeps POST method and body across a Jira 302 REST redirect', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: url.toString(), init })
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { Location: '/rest/api/2/issue/' } })
    }
    return Response.json({ key: 'TEST-1' }, { status: 201 })
  }

  const body = { fields: { summary: 'Test' } }
  const response = await POST(postRequest('/rest/api/2/issue', body), {
    params: Promise.resolve({ path: ['rest', 'api', '2', 'issue'] }),
  })

  assert.equal(response.status, 201)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.body, JSON.stringify(body))
  assert.equal(response.headers.get('x-jira-proxy-method'), 'POST')
})

test('rejects redirects to a login page instead of reporting a misleading GET result', async () => {
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: '/login.jsp' } })

  const response = await POST(postRequest('/rest/api/2/issue/TEST-1/worklog', { timeSpentSeconds: 3600 }), {
    params: Promise.resolve({ path: ['rest', 'api', '2', 'issue', 'TEST-1', 'worklog'] }),
  })

  assert.equal(response.status, 502)
  assert.match(await response.text(), /Refused Jira redirect outside its REST API/)
})
