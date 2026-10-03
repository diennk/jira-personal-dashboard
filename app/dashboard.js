'use client'

import { useEffect } from 'react'

// The dashboard UI is plain DOM code (src/main.js); it renders into #app once mounted.
export default function Dashboard({ envConfigured, jiraUrl }) {
  useEffect(() => {
    import('../src/main.js').then((m) => m.boot({ envConfigured, jiraUrl }))
  }, [envConfigured, jiraUrl])
  return <div id="app" />
}
