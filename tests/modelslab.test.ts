import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelslabConnector } from '../src/connectors/adapters/modelslab.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'source_modelslab',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'modelslab',
    label: 'ModelsLab test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'modelslab-secret' },
    status: 'active',
  }
}

describe('ModelsLab direct adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('declares the synchronous text-to-image operation as an approved external effect', () => {
    expect(modelslabConnector.manifest.kind).toBe('modelslab')
    expect(modelslabConnector.manifest.auth.kind).toBe('api-key')
    expect(modelslabConnector.manifest.capabilities).toEqual([
      expect.objectContaining({
        name: 'text.to.image',
        class: 'mutation',
        cas: 'none',
        externalEffect: true,
      }),
      expect.objectContaining({ name: 'images.status', class: 'read' }),
    ])
  })

  it('sends the API key in the documented JSON body to the fixed ModelsLab endpoint', async () => {
    let request: { url?: string; authorization?: string | null; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        body: JSON.parse(String(init?.body)),
      }
      return new Response(JSON.stringify({ status: 'success', output: ['https://example.com/image.png'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const result = await modelslabConnector.executeMutation!({
      source: source(),
      capabilityName: 'text.to.image',
      args: { prompt: 'a blue geometric knot', samples: 1 },
      idempotencyKey: 'image-1',
    })

    expect(request).toEqual({
      url: 'https://modelslab.com/api/v6/images/text2img',
      authorization: null,
      body: { prompt: 'a blue geometric knot', samples: 1, key: 'modelslab-secret' },
    })
    expect(result.status).toBe('committed')
  })

  it('fetches a queued result with an encoded provider request id', async () => {
    let request: { url?: string; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), body: JSON.parse(String(init?.body)) }
      return new Response(JSON.stringify({ status: 'success', output: ['https://example.com/image.png'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const result = await modelslabConnector.executeRead!({
      source: source(),
      capabilityName: 'images.status',
      args: { requestId: 'job/one' },
      idempotencyKey: 'image-status-1',
    })

    expect(request).toEqual({
      url: 'https://modelslab.com/api/v6/images/fetch/job%2Fone',
      body: { key: 'modelslab-secret' },
    })
    expect(result.data).toEqual({ status: 'success', output: ['https://example.com/image.png'] })
  })

  it('validates credentials with the non-mutating wallet-balance endpoint', async () => {
    let request: { url?: string; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), body: JSON.parse(String(init?.body)) }
      return new Response(JSON.stringify({ status: 'success', balance: 43.6 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(modelslabConnector.test(source())).resolves.toEqual({ ok: true })
    expect(request).toEqual({
      url: 'https://modelslab.com/api/wallet_balance',
      body: { key: 'modelslab-secret' },
    })
  })

  it('does not expose an expired key in authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('modelslab-secret invalid', { status: 401 })))

    const failure = modelslabConnector.executeMutation!({
      source: source(),
      capabilityName: 'text.to.image',
      args: { prompt: 'test' },
      idempotencyKey: 'image-2',
    })
    await expect(failure).rejects.toMatchObject({ name: 'CredentialsExpired' })
    await expect(failure).rejects.not.toThrow('modelslab-secret')
  })
})
