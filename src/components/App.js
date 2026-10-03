'use client'

import { useEffect, useState } from 'react'
import { Center, Loader } from '@mantine/core'
import { loadSavedCfg, makeJira } from '../lib/jira'
import ConnectForm from './ConnectForm'
import Dashboard from './Dashboard'

// Root: Connect screen or dashboard. envConfigured = .env has URL + token (no Settings screen).
export default function App({ envConfigured, jiraUrl }) {
  const [state, setState] = useState({ screen: 'loading' }) // loading | form | dash
  const connect = (cfg) => makeJira(cfg, envConfigured).api('/rest/api/2/myself')

  useEffect(() => {
    const cfg = envConfigured ? { url: jiraUrl } : loadSavedCfg()
    if (!cfg) return setState({ screen: 'form' })
    connect(cfg).then(
      (me) => setState({ screen: 'dash', cfg, me }),
      (error) => setState(envConfigured ? { screen: 'dash', cfg, me: null, error } : { screen: 'form', draft: cfg, error: error.message }),
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.screen === 'loading')
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    )

  if (state.screen === 'form')
    return (
      <ConnectForm
        draft={state.draft}
        error={state.error}
        connected={!!state.back}
        onConnect={async (cfg) => setState({ screen: 'dash', cfg, me: await connect(cfg) })}
        onCancel={() => setState(state.back)}
        onDisconnect={() => setState({ screen: 'form' })}
      />
    )

  return (
    <Dashboard
      key={state.cfg.url + (state.cfg.token ?? '')}
      cfg={state.cfg}
      envMode={envConfigured}
      me={state.me}
      meError={state.error}
      onSettings={() => setState({ screen: 'form', draft: state.cfg, back: state })}
    />
  )
}
