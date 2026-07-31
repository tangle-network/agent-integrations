import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getIntegrationSpec,
  neverbounceConnector,
  validateConnectorManifest,
} from '../src/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { listActivepiecesCatalogEntries } from '../src/activepieces-catalog.js'

function source(): ResolvedDataSource {
  return {
    id: 'source_neverbounce',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'neverbounce',
    label: 'NeverBounce test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'customer-api-key' },
    status: 'active',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('NeverBounce connector', () => {
  it('ships a valid metered verification capability', () => {
    expect(validateConnectorManifest(neverbounceConnector.manifest)).toEqual({
      ok: true,
      issues: [],
    })
    expect(neverbounceConnector.manifest.kind).toBe('neverbounce')
    expect(neverbounceConnector.manifest.auth.kind).toBe('api-key')
    expect(neverbounceConnector.manifest.capabilities).toEqual([
      expect.objectContaining({
        name: 'verify.email.address',
        class: 'mutation',
        cas: 'native-idempotency',
        externalEffect: true,
      }),
    ])
  })

  it('publishes executable setup metadata with a secret API-key field', () => {
    const spec = getIntegrationSpec('neverbounce')
    expect(spec?.status).toBe('executable')
    expect(spec?.auth.mode).toBe('api_key')
    expect(spec?.setup.credentialFields).toEqual([
      expect.objectContaining({ label: 'NeverBounce API key', secret: true }),
    ])
    expect(spec?.setup.healthcheck).toMatchObject({
      id: 'neverbounce.connection',
      level: 'connection',
    })
  })

  it('keeps action input out of the imported credential schema', () => {
    const catalogEntry = listActivepiecesCatalogEntries().find(
      (entry) => entry.id === 'neverbounce',
    )
    expect(catalogEntry?.category).toBe('crm')
    expect(catalogEntry?.authFields).toEqual([
      expect.objectContaining({
        key: 'apiKey',
        secret: true,
      }),
    ])
  })

  it('sends the address and credential only in documented query parameters', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return new Response(JSON.stringify({ result: 'valid' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const result = await neverbounceConnector.executeMutation!({
      source: source(),
      capabilityName: 'verify.email.address',
      args: { email: 'ada@example.com' },
      idempotencyKey: 'verify-ada-1',
    })

    expect(requestUrl).toBe(
      'https://api.neverbounce.com/v4.2/single/check?email=ada%40example.com&key=customer-api-key',
    )
    expect(result.status).toBe('committed')
  })

  it('redacts a rejected query credential from provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'bad key customer-api-key',
      { status: 401 },
    )))

    await expect(neverbounceConnector.test(source())).resolves.toMatchObject({
      ok: false,
      reason: expect.not.stringContaining('customer-api-key'),
    })
  })
})
