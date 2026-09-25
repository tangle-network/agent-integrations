import { afterEach, describe, expect, it, vi } from 'vitest'
import { adpConnector } from '../src/connectors/adapters/adp.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

// NOTE: ADP mandates mutual-TLS client certs the shared runtime cannot present,
// so these tests stub fetch — they validate the manifest shape and request
// construction, not live execution (which is gated on follow-up cert plumbing).

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_adp_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'adp',
    label: 'Drew ADP',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'adp-access-token' },
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

describe('adp executeRead (stubbed fetch — mTLS not exercised)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists workers with bearer auth, the practitioner roleCode header, and OData $top', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      return jsonResponse({ workers: [{ associateOID: 'AOID1' }], meta: { totalNumber: 1 } })
    }))

    await adpConnector.executeRead!({
      source: source(),
      capabilityName: 'worker.list',
      args: { top: 100 },
      idempotencyKey: 'k',
    })

    const url = new URL(capturedUrl)
    expect(url.origin).toBe('https://api.adp.com')
    expect(url.pathname).toBe('/hr/v2/workers')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(capturedHeaders['authorization']).toBe('Bearer adp-access-token')
    expect(capturedHeaders['roleCode']).toBe('practitioner')
  })

  it('reads a single pay statement by aoid + payStatementId', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ payStatements: [{ payDate: '2026-06-15' }] })
    }))

    await adpConnector.executeRead!({
      source: source(),
      capabilityName: 'paystatements.get',
      args: { aoid: 'AOID1', payStatementId: 'PS9' },
      idempotencyKey: 'k',
    })
    expect(new URL(capturedUrl).pathname).toBe('/payroll/v1/workers/AOID1/pay-statements/PS9')
  })

  it('rejects when the required aoid path arg is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adpConnector.executeRead!({
        source: source(),
        capabilityName: 'worker.get',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/aoid/)
  })
})
