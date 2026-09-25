import { afterEach, describe, expect, it, vi } from 'vitest'
import { azureCommunicationServicesConnector } from '../src/connectors/adapters/azure-communication-services.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_acs_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'azure-communication-services',
    label: 'ACS test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { endpoint: 'https://my-acs.communication.azure.com' },
    credentials: { kind: 'api-key', apiKey: 'acs_secret' },
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

describe('azure-communication-services send.sms', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /sms with api-version query and structured smsRecipients', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ value: [{ to: '+15550101', messageId: 'msg_1' }] })
      }),
    )
    const result = await azureCommunicationServicesConnector.executeMutation!({
      source: source(),
      capabilityName: 'send.sms',
      args: {
        from: '+15550100',
        smsRecipients: [{ to: '+15550101' }],
        message: 'hi there',
      },
      idempotencyKey: 'idemp-sms-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('https://my-acs.communication.azure.com/sms')
    expect(capturedUrl).toContain('api-version=2021-03-07')
    expect(capturedBody).toMatchObject({
      from: '+15550100',
      message: 'hi there',
    })
    expect(result.status).toBe('committed')
  })
})

describe('azure-communication-services chat.thread.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /chat/threads with topic + participants', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ chatThread: { id: 'thread_1', topic: 'Standup' } })
      }),
    )
    const participants = [
      { id: { communicationUser: { id: 'u_1' } }, displayName: 'Alice' },
    ]
    const result = await azureCommunicationServicesConnector.executeMutation!({
      source: source(),
      capabilityName: 'chat.thread.create',
      args: { topic: 'Standup', participants },
      idempotencyKey: 'idemp-thr-1',
    })
    expect(capturedUrl).toContain('/chat/threads')
    expect(capturedBody).toMatchObject({ topic: 'Standup', participants })
    expect(result.status).toBe('committed')
  })
})

describe('azure-communication-services chat.message.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /chat/threads/{threadId}/messages', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'msg_1' })
      }),
    )
    const result = await azureCommunicationServicesConnector.executeMutation!({
      source: source(),
      capabilityName: 'chat.message.send',
      args: {
        threadId: 'thread_1',
        message: {
          content: 'hello world',
          senderDisplayName: 'Alice',
          type: 'text',
        },
      },
      idempotencyKey: 'idemp-msg-1',
    })
    expect(capturedUrl).toContain('/chat/threads/thread_1/messages')
    expect(capturedBody).toEqual({
      content: 'hello world',
      senderDisplayName: 'Alice',
      type: 'text',
    })
    expect(result.status).toBe('committed')
  })
})
