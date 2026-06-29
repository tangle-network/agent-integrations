import { afterEach, describe, expect, it, vi } from 'vitest'
import { amazonSecretsManagerConnector } from '../src/connectors/adapters/amazon-secrets-manager.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_secrets_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'amazon-secrets-manager',
    label: 'asm test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-key', region: 'us-east-1' }),
    },
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

describe('amazon-secrets-manager adapter manifest', () => {
  it('exposes the amazon-secrets-manager kind and other category', () => {
    expect(amazonSecretsManagerConnector.manifest.kind).toBe('amazon-secrets-manager')
    expect(amazonSecretsManagerConnector.manifest.category).toBe('other')
    expect(amazonSecretsManagerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = amazonSecretsManagerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full action set including rotate/restore/tag', () => {
    const names = amazonSecretsManagerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'secrets.get',
        'secrets.find',
        'secrets.password.random',
        'secrets.create',
        'secrets.update',
        'secrets.delete',
        'secrets.rotate',
        'secrets.restore',
        'secrets.tag',
      ].sort(),
    )
    const reads = amazonSecretsManagerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonSecretsManagerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['secrets.find', 'secrets.get', 'secrets.password.random'].sort())
    expect(mutations).toEqual(
      [
        'secrets.create',
        'secrets.delete',
        'secrets.update',
        'secrets.rotate',
        'secrets.restore',
        'secrets.tag',
      ].sort(),
    )
  })

  it('marks new mutations as native-idempotency external effect', () => {
    for (const name of ['secrets.rotate', 'secrets.restore', 'secrets.tag']) {
      const cap = amazonSecretsManagerConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('amazon-secrets-manager secrets.rotate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs RotateSecret with the SecretId', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ARN: 'arn:secret:x', Name: 'foo', VersionId: 'v1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await amazonSecretsManagerConnector.executeMutation!({
      source: source(),
      capabilityName: 'secrets.rotate',
      args: {
        name: 'foo',
        rotationLambdaArn: 'arn:aws:lambda:rotator',
        rotationRules: { AutomaticallyAfterDays: 30 },
        rotateImmediately: true,
        clientRequestToken: 'rot-1',
      },
      idempotencyKey: 'rot-1',
    })

    expect(capturedHeaders['X-Amz-Target']).toBe('secretsmanager.RotateSecret')
    // request is SigV4-signed against the secretsmanager service, not Bearer
    expect(capturedHeaders.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/secretsmanager\/aws4_request,/,
    )
    expect(capturedHeaders['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    expect(capturedBody).toMatchObject({
      SecretId: 'foo',
      RotationLambdaARN: 'arn:aws:lambda:rotator',
      RotateImmediately: true,
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      amazonSecretsManagerConnector.executeMutation!({
        source: source(),
        capabilityName: 'secrets.rotate',
        args: {
          name: 'foo',
          rotationLambdaArn: 'arn:aws:lambda:rotator',
          rotationRules: { AutomaticallyAfterDays: 30 },
          rotateImmediately: true,
          clientRequestToken: 'rot-1',
        },
        idempotencyKey: 'rot-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('amazon-secrets-manager secrets.restore', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs RestoreSecret with the SecretId', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ARN: 'arn:secret:x', Name: 'foo' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await amazonSecretsManagerConnector.executeMutation!({
      source: source(),
      capabilityName: 'secrets.restore',
      args: { name: 'foo' },
      idempotencyKey: 'res-1',
    })

    expect(capturedHeaders['X-Amz-Target']).toBe('secretsmanager.RestoreSecret')
    expect(capturedBody).toEqual({ SecretId: 'foo' })
    expect(result.status).toBe('committed')
  })
})

describe('amazon-secrets-manager secrets.tag', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs TagResource with SecretId and Tags', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await amazonSecretsManagerConnector.executeMutation!({
      source: source(),
      capabilityName: 'secrets.tag',
      args: {
        name: 'foo',
        tags: [{ Key: 'env', Value: 'prod' }],
      },
      idempotencyKey: 'tag-1',
    })

    expect(capturedHeaders['X-Amz-Target']).toBe('secretsmanager.TagResource')
    expect(capturedBody).toEqual({ SecretId: 'foo', Tags: [{ Key: 'env', Value: 'prod' }] })
    expect(result.status).toBe('committed')
  })
})
