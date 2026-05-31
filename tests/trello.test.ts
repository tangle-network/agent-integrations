import { afterEach, describe, expect, it, vi } from 'vitest'
import { trelloConnector } from '../src/connectors/adapters/trello.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_trello',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'trello',
  label: 'Trello (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['read', 'write'],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'utok_abc' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('trello adapter manifest', () => {
  it('classifies itself as kind=trello, category=other, api-key auth', () => {
    expect(trelloConnector.manifest.kind).toBe('trello')
    expect(trelloConnector.manifest.category).toBe('other')
    expect(trelloConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(trelloConnector.manifest.auth.kind).toBe('api-key')
  })

  it('declares a non-trivial action pack covering boards, lists, cards, checklists, search', () => {
    const names = trelloConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'boards.list',
        'boards.get',
        'boards.lists',
        'boards.create',
        'lists.cards',
        'lists.create',
        'lists.update',
        'cards.get',
        'cards.create',
        'cards.update',
        'cards.move',
        'cards.archive',
        'cards.delete',
        'cards.addComment',
        'cards.addLabel',
        'cards.addMember',
        'checklists.create',
        'checklists.addItem',
        'search',
      ].sort(),
    )
    const reads = trelloConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    expect(reads).toEqual(['boards.get', 'boards.list', 'boards.lists', 'cards.get', 'lists.cards', 'search'].sort())
    const mutations = trelloConnector.manifest.capabilities.filter((c) => c.class === 'mutation').length
    expect(mutations).toBeGreaterThanOrEqual(12)
  })
})

describe('trello adapter execution', () => {
  it('GETs boards.list under https://api.trello.com/1/members/{memberId}/boards with key+token in the query', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify([{ id: 'b_1', name: 'Roadmap' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'boards.list',
      args: { key: 'devkey123', memberId: 'me', filter: 'open' },
      idempotencyKey: 'idem_1',
    }
    const result = await trelloConnector.executeRead!(invocation)

    expect(result.data).toEqual([{ id: 'b_1', name: 'Roadmap' }])
    const call = fetchMock.mock.calls[0]!
    const url = new URL(String(call[0]))
    expect(url.origin).toBe('https://api.trello.com')
    expect(url.pathname).toBe('/1/members/me/boards')
    expect(url.searchParams.get('key')).toBe('devkey123')
    expect(url.searchParams.get('token')).toBe('utok_abc')
    expect(url.searchParams.get('filter')).toBe('open')
  })

  it('POSTs cards.create with the args as the body and key+token on the query string', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'card_42', name: 'Ship it' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'cards.create',
      args: { key: 'devkey123', idList: 'list_9', name: 'Ship it', desc: 'cut release' },
      idempotencyKey: 'idem_2',
    }
    const result = await trelloConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    const url = new URL(String(call[0]))
    expect(url.pathname).toBe('/1/cards')
    expect(url.searchParams.get('key')).toBe('devkey123')
    expect(url.searchParams.get('token')).toBe('utok_abc')
    expect(call[1]!.method).toBe('POST')
    const body = JSON.parse(String(call[1]!.body)) as Record<string, unknown>
    expect(body).toMatchObject({ key: 'devkey123', idList: 'list_9', name: 'Ship it', desc: 'cut release' })
  })

  it('PUTs cards.move at /1/cards/{cardId} with a structured body of idList+pos', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'card_42', idList: 'list_done' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'cards.move',
      args: { key: 'devkey123', cardId: 'card_42', idList: 'list_done', pos: 'top' },
      idempotencyKey: 'idem_3',
    }
    const result = await trelloConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    const url = new URL(String(call[0]))
    expect(url.pathname).toBe('/1/cards/card_42')
    expect(call[1]!.method).toBe('PUT')
    expect(JSON.parse(String(call[1]!.body))).toEqual({ idList: 'list_done', pos: 'top' })
  })

  it('DELETEs cards.delete at /1/cards/{cardId} and does not send a body', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response('', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'cards.delete',
      args: { key: 'devkey123', cardId: 'card_42' },
      idempotencyKey: 'idem_4',
    }
    const result = await trelloConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const call = fetchMock.mock.calls[0]!
    expect(new URL(String(call[0])).pathname).toBe('/1/cards/card_42')
    expect(call[1]!.method).toBe('DELETE')
    expect(call[1]!.body).toBeUndefined()
  })

  it('throws CredentialsExpired when Trello rejects the token with 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('expired', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'cards.get',
      args: { key: 'devkey123', cardId: 'card_42' },
      idempotencyKey: 'idem_5',
    }
    await expect(trelloConnector.executeRead!(invocation)).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
