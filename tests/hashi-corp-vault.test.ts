import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashiCorpVaultConnector } from '../src/connectors/adapters/hashi-corp-vault.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vault_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'hashi-corp-vault',
    label: 'vault test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { vaultUrl: 'https://vault.example.com' },
    credentials: { kind: 'api-key', apiKey: 'vault_client_token' },
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

describe('hashi-corp-vault adapter manifest', () => {
  it('exposes the hashi-corp-vault kind and other category', () => {
    expect(hashiCorpVaultConnector.manifest.kind).toBe('hashi-corp-vault')
    expect(hashiCorpVaultConnector.manifest.category).toBe('other')
    expect(hashiCorpVaultConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = hashiCorpVaultConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers KV read/write/delete/list plus kv.* aliases and token/lease revocation', () => {
    const names = hashiCorpVaultConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'secrets.delete',
        'secrets.list',
        'secrets.read',
        'secrets.write',
        'kv.write',
        'kv.delete',
        'token.revoke',
        'lease.revoke',
      ].sort(),
    )
    const reads = hashiCorpVaultConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = hashiCorpVaultConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['secrets.list', 'secrets.read'].sort())
    expect(mutations).toEqual(
      [
        'secrets.delete',
        'secrets.write',
        'kv.write',
        'kv.delete',
        'token.revoke',
        'lease.revoke',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['kv.write', 'kv.delete', 'token.revoke', 'lease.revoke']
    for (const name of expected) {
      const cap = hashiCorpVaultConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('hashi-corp-vault kv.write', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/{engine}/data/{path} with the secret payload and X-Vault-Token header', async () => {
    let requestUrl: string | undefined
    let requestHeaders: Headers | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { version: 1 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await hashiCorpVaultConnector.executeMutation!({
      source: source(),
      capabilityName: 'kv.write',
      args: { secretEngine: 'secret', secretPath: 'mydb', secretData: { user: 'u' } },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://vault.example.com/v1/secret/data/mydb')
    expect(requestHeaders?.get('x-vault-token')).toBe('vault_client_token')
    expect(requestBody).toMatchObject({ data: { user: 'u' } })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(
      hashiCorpVaultConnector.executeMutation!({
        source: source(),
        capabilityName: 'kv.write',
        args: { secretEngine: 'secret', secretPath: 'p', secretData: {} },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('hashi-corp-vault kv.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/{engine}/metadata/{path}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await hashiCorpVaultConnector.executeMutation!({
      source: source(),
      capabilityName: 'kv.delete',
      args: { secretEngine: 'secret', secretPath: 'mydb' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://vault.example.com/v1/secret/metadata/mydb')
  })
})

describe('hashi-corp-vault token.revoke', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/auth/token/revoke with the token in the body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await hashiCorpVaultConnector.executeMutation!({
      source: source(),
      capabilityName: 'token.revoke',
      args: { token: 'hvs.target_token' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://vault.example.com/v1/auth/token/revoke')
    expect(requestBody).toMatchObject({ token: 'hvs.target_token' })
  })
})

describe('hashi-corp-vault lease.revoke', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/sys/leases/revoke with the lease id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await hashiCorpVaultConnector.executeMutation!({
      source: source(),
      capabilityName: 'lease.revoke',
      args: { leaseId: 'database/creds/role/abc', sync: true },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toBe('https://vault.example.com/v1/sys/leases/revoke')
    expect(requestBody).toMatchObject({ lease_id: 'database/creds/role/abc', sync: true })
  })
})
