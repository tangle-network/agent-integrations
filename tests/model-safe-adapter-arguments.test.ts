import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorAdapter, ResolvedDataSource } from '../src/connectors/types.js'
import { azureAdConnector } from '../src/connectors/adapters/azure-ad.js'
import { mailgunConnector } from '../src/connectors/adapters/mailgun.js'
import { microsoft365PeopleConnector } from '../src/connectors/adapters/microsoft-365-people.js'
import { microsoftDynamicsCrmConnector } from '../src/connectors/adapters/microsoft-dynamics-crm.js'
import { microsoftExcel365Connector } from '../src/connectors/adapters/microsoft-excel-365.js'
import { microsoftOnenoteConnector } from '../src/connectors/adapters/microsoft-onenote.js'
import { microsoftTodoConnector } from '../src/connectors/adapters/microsoft-todo.js'
import { trelloConnector } from '../src/connectors/adapters/trello.js'

function source(kind: string, credentials: ResolvedDataSource['credentials'] = {
  kind: 'oauth2',
  accessToken: 'at',
  expiresAt: Date.now() + 60_000,
}): ResolvedDataSource {
  return {
    id: `src_${kind}`,
    projectId: 'project',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { instanceUrl: 'https://contoso.crm.dynamics.com' },
    credentials,
    status: 'active',
  }
}

interface GraphCase {
  adapter: ConnectorAdapter
  capabilityName: string
  args: Record<string, unknown>
  query: Record<string, string>
  path?: string
}

const graphCases: GraphCase[] = [
  {
    adapter: azureAdConnector,
    capabilityName: 'users.list',
    args: { filter: 'accountEnabled eq true', select: 'id', top: 5, search: 'Drew', orderBy: 'displayName' },
    query: { $filter: 'accountEnabled eq true', $select: 'id', $top: '5', $search: 'Drew', $orderby: 'displayName' },
  },
  {
    adapter: azureAdConnector,
    capabilityName: 'users.list.enabled',
    args: { select: 'id', top: 5 },
    query: { $filter: 'accountEnabled eq true', $select: 'id', $top: '5' },
  },
  {
    adapter: azureAdConnector,
    capabilityName: 'groups.members.list',
    args: { id: 'group-1', select: 'id', top: 5 },
    query: { $select: 'id', $top: '5' },
  },
  {
    adapter: microsoft365PeopleConnector,
    capabilityName: 'get.contact.folder',
    args: { contactFolderId: 'folder-1', select: 'id' },
    query: { $select: 'id' },
  },
  {
    adapter: microsoft365PeopleConnector,
    capabilityName: 'search.contacts',
    args: {
      contactFolderId: 'folder-1',
      search: 'Drew',
      filter: 'companyName eq Contoso',
      select: 'id',
      top: 5,
      orderBy: 'displayName',
    },
    query: {
      $search: 'Drew',
      $filter: 'companyName eq Contoso',
      $select: 'id',
      $top: '5',
      $orderby: 'displayName',
    },
  },
  {
    adapter: microsoftDynamicsCrmConnector,
    capabilityName: 'records.get',
    args: { entitySet: 'accounts', recordId: 'record-1', select: 'name', expand: 'primarycontactid' },
    query: { $select: 'name', $expand: 'primarycontactid' },
  },
  {
    adapter: microsoftExcel365Connector,
    capabilityName: 'get.workbooks',
    args: { search: 'budget', filter: 'name ne null', top: 5, select: 'id,name' },
    query: { $filter: 'name ne null', $top: '5', $select: 'id,name' },
    path: '/me/drive/root/search(q=budget)',
  },
  {
    adapter: microsoftExcel365Connector,
    capabilityName: 'get.table.rows',
    args: { workbookId: 'book-1', tableId: 'table-1', top: 5, skip: 2 },
    query: { $top: '5', $skip: '2' },
  },
  {
    adapter: microsoftOnenoteConnector,
    capabilityName: 'notebooks.list',
    args: { top: 5, filter: 'displayName eq Notes', select: 'id' },
    query: { $top: '5', $filter: 'displayName eq Notes', $select: 'id' },
  },
  {
    adapter: microsoftOnenoteConnector,
    capabilityName: 'sections.list',
    args: { notebookId: 'notes-1', top: 5, filter: 'displayName eq Work' },
    query: { $top: '5', $filter: 'displayName eq Work' },
  },
  {
    adapter: microsoftOnenoteConnector,
    capabilityName: 'pages.list',
    args: { sectionId: 'section-1', top: 5, filter: 'title ne null', search: 'plan' },
    query: { $top: '5', $filter: 'title ne null', $search: 'plan' },
  },
  {
    adapter: microsoftTodoConnector,
    capabilityName: 'taskLists.list',
    args: { top: 5, filter: 'displayName eq Work', select: 'id', skip: 2 },
    query: { $top: '5', $filter: 'displayName eq Work', $select: 'id', $skip: '2' },
  },
  {
    adapter: microsoftTodoConnector,
    capabilityName: 'tasks.list',
    args: { listId: 'list-1', top: 5, filter: 'status eq completed', select: 'id', orderBy: 'createdDateTime', skip: 2 },
    query: { $top: '5', $filter: 'status eq completed', $select: 'id', $orderby: 'createdDateTime', $skip: '2' },
  },
  {
    adapter: microsoftTodoConnector,
    capabilityName: 'tasks.findByTitle',
    args: { listId: 'list-1', title: 'plan', top: 5 },
    query: { $filter: 'title eq \'plan\'', $top: '5' },
  },
]

describe('model-safe connector arguments', () => {
  afterEach(() => vi.unstubAllGlobals())

  for (const testCase of graphCases) {
    it(`${testCase.adapter.manifest.kind}.${testCase.capabilityName} retains Graph query keys`, async () => {
      let calledUrl = ''
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }))
      await testCase.adapter.executeRead!({
        source: source(testCase.adapter.manifest.kind),
        capabilityName: testCase.capabilityName,
        args: testCase.args,
        idempotencyKey: 'k',
      })
      const url = new URL(calledUrl)
      expect(Object.fromEntries(url.searchParams)).toEqual(testCase.query)
      if (testCase.path) expect(decodeURIComponent(url.pathname)).toContain(testCase.path)
    })
  }

  it('Mailgun maps replyTo to its provider field', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await mailgunConnector.executeMutation!({
      source: source('mailgun', { kind: 'api-key', apiKey: 'key' }),
      capabilityName: 'messages.send',
      args: { domain: 'mg.example.com', from: 'sender@example.com', to: 'recipient@example.com', subject: 'Hello', text: 'Hi', replyTo: 'reply@example.com' },
      idempotencyKey: 'k',
    })
    expect(body['h:Reply-To']).toBe('reply@example.com')
    expect(body).not.toHaveProperty('replyTo')
  })

  it('Trello maps permission and background fields to provider keys', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await trelloConnector.executeMutation!({
      source: source('trello', { kind: 'api-key', apiKey: 'token' }),
      capabilityName: 'boards.update',
      args: { key: 'key', boardId: 'board-1', permissionLevel: 'private', background: 'blue' },
      idempotencyKey: 'k',
    })
    expect(body).toMatchObject({ 'prefs/permissionLevel': 'private', 'prefs/background': 'blue' })
    expect(body).not.toHaveProperty('permissionLevel')
    expect(body).not.toHaveProperty('background')
  })
})
