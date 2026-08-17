import { afterEach, describe, expect, it, vi } from 'vitest'
import { oneSpanSignConnector } from '../src/connectors/adapters/onespan-sign.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

afterEach(() => vi.unstubAllGlobals())

describe('OneSpan Sign adapter', () => {
  it('declares customer-key auth and executable package actions', () => {
    expect(oneSpanSignConnector.manifest.kind).toBe('onespan-sign')
    expect(oneSpanSignConnector.manifest.category).toBe('doc')
    expect(oneSpanSignConnector.manifest.auth.kind).toBe('api-key')
    expect(oneSpanSignConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'packages.list',
      'packages.get',
      'packages.create',
      'packages.send',
      'packages.delete',
      'documents.add',
      'roles.add',
    ])
  })

  it('tests the regional tenant with HTTP Basic auth', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ company: 'Tangle' })
    }))

    await expect(oneSpanSignConnector.test(source())).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe('https://sandbox.esignlive.com/api/account')
    expect(requestHeaders.Authorization).toBe('Basic encoded-onespan-credential')
  })

  it('sends a package through the status transition endpoint', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ id: 'pkg_1', status: 'SENT' })
    }))

    const result = await oneSpanSignConnector.executeMutation!({
      source: source(),
      capabilityName: 'packages.send',
      args: { packageId: 'pkg_1' },
      idempotencyKey: 'send-pkg-1',
    })

    expect(requestUrl).toBe('https://sandbox.esignlive.com/api/packages/pkg_1')
    expect(requestBody).toEqual({ status: 'SENT' })
    expect(result.status).toBe('committed')
  })

  it('surfaces expired credentials on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(oneSpanSignConnector.executeRead!({
      source: source(),
      capabilityName: 'packages.get',
      args: { packageId: 'pkg_1' },
      idempotencyKey: 'read-pkg-1',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

function source(): ResolvedDataSource {
  return {
    id: 'source_onespan_sign',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'onespan-sign',
    label: 'OneSpan Sign',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'encoded-onespan-credential' },
    status: 'active',
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
