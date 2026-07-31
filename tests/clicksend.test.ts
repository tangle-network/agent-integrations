import { afterEach, describe, expect, it, vi } from 'vitest'
import { clicksendConnector } from '../src/connectors/adapters/clicksend.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_clicksend_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clicksend',
    label: 'ClickSend test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({ username: 'tangle-user', apiKey: 'clicksend-secret' }),
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ClickSend adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exposes account, contacts, SMS, and voice capabilities', () => {
    expect(clicksendConnector.manifest).toMatchObject({
      kind: 'clicksend',
      category: 'comms',
      auth: { kind: 'api-key' },
    })
    expect(clicksendConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual([
      'account.get',
      'contacts.create',
      'contacts.delete',
      'contacts.get',
      'contacts.list',
      'contacts.update',
      'lists.create',
      'lists.delete',
      'lists.get',
      'lists.list',
      'lists.update',
      'sms.cancel',
      'sms.history',
      'sms.inbound.list',
      'sms.receipts.list',
      'sms.send',
      'voice.cancel',
      'voice.history',
      'voice.send',
    ])
  })

  it('checks the account with HTTP Basic credentials', async () => {
    let capturedUrl = ''
    let capturedAuthorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedAuthorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse({ response_code: 'SUCCESS' })
    }))

    await expect(clicksendConnector.test!(source())).resolves.toEqual({ ok: true })
    expect(capturedUrl).toBe('https://rest.clicksend.com/v3/account')
    expect(capturedAuthorization).toBe(`Basic ${Buffer.from('tangle-user:clicksend-secret').toString('base64')}`)
  })

  it('fails closed on an incomplete credential bundle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(clicksendConnector.executeRead!({
      source: source({ credentials: { kind: 'api-key', apiKey: '{"username":"tangle-user"}' } }),
      capabilityName: 'account.get',
      args: {},
      idempotencyKey: 'incomplete',
    })).rejects.toThrow(/missing apiKey/)
  })

  it('renders SMS history query parameters exactly', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ data: { data: [] } })
    }))

    await clicksendConnector.executeRead!({
      source: source(),
      capabilityName: 'sms.history',
      args: { query: 'from:+15551234567', dateFrom: 100, dateTo: 200, page: 2, limit: 50 },
      idempotencyKey: 'history',
    })

    expect(capturedUrl).toBe('https://rest.clicksend.com/v3/sms/history?q=from%3A%2B15551234567&date_from=100&date_to=200&page=2&limit=50')
  })

  it('sends the provider-native SMS collection body', async () => {
    let capturedBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ response_code: 'SUCCESS' })
    }))

    const messages = [{ source: 'sdk', body: 'Hello', to: '+15551234567', from: 'Tangle' }]
    const result = await clicksendConnector.executeMutation!({
      source: source(),
      capabilityName: 'sms.send',
      args: { messages },
      idempotencyKey: 'send-sms',
    })

    expect(capturedBody).toEqual({ messages })
    expect(result.status).toBe('committed')
  })

  it('uses exact contact list CRUD paths and bodies', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? '',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return jsonResponse({ response_code: 'SUCCESS' })
    }))

    await clicksendConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.create',
      args: { listName: 'Customers' },
      idempotencyKey: 'create-list',
    })
    await clicksendConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.update',
      args: { listId: 7, contactId: 9, contact: { phone_number: '+15551234567', first_name: 'Ada' } },
      idempotencyKey: 'update-contact',
    })

    expect(requests).toEqual([
      { url: 'https://rest.clicksend.com/v3/lists', method: 'POST', body: { list_name: 'Customers' } },
      {
        url: 'https://rest.clicksend.com/v3/lists/7/contacts/9',
        method: 'PUT',
        body: { phone_number: '+15551234567', first_name: 'Ada' },
      },
    ])
  })

  it('redacts both Basic credential components from errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'tangle-user and clicksend-secret were rejected',
      { status: 500 },
    )))

    await expect(clicksendConnector.executeRead!({
      source: source(),
      capabilityName: 'account.get',
      args: {},
      idempotencyKey: 'redaction',
    })).rejects.not.toThrow(/tangle-user|clicksend-secret/)
  })
})
