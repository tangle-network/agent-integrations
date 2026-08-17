import { afterEach, describe, expect, it, vi } from 'vitest'
import { digitalOceanConnector } from '../src/connectors/adapters/digital-ocean.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return { id: 'src_do_1', projectId: 'proj_1', publishedAgentId: null, kind: 'digital-ocean', label: 'DigitalOcean test', consistencyModel: 'authoritative', scopes: [], metadata: {}, credentials: { kind: 'api-key', apiKey: 'do-secret' }, status: 'active' }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('DigitalOcean adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exposes infrastructure reads and approval-gated resource changes', () => {
    expect(digitalOceanConnector.manifest).toMatchObject({ kind: 'digital-ocean', category: 'other', auth: { kind: 'api-key' } })
    expect(digitalOceanConnector.manifest.capabilities).toHaveLength(23)
    for (const capability of digitalOceanConnector.manifest.capabilities.filter((item) => item.class === 'mutation')) {
      expect(capability.externalEffect, capability.name).toBe(true)
    }
  })

  it('checks the account with bearer authentication', async () => {
    let url = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return json({ account: { status: 'active' } })
    }))
    await expect(digitalOceanConnector.test!(source())).resolves.toEqual({ ok: true })
    expect(url).toBe('https://api.digitalocean.com/v2/account')
    expect(authorization).toBe('Bearer do-secret')
  })

  it('renders Droplet filters with official query names', async () => {
    let url = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { url = String(input); return json({ droplets: [] }) }))
    await digitalOceanConnector.executeRead!({ source: source(), capabilityName: 'droplets.list', args: { page: 2, perPage: 100, tagName: 'tangle', name: 'worker' }, idempotencyKey: 'list' })
    expect(url).toBe('https://api.digitalocean.com/v2/droplets?page=2&per_page=100&tag_name=tangle&name=worker')
  })

  it('creates an app with the exact spec envelope', async () => {
    let body: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return json({ app: { id: 'app-1' } }) }))
    await digitalOceanConnector.executeMutation!({ source: source(), capabilityName: 'apps.create', args: { spec: { name: 'hub', region: 'nyc' } }, idempotencyKey: 'create-app' })
    expect(body).toEqual({ spec: { name: 'hub', region: 'nyc' } })
  })

  it('runs provider-native Droplet actions and deletes exact resources', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { requests.push({ url: String(input), method: init?.method ?? '', body: init?.body ? JSON.parse(String(init.body)) : null }); return json({ action: { id: 1 } }) }))
    await digitalOceanConnector.executeMutation!({ source: source(), capabilityName: 'droplets.action', args: { dropletId: 42, action: { type: 'snapshot', name: 'backup' } }, idempotencyKey: 'action' })
    await digitalOceanConnector.executeMutation!({ source: source(), capabilityName: 'volumes.delete', args: { volumeId: 'vol-1' }, idempotencyKey: 'delete' })
    expect(requests).toEqual([
      { url: 'https://api.digitalocean.com/v2/droplets/42/actions', method: 'POST', body: { type: 'snapshot', name: 'backup' } },
      { url: 'https://api.digitalocean.com/v2/volumes/vol-1', method: 'DELETE', body: null },
    ])
  })

  it('redacts bearer credentials from errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('token do-secret rejected', { status: 500 })))
    await expect(digitalOceanConnector.executeRead!({ source: source(), capabilityName: 'account.get', args: {}, idempotencyKey: 'redaction' })).rejects.not.toThrow(/do-secret/)
  })
})
