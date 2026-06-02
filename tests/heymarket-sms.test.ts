import { afterEach, describe, expect, it, vi } from 'vitest'
import { heymarketSmsConnector } from '../src/connectors/adapters/heymarket-sms.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_heymarket_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'heymarket-sms',
    label: 'heymarket test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'heymarket_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('heymarket-sms adapter manifest', () => {
  it('classifies itself as the crm category and exposes the heymarket-sms kind', () => {
    expect(heymarketSmsConnector.manifest.kind).toBe('heymarket-sms')
    expect(heymarketSmsConnector.manifest.category).toBe('crm')
    expect(heymarketSmsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = heymarketSmsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: contact upsert + delete, custom + template send, list update', () => {
    const names = heymarketSmsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.createOrUpdate',
        'contacts.delete',
        'messages.sendCustom',
        'messages.sendTemplate',
        'lists.update',
      ].sort(),
    )
    const mutations = heymarketSmsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.createOrUpdate',
        'contacts.delete',
        'messages.sendCustom',
        'messages.sendTemplate',
        'lists.update',
      ].sort(),
    )
  })

  it('marks contacts.delete as a native-idempotency external-effect mutation', () => {
    const cap = heymarketSmsConnector.manifest.capabilities.find((c) => c.name === 'contacts.delete')
    if (!cap || cap.class !== 'mutation') throw new Error('contacts.delete must be a mutation')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })
})

describe('heymarket-sms contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v3/contacts/{contact_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ deleted: true })
      }),
    )

    const result = await heymarketSmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contact_id: 'ct_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.heymarket.com/v3/contacts/ct_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      heymarketSmsConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { contact_id: 'ct_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
