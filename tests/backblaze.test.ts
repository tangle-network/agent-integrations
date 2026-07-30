import { afterEach, describe, expect, it, vi } from 'vitest'
import { backblazeConnector } from '../src/connectors/adapters/backblaze.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'source_backblaze',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'backblaze',
  label: 'Backblaze B2',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: {
    kind: 'api-key',
    apiKey: JSON.stringify({
      accessKeyId: '004example',
      secretAccessKey: 'K004example-secret',
      region: 'us-west-001',
      bucket: 'customer-files',
    }),
  },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('backblaze adapter manifest', () => {
  it('classifies itself as the storage category and exposes the backblaze kind', () => {
    expect(backblazeConnector.manifest.kind).toBe('backblaze')
    expect(backblazeConnector.manifest.category).toBe('storage')
    expect(backblazeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = backblazeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: read/upload + write-side delete/copy + list', () => {
    const names = backblazeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['files.copy', 'files.delete', 'files.list', 'files.read', 'files.s3_upload'].sort(),
    )
    const reads = backblazeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = backblazeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['files.list', 'files.read'])
    expect(mutations).toEqual(['files.copy', 'files.delete', 'files.s3_upload'])
  })

  it('marks every new write-side mutation as native-idempotency + externalEffect', () => {
    const writeSide = ['files.delete', 'files.copy']
    for (const name of writeSide) {
      const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('files.delete targets DELETE /{bucket}/{key} and requires a key arg', () => {
    const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === 'files.delete')
    expect(cap).toBeDefined()
    expect((cap?.parameters as { required?: string[] }).required).toEqual(['key'])
  })

  it('files.copy carries an x-amz-copy-source header template and requires source+dest keys', () => {
    const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === 'files.copy')
    expect(cap).toBeDefined()
    expect((cap?.parameters as { required?: string[] }).required).toEqual([
      'sourceBucket',
      'sourceKey',
      'destKey',
    ])
  })

  it('files.list exposes a paginated S3 ListObjectsV2 surface', () => {
    const cap = backblazeConnector.manifest.capabilities.find((c) => c.name === 'files.list')
    expect(cap).toBeDefined()
    expect(cap?.class).toBe('read')
    const params = cap?.parameters as { properties?: Record<string, unknown> }
    expect(params.properties).toHaveProperty('prefix')
    expect(params.properties).toHaveProperty('maxKeys')
    expect(params.properties).toHaveProperty('continuationToken')
  })

  it('probes the credential-configured bucket with an AWS Signature V4 request', async () => {
    const fetchMock = mockFetch('<ListBucketResult />')

    await expect(backblazeConnector.test(source)).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://s3.us-west-001.backblazeb2.com')
    expect(url.pathname).toBe('/customer-files')
    expect(url.search).toBe('?list-type=2&max-keys=1')
    expect(init.headers).toMatchObject({
      authorization: expect.stringMatching(/^AWS4-HMAC-SHA256 Credential=004example\//),
      'x-amz-content-sha256': expect.stringMatching(/^[0-9a-f]{64}$/),
      'x-amz-date': expect.stringMatching(/^\d{8}T\d{6}Z$/),
    })
    expect(init.headers).not.toHaveProperty('x-api-key')
  })

  it('uses the credential bucket by default and permits an explicit action override', async () => {
    const fetchMock = mockFetch('<ListBucketResult />')

    await backblazeConnector.executeRead!({
      source,
      capabilityName: 'files.list',
      args: { prefix: 'reports/' },
      idempotencyKey: 'list-default',
    })
    await backblazeConnector.executeRead!({
      source,
      capabilityName: 'files.list',
      args: { bucket: 'other-files' },
      idempotencyKey: 'list-override',
    })

    const [defaultUrl] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const [overrideUrl] = fetchMock.mock.calls[1] as [URL, RequestInit]
    expect(defaultUrl.pathname).toBe('/customer-files')
    expect(defaultUrl.searchParams.get('prefix')).toBe('reports/')
    expect(overrideUrl.pathname).toBe('/other-files')
  })

  it('fails the connection probe clearly when the bucket is absent', async () => {
    const sourceWithoutBucket: ResolvedDataSource = {
      ...source,
      credentials: {
        kind: 'api-key',
        apiKey: JSON.stringify({
          accessKeyId: '004example',
          secretAccessKey: 'K004example-secret',
          region: 'us-west-001',
        }),
      },
    }

    await expect(backblazeConnector.test(sourceWithoutBucket)).resolves.toEqual({
      ok: false,
      reason: 'missing required argument: bucket',
    })
  })
})

function mockFetch(body: string) {
  const fetchMock = vi.fn(async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/xml' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
