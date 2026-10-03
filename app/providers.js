'use client'

import { Anchor, createTheme, MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'

const theme = createTheme({
  primaryColor: 'orange',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  defaultRadius: 'md',
  components: { Anchor: Anchor.extend({ defaultProps: { c: 'blue.7' } }) }, // links stay blue; orange = actions
})

export default function Providers({ children }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="light">
      <ModalsProvider>
        <Notifications position="top-right" />
        {children}
      </ModalsProvider>
    </MantineProvider>
  )
}
