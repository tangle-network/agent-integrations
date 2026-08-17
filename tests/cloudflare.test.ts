import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  cloudflareConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/registry.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_cloudflare_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'cloudflare',
    label: 'Cloudflare test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'dedicated-cloudflare-token' },
    status: 'active',
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Cloudflare adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ships scoped account, zone, and DNS actions with approval metadata', () => {
    expect(cloudflareConnector.manifest).toMatchObject({
      kind: 'cloudflare',
      category: 'other',
      auth: { kind: 'api-key' },
    })
    expect(cloudflareConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual([
      'accounts.get',
      'auth.verify',
      'dns.records.create',
      'dns.records.delete',
      'dns.records.export',
      'dns.records.get',
      'dns.records.list',
      'dns.records.update',
      'zones.get',
      'zones.list',
      'zones.settings.get',
      'zones.settings.list',
    ])
    for (const capability of cloudflareConnector.manifest.capabilities) {
      if (capability.class === 'mutation') expect(capability.externalEffect, capability.name).toBe(true)
    }

    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'cloudflare')
    expect(factory?.envMap).toEqual({})
    const spec = getIntegrationSpec('cloudflare')
    expect(spec).toMatchObject({
      status: 'executable',
      auth: { mode: 'api_key', placement: 'bearer' },
      setup: {
        credentialFields: [expect.objectContaining({ label: 'Dedicated Cloudflare API token', secret: true })],
      },
    })
    expect(spec?.setup.knownQuirks?.map((quirk) => quirk.id)).toEqual(
      expect.arrayContaining(['no-global-key', 'no-token-reuse', 'dns-impact']),
    )
    expect(spec?.setup.consoleSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'permissions',
        detail: expect.stringContaining('Zone Settings Read'),
      }),
    ]))
  })

  it('requires a valid active token in the connection check', async () => {
    let requestUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return json({ success: true, result: { id: 'token-id', status: 'active' } })
    }))

    await expect(cloudflareConnector.test!(source())).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe('https://api.cloudflare.com/client/v4/user/tokens/verify')
    expect(authorization).toBe('Bearer dedicated-cloudflare-token')

    vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, result: { status: 'disabled' } })))
    await expect(cloudflareConnector.test!(source())).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/expected result.status="active"/),
    })

    vi.stubGlobal('fetch', vi.fn(async () => json({ result: { status: 'active' } })))
    await expect(cloudflareConnector.test!(source())).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/expected success=true/),
    })
  })

  it('uses official account and DNS filter parameter names', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return json({ success: true, result: [] })
    }))

    await cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'zones.list',
      args: { accountId: 'account-1', name: 'example.com', status: 'active', page: 2, perPage: 25 },
      idempotencyKey: 'zones',
    })
    await cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'dns.records.list',
      args: {
        zoneId: 'zone-1',
        type: 'CNAME',
        name: 'app.example.com',
        proxied: true,
        order: 'name',
        direction: 'asc',
      },
      idempotencyKey: 'dns-list',
    })

    const zones = new URL(urls[0]!)
    expect(zones.pathname).toBe('/client/v4/zones')
    expect(zones.searchParams.get('account.id')).toBe('account-1')
    expect(zones.searchParams.get('name')).toBe('example.com')
    expect(zones.searchParams.get('per_page')).toBe('25')

    const records = new URL(urls[1]!)
    expect(records.pathname).toBe('/client/v4/zones/zone-1/dns_records')
    expect(records.searchParams.get('name.exact')).toBe('app.example.com')
    expect(records.searchParams.get('proxied')).toBe('true')
    expect(records.searchParams.get('order')).toBe('name')
  })

  it('uses the token-compatible account and zone-settings routes', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return json({ success: true, result: {} })
    }))

    await cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'accounts.get',
      args: { accountId: 'account-1' },
      idempotencyKey: 'account',
    })
    await cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'zones.settings.list',
      args: { zoneId: 'zone-1' },
      idempotencyKey: 'settings',
    })
    await cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'zones.settings.get',
      args: { zoneId: 'zone-1', settingId: 'ssl' },
      idempotencyKey: 'setting',
    })

    expect(urls).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/account-1',
      'https://api.cloudflare.com/client/v4/zones/zone-1/settings',
      'https://api.cloudflare.com/client/v4/zones/zone-1/settings/ssl',
    ])
  })

  it('creates, updates, and deletes only exact DNS record resources', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? '',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return json({ success: true, result: { id: 'record-1' } })
    }))

    await cloudflareConnector.executeMutation!({
      source: source(),
      capabilityName: 'dns.records.create',
      args: {
        zoneId: 'zone-1',
        record: { type: 'CNAME', name: 'app.example.com', content: 'target.example.net', proxied: true, ttl: 1 },
      },
      idempotencyKey: 'create-record',
    })
    await cloudflareConnector.executeMutation!({
      source: source(),
      capabilityName: 'dns.records.update',
      args: { zoneId: 'zone-1', recordId: 'record-1', changes: { content: 'new.example.net' } },
      idempotencyKey: 'update-record',
    })
    await cloudflareConnector.executeMutation!({
      source: source(),
      capabilityName: 'dns.records.delete',
      args: { zoneId: 'zone-1', recordId: 'record-1' },
      idempotencyKey: 'delete-record',
    })

    expect(requests).toEqual([
      {
        url: 'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records',
        method: 'POST',
        body: { type: 'CNAME', name: 'app.example.com', content: 'target.example.net', proxied: true, ttl: 1 },
      },
      {
        url: 'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/record-1',
        method: 'PATCH',
        body: { content: 'new.example.net' },
      },
      {
        url: 'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/record-1',
        method: 'DELETE',
        body: null,
      },
    ])
  })

  it('returns BIND exports without trying to parse them as JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('$ORIGIN example.com.\n@ 300 IN A 192.0.2.1\n')))
    await expect(cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'dns.records.export',
      args: { zoneId: 'zone-1' },
      idempotencyKey: 'export',
    })).resolves.toMatchObject({
      data: { raw: expect.stringContaining('$ORIGIN example.com.') },
    })
  })

  it('fails closed on revoked tokens and unadvertised infrastructure writes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 403)))
    await expect(cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'accounts.get',
      args: { accountId: 'account-1' },
      idempotencyKey: 'revoked',
    })).rejects.toThrow(/rejected credentials/)

    await expect(cloudflareConnector.executeMutation!({
      source: source(),
      capabilityName: 'workers.deploy',
      args: {},
      idempotencyKey: 'unadvertised',
    })).rejects.toThrow(/unknown mutation capability/)
  })

  it('redacts the bearer token from provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'dedicated-cloudflare-token was rejected',
      { status: 500 },
    )))
    await expect(cloudflareConnector.executeRead!({
      source: source(),
      capabilityName: 'accounts.get',
      args: { accountId: 'account-1' },
      idempotencyKey: 'redaction',
    })).rejects.not.toThrow(/dedicated-cloudflare-token/)
  })
})
