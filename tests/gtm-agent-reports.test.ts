import { afterEach, expect, it, vi } from 'vitest'
import { gtmAgentConnector } from '../src/connectors/adapters/gtm-agent'
import { CredentialsExpired, type ResolvedDataSource } from '../src/connectors/types'

const source: ResolvedDataSource = {
  id: 'report-connection', projectId: 'owner', publishedAgentId: null,
  kind: 'gtm-agent', label: 'Campaign report', consistencyModel: 'authoritative',
  scopes: [], metadata: {}, credentials: { kind: 'api-key', apiKey: 'qualification-key' }, status: 'active',
}

afterEach(() => vi.unstubAllGlobals())

it('uses one fixed-origin read surface and never forwards campaign, cohort or URL overrides', async () => {
  const report = { campaign: 'launch', traffic: 'test', totals: { signedInIdentities: 1 }, unknown: { revenueUsd: null } }
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(report))
  vi.stubGlobal('fetch', fetch)
  const result = await gtmAgentConnector.executeRead!({
    source, capabilityName: 'acquisition.get', idempotencyKey: 'read-proof',
    args: { days: 7, campaign: 'other', traffic: 'all', url: 'https://example.com' },
  })
  expect(result.data).toEqual(report)
  expect(gtmAgentConnector.manifest.capabilities.map(capability => capability.class)).toEqual(['read'])
  const [url, request] = fetch.mock.calls[0]!
  expect(String(url)).toBe('https://gtm.tangle.tools/api/acquisition/report?days=7')
  expect(request?.method).toBe('GET')
  expect(request?.headers).toMatchObject({ authorization: 'Bearer qualification-key' })
})

it('checks the credential binding and surfaces a revoked credential as failure', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: 'access_denied' }, { status: 403 }))
  vi.stubGlobal('fetch', fetch)
  expect(await gtmAgentConnector.test!(source)).toMatchObject({ ok: false })
  expect(String(fetch.mock.calls[0]?.[0])).toBe('https://gtm.tangle.tools/api/acquisition/connection')
  await expect(gtmAgentConnector.executeRead!({ source, capabilityName: 'acquisition.get', args: { days: 1 }, idempotencyKey: 'revoked-proof' }))
    .rejects.toBeInstanceOf(CredentialsExpired)
})
