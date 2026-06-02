import { afterEach, describe, expect, it, vi } from 'vitest'
import { pipedriveConnector } from '../src/connectors/adapters/pipedrive.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pipedrive_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pipedrive',
    label: 'Drew CRM',
    consistencyModel: 'authoritative',
    scopes: ['deals:full', 'contacts:full', 'leads:full', 'activities:full'],
    metadata: { apiDomain: 'https://acme-sandbox.pipedrive.com' },
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
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

describe('pipedrive adapter manifest', () => {
  it('classifies itself as the crm category and exposes the pipedrive kind', () => {
    expect(pipedriveConnector.manifest.kind).toBe('pipedrive')
    expect(pipedriveConnector.manifest.category).toBe('crm')
    expect(pipedriveConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented Pipedrive endpoints and env-var names', () => {
    const auth = pipedriveConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://oauth.pipedrive.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://oauth.pipedrive.com/oauth/token')
    expect(auth.clientIdEnv).toBe('PIPEDRIVE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('PIPEDRIVE_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('activities:full')
    expect(auth.scopes).toContain('contacts:full')
  })

  it('exposes activities.create and notes.create as native-idempotency mutations', () => {
    const caps = pipedriveConnector.manifest.capabilities
    const activitiesCreate = caps.find((c) => c.name === 'activities.create')
    const notesCreate = caps.find((c) => c.name === 'notes.create')
    expect(activitiesCreate).toBeDefined()
    expect(notesCreate).toBeDefined()
    if (!activitiesCreate || !notesCreate) throw new Error('unreachable')
    expect(activitiesCreate.class).toBe('mutation')
    expect(notesCreate.class).toBe('mutation')
    if (activitiesCreate.class !== 'mutation' || notesCreate.class !== 'mutation') {
      throw new Error('unreachable')
    }
    expect(activitiesCreate.cas).toBe('native-idempotency')
    expect(activitiesCreate.externalEffect).toBe(true)
    expect(activitiesCreate.requiredScopes).toEqual(['activities:full'])
    expect(notesCreate.cas).toBe('native-idempotency')
    expect(notesCreate.externalEffect).toBe(true)
    expect(notesCreate.requiredScopes).toEqual(['contacts:full'])
  })

  it('marks subject+type as required for activities.create', () => {
    const cap = pipedriveConnector.manifest.capabilities.find((c) => c.name === 'activities.create')
    if (!cap) throw new Error('unreachable')
    const params = cap.parameters as { required?: string[] }
    expect(params.required).toEqual(['subject', 'type'])
  })

  it('marks content as required for notes.create', () => {
    const cap = pipedriveConnector.manifest.capabilities.find((c) => c.name === 'notes.create')
    if (!cap) throw new Error('unreachable')
    const params = cap.parameters as { required?: string[] }
    expect(params.required).toEqual(['content'])
  })
})

describe('pipedrive adapter activities.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /v1/activities with full body and returns committed result', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = { url: String(input), init: init ?? {} }
        return jsonResponse({ success: true, data: { id: 42, subject: 'Call Drew', type: 'call' } })
      }),
    )

    const result = await pipedriveConnector.executeMutation!({
      source: source(),
      capabilityName: 'activities.create',
      args: {
        subject: 'Call Drew',
        type: 'call',
        due_date: '2026-06-10',
        due_time: '14:00',
        deal_id: 7,
        person_id: 11,
        org_id: 3,
        note: 'Quarterly check-in',
      },
      idempotencyKey: 'idemp-act-1',
    })

    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(typeof result.committedAt).toBe('number')
    expect(result.idempotentReplay).toBe(false)
    expect(result.data).toEqual({ success: true, data: { id: 42, subject: 'Call Drew', type: 'call' } })
    if (!captured) throw new Error('fetch not called')
    expect((captured as { url: string }).url).toBe('https://acme-sandbox.pipedrive.com/v1/activities')
    expect((captured as { init: RequestInit }).init.method).toBe('POST')
    const headers = (captured as { init: RequestInit }).init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer at')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse((captured as { init: RequestInit }).init.body as string)
    expect(body).toEqual({
      subject: 'Call Drew',
      type: 'call',
      due_date: '2026-06-10',
      due_time: '14:00',
      deal_id: 7,
      person_id: 11,
      org_id: 3,
      note: 'Quarterly check-in',
    })
  })

  it('falls back to api.pipedrive.com when metadata.apiDomain is missing', async () => {
    let capturedUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse({ success: true, data: { id: 1 } })
      }),
    )
    await pipedriveConnector.executeMutation!({
      source: source({ metadata: {} }),
      capabilityName: 'activities.create',
      args: { subject: 's', type: 'call' },
      idempotencyKey: 'k',
    })
    expect(capturedUrl).toBe('https://api.pipedrive.com/v1/activities')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      pipedriveConnector.executeMutation!({
        source: source(),
        capabilityName: 'activities.create',
        args: { subject: 's', type: 'call' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      pipedriveConnector.executeMutation!({
        source: source(),
        capabilityName: 'activities.create',
        args: { subject: 's', type: 'call' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('pipedrive adapter notes.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /v1/notes with full body and returns committed result', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = { url: String(input), init: init ?? {} }
        return jsonResponse({ success: true, data: { id: 99, content: 'Met onsite' } })
      }),
    )

    const result = await pipedriveConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.create',
      args: {
        content: 'Met onsite',
        deal_id: 7,
        person_id: 11,
        org_id: 3,
      },
      idempotencyKey: 'idemp-note-1',
    })

    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(typeof result.committedAt).toBe('number')
    expect(result.idempotentReplay).toBe(false)
    expect(result.data).toEqual({ success: true, data: { id: 99, content: 'Met onsite' } })
    if (!captured) throw new Error('fetch not called')
    expect((captured as { url: string }).url).toBe('https://acme-sandbox.pipedrive.com/v1/notes')
    expect((captured as { init: RequestInit }).init.method).toBe('POST')
    const body = JSON.parse((captured as { init: RequestInit }).init.body as string)
    expect(body).toEqual({
      content: 'Met onsite',
      deal_id: 7,
      person_id: 11,
      org_id: 3,
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      pipedriveConnector.executeMutation!({
        source: source(),
        capabilityName: 'notes.create',
        args: { content: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      pipedriveConnector.executeMutation!({
        source: source(),
        capabilityName: 'notes.create',
        args: { content: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
