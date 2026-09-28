import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  smartleadConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

describe('Smartlead API-key placement', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the customer key in api_key rather than an unsupported bearer header', async () => {
    let requestUrl = ''
    let authorization: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization')
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await smartleadConnector.test(source())
    expect(requestUrl).toBe('https://api.smartlead.io/v1/campaigns?api_key=customer-key')
    expect(authorization).toBeNull()
  })
})

function source(): ResolvedDataSource {
  return {
    id: 'source_smartlead',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'smartlead',
    label: 'Smartlead',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'customer-key' },
    status: 'active',
  }
}
