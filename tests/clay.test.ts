import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { clayConnector } from '../src/connectors/adapters/clay.js'
import { clayWebhookProvider } from '../src/webhooks/index'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const WEBHOOK_URL = 'https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-abc123'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_clay_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clay',
    label: 'Drew Clay',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: { webhookUrl: WEBHOOK_URL },
    credentials: { kind: 'api-key', apiKey: 'clay-webhook-token' },
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

describe('clay adapter manifest', () => {
  it('is a write-only crm connector: one push mutation, no reads', () => {
    expect(clayConnector.manifest.kind).toBe('clay')
    expect(clayConnector.manifest.category).toBe('crm')
    expect(clayConnector.manifest.defaultConsistencyModel).toBe('advisory')
    expect(clayConnector.manifest.auth.kind).toBe('api-key')

    const reads = clayConnector.manifest.capabilities.filter((c) => c.class === 'read')
    const mutations = clayConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(reads).toEqual([])
    expect(mutations.map((c) => c.name)).toEqual(['push_row'])
    // No read capabilities → no executeRead handler (isolation invariant).
    expect(clayConnector.executeRead).toBeUndefined()
    expect(typeof clayConnector.executeMutation).toBe('function')
  })
})

describe('clay push_row mutation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the row JSON to the table webhook URL with the x-clay-webhook-auth token', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({})
    }))

    const result = await clayConnector.executeMutation!({
      source: source(),
      capabilityName: 'push_row',
      args: { firstName: 'Jane', email: 'jane@acme.com', company: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe(WEBHOOK_URL)
    expect(capturedHeaders['x-clay-webhook-auth']).toBe('clay-webhook-token')
    expect(capturedBody).toEqual({ firstName: 'Jane', email: 'jane@acme.com', company: 'Acme' })
    expect(result.status).toBe('committed')
  })

  it('omits the auth header when the table webhook has no token', async () => {
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      return jsonResponse({})
    }))

    await clayConnector.executeMutation!({
      source: source({ credentials: { kind: 'api-key', apiKey: '' } }),
      capabilityName: 'push_row',
      args: { email: 'x@y.com' },
      idempotencyKey: 'k',
    })
    expect('x-clay-webhook-auth' in capturedHeaders).toBe(false)
  })

  it('throws when the webhookUrl metadata is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      clayConnector.executeMutation!({
        source: source({ metadata: {} }),
        capabilityName: 'push_row',
        args: { email: 'x@y.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/webhookUrl/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })))
    await expect(
      clayConnector.executeMutation!({
        source: source(),
        capabilityName: 'push_row',
        args: { email: 'x@y.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('test() passes with a valid webhook URL and fails when it is missing', async () => {
    expect(await clayConnector.test(source())).toEqual({ ok: true })
    const bad = await clayConnector.test(source({ metadata: {} }))
    expect(bad.ok).toBe(false)
  })
})

describe('clayWebhookProvider (inbound trigger)', () => {
  const secret = 'clay_shared_secret'

  it('accepts a matching x-clay-webhook-secret header', () => {
    expect(
      clayWebhookProvider.verifySignature({ rawBody: '{}', headers: { 'x-clay-webhook-secret': secret }, secret }),
    ).toEqual({ valid: true })
  })

  it('rejects a mismatched secret', () => {
    const res = clayWebhookProvider.verifySignature({ rawBody: '{}', headers: { 'x-clay-webhook-secret': 'nope' }, secret })
    expect(res.valid).toBe(false)
  })

  it('rejects a missing secret header', () => {
    expect(clayWebhookProvider.verifySignature({ rawBody: '{}', headers: {}, secret })).toEqual({
      valid: false,
      reason: 'missing_clay_webhook_secret',
    })
  })

  it('parses a row, anchoring the event id on a common id field', async () => {
    const body = JSON.stringify({ id: 'row_42', email: 'jane@acme.com', enriched: true })
    const [env] = await clayWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.provider).toBe('clay')
    expect(env.eventType).toBe('clay.row')
    expect(env.providerEventId).toBe('row_42')
    expect(env.payload).toMatchObject({ email: 'jane@acme.com' })
  })

  it('falls back to a body digest when no id field is present', async () => {
    const body = JSON.stringify({ email: 'jane@acme.com' })
    const [env] = await clayWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.providerEventId).toBe(createHash('sha256').update(body).digest('hex'))
  })

  it('returns [] for a non-JSON body', async () => {
    expect(await clayWebhookProvider.parse({ rawBody: 'not json', headers: {} })).toEqual([])
  })
})
