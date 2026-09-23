import { afterEach, describe, expect, it, vi } from 'vitest'
import { deepgramConnector } from '../src/connectors/adapters/deepgram.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'deepgram-connection', projectId: 'project', publishedAgentId: null,
  kind: 'deepgram', label: 'Deepgram', consistencyModel: 'authoritative',
  scopes: [], metadata: {}, credentials: { kind: 'api-key', apiKey: 'private-key' }, status: 'active',
}
const bytes = Buffer.from('OggS fixture bytes')
const args = { contentBase64: bytes.toString('base64'), contentType: 'audio/ogg; codecs=opus' }

afterEach(() => vi.unstubAllGlobals())

describe('deepgram adapter manifest', () => {
  it('classifies itself as the comms category and exposes the deepgram kind', () => {
    expect(deepgramConnector.manifest.kind).toBe('deepgram')
    expect(deepgramConnector.manifest.category).toBe('comms')
    expect(deepgramConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = deepgramConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Deepgram/i)
  })

  it('covers transcription, speech synthesis, projects, usage, and key management capabilities', () => {
    const names = deepgramConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'keys.create',
        'keys.list',
        'projects.get',
        'projects.list',
        'speak.generate',
        'transcription.create',
        'transcription.bytes',
        'transcription.get',
        'usage.list',
      ].sort(),
    )
    const mutations = deepgramConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['keys.create', 'speak.generate', 'transcription.create'].sort(),
    )
  })
})

describe('Deepgram private audio transcription', () => {
  it('posts bounded private bytes with fixed multilingual settings and a connected key', async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({
      metadata: { request_id: 'request-1' }, results: { channels: [{ alternatives: [{ transcript: 'Hola, can you help?' }] }] },
    }))
    vi.stubGlobal('fetch', send)
    const result = await deepgramConnector.executeRead!({ source, capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-1' })
    expect(result.data).toEqual({ text: 'Hola, can you help?', requestId: 'request-1', model: 'nova-3', language: 'multi' })
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0]!
    expect(String(url)).toBe('https://api.deepgram.com/v1/listen?model=nova-3&language=multi&punctuate=true')
    expect(new Headers(init?.headers).get('authorization')).toBe('Token private-key')
    expect(new Headers(init?.headers).get('content-type')).toBe('audio/ogg')
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(bytes)
    expect(init?.redirect).toBe('error')
  })

  it('uses Deepgram Token auth for the existing connection probe', async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ status: 'ok' }))
    vi.stubGlobal('fetch', send)
    expect(await deepgramConnector.test(source)).toEqual({ ok: true })
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Token private-key')
  })

  it.each([
    { contentBase64: '', contentType: 'audio/ogg' },
    { contentBase64: args.contentBase64.slice(0, -1) + '?', contentType: 'audio/ogg' },
    { contentBase64: Buffer.alloc(16_000_001).toString('base64'), contentType: 'audio/ogg' },
    { contentBase64: args.contentBase64, contentType: 'image/jpeg' },
  ])('rejects unsupported or unbounded audio before calling Deepgram', async invalid => {
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    await expect(deepgramConnector.executeRead!({ source, capabilityName: 'transcription.bytes', args: invalid, idempotencyKey: 'voice-1' })).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('classifies credential expiry, throttling, and malformed responses', async () => {
    const invoke = () => deepgramConnector.executeRead!({ source, capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-1' })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
    await expect(invoke()).rejects.toMatchObject({ name: 'CredentialsExpired', status: 401 })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }))
    await expect(invoke()).rejects.toMatchObject({ name: 'CredentialsExpired', status: 403 })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }))
    await expect(invoke()).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 429 })
    vi.stubGlobal('fetch', async () => Response.json({ results: { channels: [] } }))
    await expect(invoke()).rejects.toMatchObject({ code: 'invalid_response' })
    vi.stubGlobal('fetch', async () => Response.json({ results: { channels: [{ alternatives: [{ transcript: 'x'.repeat(250_001) }] }] } }))
    await expect(invoke()).rejects.toMatchObject({ code: 'response_limit' })
  })
})
