import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider, manifestToConnector } from '../src/adapter-provider.js'
import { deepgramConnector } from '../src/connectors/adapters/deepgram.js'
import {
  ApprovalBackedPolicyEngine,
  InMemoryConnectionStore,
  InMemoryIntegrationApprovalStore,
  IntegrationHub,
  createDefaultIntegrationPolicyEngine,
} from '../src/index.js'
import { StaticIntegrationPolicyEngine } from '../src/policy.js'
import { normalizeIntegrationError } from '../src/errors.js'
import type { IntegrationConnection } from '../src/core-types.js'
import { type ResolvedDataSource, validateConnectorManifest } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'deepgram-connection', projectId: 'project', publishedAgentId: null,
  kind: 'deepgram', label: 'Deepgram', consistencyModel: 'authoritative',
  scopes: [], metadata: {}, credentials: { kind: 'api-key', apiKey: 'private-key' }, status: 'active',
}
const bytes = Buffer.from('OggS fixture bytes')
const args = { contentBase64: bytes.toString('base64'), contentType: 'audio/ogg; codecs=opus' }

afterEach(() => vi.unstubAllGlobals())

describe('deepgram adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = deepgramConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Deepgram/i)
  })

})

describe('Deepgram private audio transcription', () => {
  it('posts bounded private bytes with fixed multilingual settings and a connected key', async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({
      metadata: { request_id: 'request-1' }, results: { channels: [{ alternatives: [{ transcript: 'Hola, can you help?' }] }] },
    }))
    vi.stubGlobal('fetch', send)
    const result = await deepgramConnector.executeMutation!({ source, capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-1' })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.data).toEqual({ text: 'Hola, can you help?', requestId: 'request-1', model: 'nova-3', language: 'multi' })
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0]!
    expect(String(url)).toBe('https://api.deepgram.com/v1/listen?model=nova-3&language=multi&punctuate=true&mip_opt_out=true')
    expect(new Headers(init?.headers).get('authorization')).toBe('Token private-key')
    expect(new Headers(init?.headers).get('content-type')).toBe('audio/ogg')
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(bytes)
    expect(init?.redirect).toBe('error')
  })

  it.each([
    ['empty', ''],
    ['oversized', 'x'.repeat(257)],
    ['non-string', 42],
  ])('keeps a billed transcript when the request id is %s', async (_case, requestId) => {
    const send = vi.fn(async () => Response.json({
      metadata: { request_id: requestId },
      results: { channels: [{ alternatives: [{ transcript: 'Turn left at the lobby.' }] }] },
    }))
    vi.stubGlobal('fetch', send)

    const result = await deepgramConnector.executeMutation!({
      source, capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-malformed-id',
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.data).toEqual({
      text: 'Turn left at the lobby.', requestId: null, model: 'nova-3', language: 'multi',
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('returns the same transcript shape through the Hub adapter provider mutation path', async () => {
    vi.stubGlobal('fetch', async () => Response.json({
      results: { channels: [{ alternatives: [{ transcript: 'Necesito ayuda.' }] }] },
    }))
    const connection: IntegrationConnection = {
      id: source.id, owner: { type: 'user', id: 'owner-1' }, providerId: 'first-party',
      connectorId: 'deepgram', status: 'active', grantedScopes: [],
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }
    const provider = createConnectorAdapterProvider({ adapters: [deepgramConnector], resolveDataSource: () => source })
    const result = await provider.invokeAction(connection, {
      connectionId: connection.id, action: 'transcription.bytes', input: args, idempotencyKey: 'voice-1',
    })
    expect(result).toMatchObject({ ok: true, output: {
      text: 'Necesito ayuda.', requestId: null, model: 'nova-3', language: 'multi',
    }, metadata: { idempotentReplay: false } })
  })

  it('blocks private audio by default and executes only with an explicit action grant', async () => {
    const send = vi.fn(async () => Response.json({
      results: { channels: [{ alternatives: [{ transcript: 'Necesito ayuda.' }] }] },
    }))
    vi.stubGlobal('fetch', send)
    const store = new InMemoryConnectionStore()
    const provider = createConnectorAdapterProvider({ adapters: [deepgramConnector], resolveDataSource: () => source })
    const connection: IntegrationConnection = {
      id: source.id, owner: { type: 'user', id: 'owner-1' }, providerId: 'first-party',
      connectorId: 'deepgram', status: 'active', grantedScopes: [],
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }
    const deniedHub = new IntegrationHub({
      providers: [provider], store, capabilitySecret: 'test-secret',
      policy: createDefaultIntegrationPolicyEngine(),
    })
    await deniedHub.upsertConnection(connection)
    const grant = await deniedHub.issueCapability({
      subject: { type: 'agent', id: 'agent-1' }, connectionId: connection.id,
      scopes: [], allowedActions: ['transcription.bytes'], ttlMs: 60_000,
    })
    const request = { action: 'transcription.bytes', input: args, idempotencyKey: 'voice-1' }
    await expect(deniedHub.invokeWithCapability(grant.token, request)).rejects.toMatchObject({ code: 'policy_denied' })
    expect(send).not.toHaveBeenCalled()

    const allowedHub = new IntegrationHub({
      providers: [provider], store, capabilitySecret: 'test-secret',
      policy: new StaticIntegrationPolicyEngine({ rules: [{
        id: 'owner-stt-grant', effect: 'allow', reason: 'Owner allowed this action.',
        providerId: 'first-party', connectorId: 'deepgram', action: 'transcription.bytes',
      }] }),
    })
    await expect(allowedHub.invokeWithCapability(grant.token, request)).resolves.toMatchObject({
      ok: true, output: { text: 'Necesito ayuda.', model: 'nova-3', language: 'multi' },
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not persist private audio bytes in an approval request', async () => {
    const send = vi.fn()
    const unexpectedAudio = Buffer.from('secret voice').toString('base64')
    const repeatedAudio = Buffer.alloc(90, 0xa5).toString('base64')
    const dataUrl = `data:audio/ogg;base64,${repeatedAudio}`
    const wrappedAudio = repeatedAudio.match(/.{1,76}/g)!.join('\n')
    const foldedDataUrl = `DATA:audio/ogg;\r\n\tbase64,${repeatedAudio}`
    const tabbedDataUrl = `data:audio/ogg;\tbase64,${repeatedAudio}`
    const longHeaderDataUrl = `data:audio/ogg;${'x'.repeat(300)};base64,${repeatedAudio}`
    const spacedAudio = repeatedAudio.match(/.{1,20}/g)!.join('  ')
    const tabbedAudio = repeatedAudio.match(/.{1,20}/g)!.join('\t')
    const indentedAudio = repeatedAudio.match(/.{1,20}/g)!.join('\n  ')
    const leadingSpace = ` ${repeatedAudio}`
    const trailingSpace = `${repeatedAudio} `
    const leadingTab = `\t${repeatedAudio}`
    const trailingTab = `${repeatedAudio}\t`
    vi.stubGlobal('fetch', send)
    const store = new InMemoryConnectionStore()
    const approvals = new InMemoryIntegrationApprovalStore()
    const connection: IntegrationConnection = {
      id: source.id, owner: { type: 'user', id: 'owner-1' }, providerId: 'first-party',
      connectorId: 'deepgram', status: 'active', grantedScopes: [],
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    }
    const hub = new IntegrationHub({
      providers: [createConnectorAdapterProvider({ adapters: [deepgramConnector], resolveDataSource: () => source })],
      store,
      capabilitySecret: 'test-secret',
      policy: new ApprovalBackedPolicyEngine({
        base: createDefaultIntegrationPolicyEngine({ defaultDestructiveEffect: 'require_approval' }),
        store: approvals,
      }),
    })
    await hub.upsertConnection(connection)
    const grant = await hub.issueCapability({
      subject: { type: 'agent', id: 'agent-1' }, connectionId: connection.id,
      scopes: [], allowedActions: ['transcription.bytes'], ttlMs: 60_000,
    })

    const result = await hub.invokeWithCapability(grant.token, {
      action: 'transcription.bytes',
      input: { ...args, extra: { data: unexpectedAudio, dataUrl, wrapped: wrappedAudio,
        foldedDataUrl, tabbedDataUrl, longHeaderDataUrl,
        spaced: spacedAudio, tabbed: tabbedAudio, indented: indentedAudio,
        padA: leadingSpace, padB: trailingSpace, padC: leadingTab, padD: trailingTab } },
      idempotencyKey: 'voice-approval-1',
    })
    const pending = approvals.list({ status: 'pending' })
    expect(result).toMatchObject({ ok: false, output: {
      approvalRequired: true, approval: { inputPreview: {
        contentBase64: '[REDACTED]', contentType: args.contentType,
        extra: { data: '[REDACTED]', dataUrl: '[REDACTED]', wrapped: '[REDACTED]',
          foldedDataUrl: '[REDACTED]', tabbedDataUrl: '[REDACTED]',
          longHeaderDataUrl: '[REDACTED]', spaced: '[REDACTED]',
          tabbed: '[REDACTED]', indented: '[REDACTED]',
          padA: '[REDACTED]', padB: '[REDACTED]', padC: '[REDACTED]', padD: '[REDACTED]' },
      } },
    } })
    expect(pending).toHaveLength(1)
    expect(pending[0]?.request.inputPreview).toEqual({
      contentBase64: '[REDACTED]', contentType: args.contentType,
      extra: { data: '[REDACTED]', dataUrl: '[REDACTED]', wrapped: '[REDACTED]',
        foldedDataUrl: '[REDACTED]', tabbedDataUrl: '[REDACTED]',
        longHeaderDataUrl: '[REDACTED]', spaced: '[REDACTED]',
        tabbed: '[REDACTED]', indented: '[REDACTED]',
        padA: '[REDACTED]', padB: '[REDACTED]', padC: '[REDACTED]', padD: '[REDACTED]' },
    })
    expect(JSON.stringify({ result, pending })).not.toContain(args.contentBase64)
    expect(JSON.stringify({ result, pending })).not.toContain(unexpectedAudio)
    expect(JSON.stringify({ result, pending })).not.toContain(dataUrl)
    expect(JSON.stringify({ result, pending })).not.toContain(repeatedAudio.slice(0, 76))
    expect(JSON.stringify({ result, pending })).not.toContain(spacedAudio)
    expect(JSON.stringify({ result, pending })).not.toContain(tabbedAudio)
    expect(JSON.stringify({ result, pending })).not.toContain(indentedAudio)
    expect(JSON.stringify({ result, pending })).not.toContain(leadingSpace)
    expect(JSON.stringify({ result, pending })).not.toContain(trailingSpace)
    expect(send).not.toHaveBeenCalled()
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
    await expect(deepgramConnector.executeMutation!({ source, capabilityName: 'transcription.bytes', args: invalid, idempotencyKey: 'voice-1' }))
      .rejects.toMatchObject({ code: 'input_invalid', status: 400 })
    expect(send).not.toHaveBeenCalled()
  })

  it('normalizes malformed audio as a caller error without sending bytes', async () => {
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    const error = await deepgramConnector.executeMutation!({
      source, capabilityName: 'transcription.bytes',
      args: { contentBase64: 'not-base64', contentType: 'audio/ogg' }, idempotencyKey: 'voice-invalid',
    }).catch(error => error)
    expect(normalizeIntegrationError(error)).toMatchObject({ code: 'input_invalid', status: 400 })
    expect(send).not.toHaveBeenCalled()
  })

  it('asks for reconnection when the connected API key is missing', async () => {
    const send = vi.fn()
    vi.stubGlobal('fetch', send)
    const error = await deepgramConnector.executeMutation!({
      source: { ...source, credentials: { kind: 'api-key', apiKey: '' } },
      capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-no-key',
    }).catch(error => error)
    expect(normalizeIntegrationError(error)).toMatchObject({
      code: 'provider_auth_failed', status: 401,
      userAction: { type: 'reconnect', label: 'Reconnect Deepgram' },
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('classifies credential expiry, throttling, and malformed responses', async () => {
    const invoke = () => deepgramConnector.executeMutation!({ source, capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-1' })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }))
    await expect(invoke()).rejects.toMatchObject({ name: 'CredentialsExpired', status: 401 })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }))
    await expect(invoke()).rejects.toMatchObject({ name: 'CredentialsExpired', status: 403 })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }))
    await expect(invoke()).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 429, retryAfterMs: 60_000 })
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429, headers: { 'Retry-After': '3' } }))
    await expect(invoke()).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 429, retryAfterMs: 3_000 })
    for (const status of [400, 413, 415, 422]) {
      vi.stubGlobal('fetch', async () => new Response('private provider body', { status }))
      const error = await invoke().catch(error => error)
      expect(normalizeIntegrationError(error)).toMatchObject({ code: 'input_invalid', status: 400 })
      expect(JSON.stringify(normalizeIntegrationError(error))).not.toContain('private provider body')
    }
    vi.stubGlobal('fetch', async () => Response.json({ results: { channels: [] } }))
    await expect(invoke()).rejects.toMatchObject({ code: 'invalid_response' })
    vi.stubGlobal('fetch', async () => Response.json({ results: { channels: [{ alternatives: [{ transcript: 'x'.repeat(8_000_001) }] }] } }))
    await expect(invoke()).rejects.toMatchObject({ code: 'response_limit' })
  })

  it('returns a long billed transcript even when word details exceed the old response limit', async () => {
    const transcript = 'a'.repeat(65_000)
    const words = Array.from({ length: 5_000 }, () => ({ word: 'hello', start: 0, end: 0.5, confidence: 0.9 }))
    const payload = { results: { channels: [{ alternatives: [{ transcript, words }] }] } }
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(250_000)
    vi.stubGlobal('fetch', async () => Response.json(payload))
    const result = await deepgramConnector.executeMutation!({ source, capabilityName: 'transcription.bytes', args, idempotencyKey: 'voice-2' })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.data).toEqual({ text: transcript, requestId: null, model: 'nova-3', language: 'multi' })
  })

  it('keeps existing Deepgram reads and mutations delegated to the base adapter', async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ projects: [{ project_id: 'project-1' }] }))
    vi.stubGlobal('fetch', send)
    const read = await deepgramConnector.executeRead!({ source, capabilityName: 'projects.list', args: {}, idempotencyKey: 'read-1' })
    expect(read.data).toEqual({ projects: [{ project_id: 'project-1' }] })
    expect(String(send.mock.calls[0]?.[0])).toBe('https://api.deepgram.com/v1/projects')
    send.mockImplementation(async () => Response.json({ request_id: 'request-2' }))
    const mutation = await deepgramConnector.executeMutation!({ source, capabilityName: 'transcription.create',
      args: { url: 'https://example.com/audio.ogg' }, idempotencyKey: 'write-1' })
    expect(mutation.status).toBe('committed')
  })
})
