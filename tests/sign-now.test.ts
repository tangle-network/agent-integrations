import { afterEach, describe, expect, it, vi } from 'vitest'
import { signNowConnector } from '../src/connectors/adapters/sign-now.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_signnow_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sign-now',
    label: 'sign-now test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'signnow_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('sign-now adapter manifest', () => {
  it('classifies itself as the docs category and exposes the sign-now kind', () => {
    expect(signNowConnector.manifest.kind).toBe('sign-now')
    expect(signNowConnector.manifest.category).toBe('doc')
    expect(signNowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = signNowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SignNow/i)
  })

  it('covers document upload/delete/download, invite send/cancel/resend, and template surface', () => {
    const names = signNowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.delete',
        'documents.download',
        'documents.get',
        'documents.upload',
        'invites.cancel',
        'invites.resend',
        'invites.send',
        'templates.create',
        'templates.createDocumentFromTemplate',
        'templates.get',
      ].sort(),
    )
    const mutations = signNowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'documents.delete',
        'documents.upload',
        'invites.cancel',
        'invites.resend',
        'invites.send',
        'templates.create',
        'templates.createDocumentFromTemplate',
      ].sort(),
    )
  })

  it('every new write-side mutation is native-idempotency with externalEffect:true', () => {
    const newNames = ['documents.delete', 'invites.resend', 'templates.create']
    for (const name of newNames) {
      const cap = signNowConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `${name} should exist`).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class === 'mutation') {
        expect(cap!.cas).toBe('native-idempotency')
        expect(cap!.externalEffect).toBe(true)
      }
    }
  })
})

describe('sign-now write-side execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('documents.delete DELETEs the document and reports committed on 204', async () => {
    let observedUrl = ''
    let observedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.delete',
      args: { documentId: 'doc_42' },
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('DELETE')
    expect(observedUrl).toBe('https://api.signnow.com/v2/documents/doc_42')
    expect(result.status).toBe('committed')
  })

  it('invites.resend POSTs the resend endpoint', async () => {
    let observedUrl = ''
    let observedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      return jsonResponse({ status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'invites.resend',
      args: { documentId: 'doc_42', inviteId: 'inv_7' },
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('POST')
    expect(observedUrl).toBe(
      'https://api.signnow.com/v2/documents/doc_42/invites/inv_7/resend',
    )
    expect(result.status).toBe('committed')
  })

  it('documents.download GETs the download endpoint with optional type query', async () => {
    let observedUrl = ''
    let observedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      return jsonResponse({ url: 'https://files.signnow.com/abc', name: 'signed.pdf' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signNowConnector.executeRead!({
      source: source(),
      capabilityName: 'documents.download',
      args: { documentId: 'doc_42', type: 'collapsed' },
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('GET')
    expect(observedUrl).toBe(
      'https://api.signnow.com/v2/documents/doc_42/download?type=collapsed',
    )
    const data = result.data as { url: string; name: string }
    expect(data.url).toBe('https://files.signnow.com/abc')
  })

  it('templates.create POSTs /documents/{id}/template with document_name', async () => {
    let observedUrl = ''
    let observedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'tpl_99', name: 'Onboarding template' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'templates.create',
      args: { documentId: 'doc_42', templateName: 'Onboarding template' },
      idempotencyKey: 'k1',
    })

    expect(observedUrl).toBe('https://api.signnow.com/v2/documents/doc_42/template')
    expect(observedBody).toEqual({ document_name: 'Onboarding template' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired when SignNow rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      signNowConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.delete',
        args: { documentId: 'doc_42' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
