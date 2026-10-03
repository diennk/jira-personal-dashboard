import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '../src/components/calendar.css'
import { mantineHtmlProps } from '@mantine/core'
import Providers from './providers'

export const metadata = { title: 'Jira Personal Dashboard' }

export default function RootLayout({ children }) {
  return (
    <html lang="vi" {...mantineHtmlProps}>
      <body style={{ background: 'var(--mantine-color-gray-0)' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
