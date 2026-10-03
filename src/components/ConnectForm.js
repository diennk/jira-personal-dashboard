'use client'

import { useState } from 'react'
import { Alert, Button, Center, Checkbox, Group, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core'
import { CFG_KEY } from '../lib/jira'

// Connect / Settings screen. onConnect(cfg) resolves when Jira accepts the token, throws otherwise.
export default function ConnectForm({ draft, error: initialError, connected, onConnect, onCancel, onDisconnect }) {
  const [url, setUrl] = useState(draft?.url ?? '')
  const [token, setToken] = useState(draft?.token ?? '')
  const [remember, setRemember] = useState(() => !!localStorage.getItem(CFG_KEY))
  const [error, setError] = useState(initialError ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const cfg = { url: url.trim().replace(/\/+$/, ''), token: token.trim() }
    setBusy(true)
    setError('')
    try {
      await onConnect(cfg)
      localStorage.removeItem(CFG_KEY)
      sessionStorage.removeItem(CFG_KEY)
      ;(remember ? localStorage : sessionStorage).setItem(CFG_KEY, JSON.stringify(cfg))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Center mih="100vh" p="md">
      <Paper component="form" onSubmit={submit} withBorder shadow="md" radius="lg" p="xl" w="100%" maw={448}>
        <Stack>
          <Title order={3}>Jira Personal Dashboard</Title>
          <TextInput label="Jira URL" type="url" required placeholder="https://jira.company.com" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
          <PasswordInput label="Personal Access Token" required autoComplete="off" value={token} onChange={(e) => setToken(e.currentTarget.value)} />
          <Checkbox label="Remember configuration on this browser" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
          <Alert color="yellow" variant="light" p="xs" fz="xs">
            Token được gửi từ trình duyệt qua API route của Next.js tới Jira. Muốn token không nằm trong trình duyệt thì đặt JIRA_URL / JIRA_TOKEN
            trong .env.{remember && ' Remember lưu token dạng plain text trong localStorage.'}
          </Alert>
          {error && (
            <Alert color="red" variant="light" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </Alert>
          )}
          <Group grow>
            <Button type="submit" loading={busy}>
              Connect to Jira
            </Button>
            {connected && (
              <Button variant="default" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </Group>
          {connected && (
            <Button
              variant="outline"
              color="red"
              onClick={() => {
                localStorage.removeItem(CFG_KEY)
                sessionStorage.removeItem(CFG_KEY)
                onDisconnect()
              }}
            >
              Disconnect / Clear Token
            </Button>
          )}
        </Stack>
      </Paper>
    </Center>
  )
}
