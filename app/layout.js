import '../src/style.css'

export const metadata = { title: 'Jira Personal Dashboard' }

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  )
}
