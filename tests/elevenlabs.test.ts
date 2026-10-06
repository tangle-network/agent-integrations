import { afterEach, describe, expect, it, vi } from 'vitest'
import { elevenlabsConnector } from '../src/connectors/adapters/elevenlabs.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_el', projectId: 'proj_1', publishedAgentId: null, kind: 'elevenlabs', label: 'el',
  consistencyModel: 'authoritative', scopes: [], metadata: {},
  credentials: { kind: 'api-key', apiKey: 'sk_el_test' }, status: 'active',
}

describe('elevenlabs adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('authenticates with xi-api-key and returns synthesized audio intact', async () => {
    const audio = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 0x80, 0xc3])
    let headers: Headers | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return new Response(audio, { headers: { 'content-type': 'audio/mpeg' } })
    }))
    const result = await elevenlabsConnector.executeMutation!({
      source, capabilityName: 'speech.synthesis', idempotencyKey: 's', args: { voiceId: 'v1', text: 'hi' },
    })
    expect(headers?.get('xi-api-key')).toBe('sk_el_test')
    expect(headers?.get('authorization')).toBeNull()
    expect(result.status === 'committed' && result.data).toMatchObject({
      base64: Buffer.from(audio).toString('base64'), contentType: 'audio/mpeg',
    })
  })

  it('refuses a clone of anyone but the requester before downloading samples', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(elevenlabsConnector.executeMutation!({
      source, capabilityName: 'voices.clone_instant', idempotencyKey: 'c',
      args: { name: 'x', sampleUrls: ['https://media.test/a.mp3'], consent: { subject: 'other', statement: 'I consent to it' } },
    })).rejects.toThrow(/own voice/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
