'use client'

import { Anchor, Badge, Table, Text } from '@mantine/core'
import { fmtDate, ymd } from '../lib/format'

const CATEGORY_COLOR = { new: 'gray', indeterminate: 'blue', done: 'teal' }

export function StatusBadge({ status, size = 'sm' }) {
  return (
    <Badge size={size} radius="sm" variant="light" color={CATEGORY_COLOR[status?.statusCategory?.key] ?? 'gray'}>
      {status?.name}
    </Badge>
  )
}

export function Empty({ children }) {
  return (
    <Text c="dimmed" ta="center" py="xl" size="sm">
      {children}
    </Text>
  )
}

export const assigneeName = (f) => f.assignee?.displayName ?? 'Unassigned'

// Issue list used by the sections and the sprint; `match` = client-side filter.
export function IssueTable({ issues, match, browse }) {
  if (!issues.length) return <Empty>Không có issue.</Empty>
  const rows = match ? issues.filter(match) : issues
  if (!rows.length) return <Empty>Không có issue khớp bộ lọc.</Empty>
  const today = ymd(Date.now())
  return (
    <Table.ScrollContainer minWidth={820}>
      <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
        <Table.Thead>
          <Table.Tr>
            {['Key', 'Summary', 'Status', 'Type', 'Assignee', 'Priority', 'Due', 'Updated'].map((h) => (
              <Table.Th key={h}>{h}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ key, fields: f }) => {
            const overdue = f.duedate && f.status?.statusCategory?.key !== 'done' && f.duedate < today
            return (
              <Table.Tr key={key}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Anchor href={browse(key)} target="_blank" rel="noopener" size="sm">
                    {key}
                  </Anchor>
                </Table.Td>
                <Table.Td>{f.summary}</Table.Td>
                <Table.Td>
                  <StatusBadge status={f.status} />
                </Table.Td>
                <Table.Td>{f.issuetype?.name}</Table.Td>
                <Table.Td c="dimmed">{assigneeName(f)}</Table.Td>
                <Table.Td>{f.priority?.name}</Table.Td>
                <Table.Td c={overdue ? 'red.7' : 'dimmed'} fw={overdue ? 600 : undefined} style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(f.duedate)}
                </Table.Td>
                <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(f.updated)}
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
