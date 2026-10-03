import App from '../src/components/App'

// Read .env at request time; only "is it configured" and the URL go to the browser, never the token.
export const dynamic = 'force-dynamic'

export default function Page() {
  const url = (process.env.JIRA_URL ?? '').replace(/\/+$/, '')
  return <App envConfigured={!!(url && process.env.JIRA_TOKEN)} jiraUrl={url} />
}
