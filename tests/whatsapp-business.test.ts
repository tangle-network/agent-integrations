import { afterEach, describe, expect, it, vi } from 'vitest'
import { whatsappBusiness } from '../src/connectors/adapters/whatsapp-business.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const connector = whatsappBusiness({ clientId: 'cid', clientSecret: 'csec' })

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wab_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'whatsapp-business',
    label: 'whatsapp-business test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: { phoneNumberId: 'PNID_42', wabaId: 'WABA_7' },
    credentials: { kind: 'oauth2', accessToken: 'meta_long_lived_token' },
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

describe('whatsapp-business adapter manifest', () => {
  it('marks every mutation as native-idempotency external effect', () => {
    const mutations = connector.manifest.capabilities.filter((c) => c.class === 'mutation')
    // We added 4 new ones plus the existing 2 sends (which are `none` since
    // Meta doesn't expose idempotency on /messages); only assert the NEW set.
    const newOnes = ['media.upload', 'templates.create', 'templates.delete', 'messages.mark-read']
    for (const name of newOnes) {
      const cap = connector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes the new mutation capabilities alongside the existing ones', () => {
    const names = connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('media.upload')
    expect(names).toContain('templates.create')
    expect(names).toContain('templates.delete')
    expect(names).toContain('messages.mark-read')
    expect(names).toContain('send_text_message')
    expect(names).toContain('send_template_message')
    expect(names).toContain('list_message_templates')
    expect(names).toContain('get_business_phone_number')
  })
})

describe('whatsapp-business media.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs multipart to /{phoneNumberId}/media and returns the media id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    let requestHeaders: Record<string, string> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ id: 'MEDIA_999' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'media.upload',
      args: {
        // "hi" base64-encoded
        dataBase64: 'aGk=',
        mimeType: 'image/jpeg',
        filename: 'pic.jpg',
      },
      idempotencyKey: 'upload-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/PNID_42/media')
    expect(requestBody).toBeInstanceOf(FormData)
    const form = requestBody as FormData
    expect(form.get('messaging_product')).toBe('whatsapp')
    expect(form.get('type')).toBe('image/jpeg')
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect(requestHeaders?.authorization).toBe('Bearer meta_long_lived_token')
    if (result.status !== 'committed') throw new Error('unreachable')
    const data = result.data as { mediaId: string }
    expect(data.mediaId).toBe('MEDIA_999')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      connector.executeMutation!({
        source: source(),
        capabilityName: 'media.upload',
        args: { dataBase64: 'aGk=', mimeType: 'image/jpeg' },
        idempotencyKey: 'upload-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('whatsapp-business templates.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs JSON body to /{wabaId}/message_templates', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = String(init?.body)
        return jsonResponse({ id: 'TPL_1', status: 'PENDING', category: 'UTILITY' })
      }),
    )

    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'templates.create',
      args: {
        name: 'order_confirm',
        language: 'en_US',
        category: 'UTILITY',
        components: [
          { type: 'BODY', text: 'Your order {{1}} is confirmed.' },
        ],
      },
      idempotencyKey: 'tpl-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/WABA_7/message_templates')
    const parsed = JSON.parse(requestBody ?? '{}') as {
      name: string
      language: string
      category: string
      components: unknown[]
    }
    expect(parsed.name).toBe('order_confirm')
    expect(parsed.language).toBe('en_US')
    expect(parsed.category).toBe('UTILITY')
    expect(parsed.components).toHaveLength(1)
    if (result.status !== 'committed') throw new Error('unreachable')
    const data = result.data as { templateId: string; templateStatus: string }
    expect(data.templateId).toBe('TPL_1')
    expect(data.templateStatus).toBe('PENDING')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      connector.executeMutation!({
        source: source(),
        capabilityName: 'templates.create',
        args: {
          name: 'order_confirm',
          language: 'en_US',
          category: 'UTILITY',
          components: [],
        },
        idempotencyKey: 'tpl-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('whatsapp-business templates.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /{wabaId}/message_templates?name=...', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ success: true })
      }),
    )

    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'templates.delete',
      args: { name: 'order_confirm' },
      idempotencyKey: 'tpl-del-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/WABA_7/message_templates')
    expect(String(requestUrl)).toContain('name=order_confirm')
    if (result.status !== 'committed') throw new Error('unreachable')
    const data = result.data as { success: boolean }
    expect(data.success).toBe(true)
  })

  it('appends hsm_id when supplied', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse({ success: true })
      }),
    )
    await connector.executeMutation!({
      source: source(),
      capabilityName: 'templates.delete',
      args: { name: 'order_confirm', hsmId: 'HSM_123' },
      idempotencyKey: 'tpl-del-2',
    })
    expect(String(requestUrl)).toContain('hsm_id=HSM_123')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      connector.executeMutation!({
        source: source(),
        capabilityName: 'templates.delete',
        args: { name: 'order_confirm' },
        idempotencyKey: 'tpl-del-3',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('whatsapp-business messages.mark-read', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs status=read JSON body to /{phoneNumberId}/messages', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = String(init?.body)
        return jsonResponse({ success: true })
      }),
    )

    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'messages.mark-read',
      args: { messageId: 'wamid.xyz123' },
      idempotencyKey: 'mr-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/PNID_42/messages')
    const parsed = JSON.parse(requestBody ?? '{}') as {
      messaging_product: string
      status: string
      message_id: string
    }
    expect(parsed.messaging_product).toBe('whatsapp')
    expect(parsed.status).toBe('read')
    expect(parsed.message_id).toBe('wamid.xyz123')
    if (result.status !== 'committed') throw new Error('unreachable')
    const data = result.data as { success: boolean }
    expect(data.success).toBe(true)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      connector.executeMutation!({
        source: source(),
        capabilityName: 'messages.mark-read',
        args: { messageId: 'wamid.abc' },
        idempotencyKey: 'mr-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
