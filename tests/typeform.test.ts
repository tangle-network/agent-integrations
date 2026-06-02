import { afterEach, describe, expect, it, vi } from 'vitest'
import { typeformConnector } from '../src/connectors/adapters/typeform.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_typeform_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'typeform',
    label: 'typeform test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'tf_secret' },
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

describe('typeform adapter manifest (write extensions)', () => {
  it('exposes the new forms + themes + images capabilities', () => {
    const names = typeformConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('forms.create')
    expect(names).toContain('forms.delete')
    expect(names).toContain('themes.list')
    expect(names).toContain('images.create')
  })

  it('marks every new mutation as native-idempotency + external effect', () => {
    const targets = ['forms.create', 'forms.delete', 'images.create']
    for (const target of targets) {
      const cap = typeformConnector.manifest.capabilities.find((c) => c.name === target)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`expected mutation: ${target}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('typeform forms.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the supplied form envelope to /forms with bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    let requestHeaders: Record<string, string> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? String(init.body) : undefined
        requestHeaders = init?.headers as Record<string, string>
        return jsonResponse({ id: 'form_new', title: 'Survey' }, { status: 201 })
      }),
    )

    const result = await typeformConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.create',
      args: { fields: { title: 'Survey', fields: [], settings: { language: 'en' } } },
      idempotencyKey: 'fc-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/forms')
    expect(requestHeaders?.authorization).toBe('Bearer tf_secret')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      title: 'Survey',
      fields: [],
      settings: { language: 'en' },
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      typeformConnector.executeMutation!({
        source: source(),
        capabilityName: 'forms.create',
        args: { fields: { title: 't' } },
        idempotencyKey: 'fc-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('typeform forms.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /forms/{form_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse(null, { status: 204 })
      }),
    )

    const result = await typeformConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.delete',
      args: { form_id: 'form_xyz' },
      idempotencyKey: 'fd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/forms/form_xyz')
  })
})

describe('typeform themes.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /themes with pagination args', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ items: [], total_items: 0, page_count: 0 })
      }),
    )

    await typeformConnector.executeRead!({
      source: source(),
      capabilityName: 'themes.list',
      args: { page: 1, page_size: 50 },
      idempotencyKey: 'tl-1',
    })

    expect(String(requestUrl)).toContain('/themes')
    expect(String(requestUrl)).toContain('page=1')
    expect(String(requestUrl)).toContain('page_size=50')
  })
})

describe('typeform images.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /images with the supplied file_name + image envelope', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? String(init.body) : undefined
        return jsonResponse({ id: 'img_1', file_name: 'logo.png' }, { status: 201 })
      }),
    )

    const result = await typeformConnector.executeMutation!({
      source: source(),
      capabilityName: 'images.create',
      args: {
        file_name: 'logo.png',
        image: { value: 'aGVsbG8=', type: 'image/png' },
      },
      idempotencyKey: 'ic-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/images')
    const parsed = JSON.parse(requestBody ?? '{}')
    expect(parsed.file_name).toBe('logo.png')
    expect(parsed.image).toEqual({ value: 'aGVsbG8=', type: 'image/png' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      typeformConnector.executeMutation!({
        source: source(),
        capabilityName: 'images.create',
        args: { file_name: 'logo.png' },
        idempotencyKey: 'ic-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
