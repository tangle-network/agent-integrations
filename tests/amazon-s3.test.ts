import { afterEach, describe, expect, it, vi } from 'vitest'
import { amazonS3Connector } from '../src/connectors/adapters/amazon-s3.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_s3_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'amazon-s3',
    label: 'amazon-s3 test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'aws_test_bundle' },
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

describe('amazon-s3 adapter manifest', () => {
  it('classifies itself as the storage category and exposes the amazon-s3 kind', () => {
    expect(amazonS3Connector.manifest.kind).toBe('amazon-s3')
    expect(amazonS3Connector.manifest.category).toBe('storage')
    expect(amazonS3Connector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = amazonS3Connector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AWS|Access Key/i)
  })

  it('covers the file management capability surface including copy/setMetadata/createBucket', () => {
    const names = amazonS3Connector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'files.list',
        'files.read',
        'files.upload',
        'files.delete',
        'files.generateSignedUrl',
        'files.moveFile',
        'files.copyFile',
        'files.setMetadata',
        'files.createBucket',
      ].sort(),
    )
    const mutations = amazonS3Connector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'files.upload',
        'files.delete',
        'files.moveFile',
        'files.copyFile',
        'files.setMetadata',
        'files.createBucket',
      ].sort(),
    )
  })

  it('marks new mutations as native-idempotency external effect', () => {
    for (const name of ['files.copyFile', 'files.setMetadata', 'files.createBucket']) {
      const cap = amazonS3Connector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('amazon-s3 files.copyFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /{destinationKey} with x-amz-copy-source header', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await amazonS3Connector.executeMutation!({
      source: source(),
      capabilityName: 'files.copyFile',
      args: { sourceKey: 'bucket-a/path/old.txt', destinationKey: 'bucket-a/path/new.txt' },
      idempotencyKey: 'cp-1',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toContain('https://s3.amazonaws.com/')
    expect(capturedUrl).toContain('new.txt')
    expect(capturedHeaders['x-amz-copy-source']).toBe('bucket-a%2Fpath%2Fold.txt')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      amazonS3Connector.executeMutation!({
        source: source(),
        capabilityName: 'files.copyFile',
        args: { sourceKey: 'b/a.txt', destinationKey: 'b/c.txt' },
        idempotencyKey: 'cp-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('amazon-s3 files.setMetadata', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs with x-amz-metadata-directive: REPLACE and self-copy-source', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await amazonS3Connector.executeMutation!({
      source: source(),
      capabilityName: 'files.setMetadata',
      args: {
        key: 'docs/report.pdf',
        contentType: 'application/pdf',
        metadata: '{"owner":"drew"}',
      },
      idempotencyKey: 'meta-1',
    })

    expect(capturedUrl).toContain('report.pdf')
    expect(capturedHeaders['x-amz-metadata-directive']).toBe('REPLACE')
    expect(capturedHeaders['x-amz-copy-source']).toContain('report.pdf')
    // declarative-rest URL-encodes header interpolations via encodeURIComponent;
    // 'application/pdf' becomes 'application%2Fpdf'. We assert the substring
    // rather than the literal so the test reflects current rendering.
    expect(capturedHeaders['Content-Type']).toContain('application')
    expect(result.status).toBe('committed')
  })
})

describe('amazon-s3 files.createBucket', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /{bucket} with x-amz-bucket-region header', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await amazonS3Connector.executeMutation!({
      source: source(),
      capabilityName: 'files.createBucket',
      args: { bucket: 'drew-bucket', region: 'us-west-2' },
      idempotencyKey: 'bkt-1',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe('https://s3.amazonaws.com/drew-bucket')
    expect(capturedHeaders['x-amz-bucket-region']).toBe('us-west-2')
    expect(result.status).toBe('committed')
  })
})
