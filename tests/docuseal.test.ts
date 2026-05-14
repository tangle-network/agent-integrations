import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  docuseal,
  type ResolvedDataSource,
} from '../src/connectors/index'

const apiSource = (): ResolvedDataSource => ({
  id: 'src_docuseal_1',
  projectId: 'proj_1',
  publishedAgentId: null,
  kind: 'docuseal',
  label: 'DocuSeal',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'key_live_123' },
  status: 'active',
})

const customSource = (): ResolvedDataSource => ({
  id: 'src_docuseal_2',
  projectId: 'proj_1',
  publishedAgentId: null,
  kind: 'docuseal',
  label: 'DocuSeal',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'custom', values: { apiKey: 'key_live_456', webhookSecret: 'whsec_test' } },
  status: 'active',
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('docuseal adapter', () => {
  const adapter = docuseal()

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares api-key auth + three capabilities', () => {
    expect(adapter.manifest.auth.kind).toBe('api-key')
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create_submission', 'get_submission', 'void_submission'])
  })

  it('create_submission forwards external_id as the idempotency key', async () => {
    let captured: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 100,
        status: 'pending',
        updated_at: '2025-01-01T00:00:00Z',
        submitters: [{ email: 'signer@example.com', status: 'awaiting', slug: 's1', embed_src: 'https://docuseal/s1' }],
      })
    }))

    const result = await adapter.executeMutation!({
      source: apiSource(),
      capabilityName: 'create_submission',
      args: { templateId: 'tpl_1', submitters: [{ email: 'signer@example.com' }] },
      idempotencyKey: 'idemp-1',
    })
    expect(captured!.external_id).toBe('idemp-1')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { submitters: unknown[] }).submitters).toHaveLength(1)
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('create_submission treats 409 as idempotent replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: 100,
      status: 'pending',
      updated_at: '2025-01-01T00:00:00Z',
      submitters: [{ email: 'signer@example.com', status: 'awaiting' }],
    }, { status: 409 })))
    const result = await adapter.executeMutation!({
      source: apiSource(),
      capabilityName: 'create_submission',
      args: { templateId: 'tpl_1', submitters: [{ email: 'signer@example.com' }] },
      idempotencyKey: 'idemp-1',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
    }
  })

  it('create_submission surfaces rate-limit with retryAfter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '7' } })))
    const result = await adapter.executeMutation!({
      source: apiSource(),
      capabilityName: 'create_submission',
      args: { templateId: 'tpl_1', submitters: [{ email: 's@e.com' }] },
      idempotencyKey: 'idemp-1',
    })
    expect(result.status).toBe('rate-limited')
    if (result.status === 'rate-limited') {
      expect(result.retryAfterMs).toBe(7_000)
    }
  })

  it('get_submission normalizes the DocuSeal response shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: 'sub_xyz',
      status: 'completed',
      updated_at: '2025-01-02T00:00:00Z',
      completed_at: '2025-01-02T00:00:00Z',
      audit_log_url: 'https://docuseal/audit',
      submitters: [
        { email: 'a@b.com', status: 'completed', completed_at: '2025-01-02T00:00:00Z', embed_src: 'https://docuseal/s1' },
      ],
    })))
    const result = await adapter.executeRead!({
      source: apiSource(),
      capabilityName: 'get_submission',
      args: { submissionId: 'sub_xyz' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { submitters: Array<{ status: string; completedAt?: string }>; status: string }
    expect(data.status).toBe('completed')
    expect(data.submitters[0].status).toBe('completed')
  })

  it('void_submission threads If-Match into the DELETE', async () => {
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return jsonResponse({ id: 'sub_xyz', updated_at: '2025-01-03T00:00:00Z' })
    }))
    const result = await adapter.executeMutation!({
      source: apiSource(),
      capabilityName: 'void_submission',
      args: { submissionId: 'sub_xyz' },
      idempotencyKey: 'k1',
      expectedEtag: '2025-01-02T00:00:00Z',
    })
    expect(capturedHeaders['if-match']).toBe('2025-01-02T00:00:00Z')
    expect(result.status).toBe('committed')
  })

  it('verifySignature accepts a correctly-signed webhook', () => {
    const body = JSON.stringify({ event_type: 'submission.completed', event_id: 'evt_1' })
    const sig = createHmac('sha256', 'whsec_test').update(body).digest('hex')
    const result = adapter.verifySignature!({
      rawBody: body,
      headers: { 'x-docuseal-signature': sig },
      source: customSource(),
    })
    expect(result.valid).toBe(true)
  })

  it('verifySignature rejects a bad signature', () => {
    const result = adapter.verifySignature!({
      rawBody: '{}',
      headers: { 'x-docuseal-signature': 'deadbeef' },
      source: customSource(),
    })
    expect(result.valid).toBe(false)
  })

  it('verifySignature reports missing webhook secret when only api-key was provided', () => {
    const result = adapter.verifySignature!({
      rawBody: '{}',
      headers: {},
      source: apiSource(),
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('missing_webhook_secret')
  })

  it('handleInboundEvent emits a docuseal.<event_type> event', async () => {
    const result = await adapter.handleInboundEvent!({
      source: customSource(),
      rawBody: JSON.stringify({ event_type: 'submission.completed', event_id: 'evt_1', data: { id: 'sub_1' } }),
      headers: {},
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].eventType).toBe('docuseal.submission.completed')
    expect(result.events[0].providerEventId).toBe('evt_1')
  })
})
