import { afterEach, describe, expect, it, vi } from 'vitest'
import { adobeSignConnector } from '../src/connectors/adapters/adobe-sign.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

afterEach(() => vi.unstubAllGlobals())

describe('Adobe Acrobat Sign adapter', () => {
  it('lists agreements through the account API access point', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ userAgreementList: [] })
    }))

    await adobeSignConnector.executeRead!({
      source: source(),
      capabilityName: 'agreements.list',
      args: { pageSize: 25 },
      idempotencyKey: 'list-agreements',
    })

    expect(requestUrl).toBe('https://api.eu1.adobesign.com/api/rest/v6/agreements?pageSize=25')
    expect(requestHeaders.authorization).toBe('Bearer adobe-access-token')
  })

  it('cancels an agreement with the documented state transition', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({})
    }))

    const result = await adobeSignConnector.executeMutation!({
      source: source(),
      capabilityName: 'agreements.cancel',
      args: { agreementId: 'agr_1', comment: 'Customer withdrew' },
      idempotencyKey: 'cancel-agr-1',
    })

    expect(requestUrl).toBe('https://api.eu1.adobesign.com/api/rest/v6/agreements/agr_1/state')
    expect(requestBody).toEqual({ state: 'CANCELLED', comment: 'Customer withdrew' })
    expect(result.status).toBe('committed')
  })
})

function source(): ResolvedDataSource {
  return {
    id: 'source_adobe_sign',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'adobe-sign',
    label: 'Adobe Sign',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiAccessPoint: 'https://api.eu1.adobesign.com/api/rest/v6' },
    credentials: { kind: 'oauth2', accessToken: 'adobe-access-token' },
    status: 'active',
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
