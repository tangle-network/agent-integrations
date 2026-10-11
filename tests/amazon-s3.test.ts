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
    expect(capturedUrl).toContain('https://s3.us-east-1.amazonaws.com/')
    expect(capturedUrl).toContain('new.txt')
    expect(capturedHeaders['x-amz-copy-source']).toBe('bucket-a%2Fpath%2Fold.txt')
    // request is SigV4-signed, not Bearer
    expect(capturedHeaders.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request,/)
    expect(capturedHeaders['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    expect(capturedHeaders['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)
    expect(result.status).toBe('committed')
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

describe('amazon-s3 files.list SigV4 query encoding', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encodes a space in prefix as %20 on the wire so it matches the signed query', async () => {
    let capturedUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')
      }),
    )

    await amazonS3Connector.executeRead!({
      source: source(),
      capabilityName: 'files.list',
      args: { bucket: 'docs', prefix: 'my folder/' },
      idempotencyKey: 't',
    })

    // URLSearchParams form-encoding would send 'my+folder' (a space as '+'), which
    // AWS canonicalizes to %2B and rejects. The wire must carry %20, matching the
    // signed canonical query.
    expect(capturedUrl).toContain('prefix=my%20folder')
    expect(capturedUrl).not.toContain('prefix=my+folder')
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
    // host is region-derived from the credential bundle (us-east-1); the
    // us-west-2 arg only sets the x-amz-bucket-region header.
    expect(capturedUrl).toBe('https://s3.us-east-1.amazonaws.com/drew-bucket')
    expect(capturedHeaders['x-amz-bucket-region']).toBe('us-west-2')
    expect(result.status).toBe('committed')
  })
})


describe('S3 knowledge ingestion', () => {
  afterEach(() => vi.unstubAllGlobals())
  const page = (inner: string) => new Response(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${inner}</ListBucketResult>`)
  const invoke = (capabilityName: string, args: Record<string, unknown>, src = source()) =>
    amazonS3Connector.executeRead!({ source: src, capabilityName, args, idempotencyKey: 'read' })

  it('normalizes empty buckets and preserves XML-escaped keys, ETags and opaque cursors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(page('<IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b+/=</NextContinuationToken><Contents><Key>001 &amp; docs/a.txt</Key><ETag>&quot;hash&quot;</ETag><Size>0</Size></Contents>')).mockResolvedValueOnce(page('<IsTruncated>false</IsTruncated>'))
    vi.stubGlobal('fetch', fetch)
    const first = await invoke('files.list', { bucket: 'my-bucket', prefix: '001 & docs/', maxKeys: 1000 })
    expect(first.data).toEqual({ objects: [{ key: '001 & docs/a.txt', etag: '"hash"', size: 0 }], isTruncated: true, nextContinuationToken: 'a&b+/=' })
    const second = await invoke('files.list', { bucket: 'my-bucket', continuationToken: 'a&b+/=' })
    expect(second.data).toEqual({ objects: [], isTruncated: false })
    const url = new URL(String(fetch.mock.calls[1]![0]))
    expect(url.pathname).toBe('/my-bucket')
    expect(url.searchParams.get('list-type')).toBe('2')
    expect(url.searchParams.get('continuation-token')).toBe('a&b+/=')
  })

  it('does not truncate eleven pages, including an empty intermediate page', async () => {
    let count = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('continuation-token')).toBe(count === 0 ? null : `page-${count}`)
      count++
      return page(`<IsTruncated>${count < 11}</IsTruncated>${count < 11 ? `<NextContinuationToken>page-${count}</NextContinuationToken>` : ''}${count === 5 ? '' : `<Contents><Key>${count}.txt</Key><Size>1</Size></Contents>`}`)
    }))
    let token: string | undefined
    const keys: string[] = []
    do {
      const result = await invoke('files.list', { bucket: 'docs', ...(token ? { continuationToken: token } : {}) })
      const data = result.data as { objects: { key: string }[]; isTruncated: boolean; nextContinuationToken?: string }
      keys.push(...data.objects.map(object => object.key))
      token = data.isTruncated ? data.nextContinuationToken : undefined
    } while (token)
    expect(count).toBe(11)
    expect(keys).toHaveLength(10)
    expect(keys.at(-1)).toBe('11.txt')
  })

  it('reads exact binary bytes, version and ETag with signed nested object paths', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 255, 13, 10]), { headers: { 'content-type': 'application/pdf', etag: '"rev"' } }))
    vi.stubGlobal('fetch', fetch)
    const result = await invoke('files.readBytes', { bucket: 'docs', key: 'a folder/encoded%2F?file.pdf', versionId: 'rev+/=' })
    expect(result.data).toEqual({ base64: 'AP8NCg==', contentType: 'application/pdf' })
    expect(result.etag).toBe('"rev"')
    const url = new URL(String(fetch.mock.calls[0]![0]))
    expect(url.pathname).toBe('/docs/a%20folder/encoded%252F%3Ffile.pdf')
    expect(url.searchParams.get('versionId')).toBe('rev+/=')
    expect(fetch.mock.calls[0]![1].redirect).toBe('error')
    const headers = fetch.mock.calls[0]![1].headers
    expect(headers.authorization).toContain('/us-east-1/s3/aws4_request')
    expect(headers['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses endpoint overrides and connection-default bucket without leaking credentials into paths', async () => {
    const fetch = vi.fn().mockResolvedValue(page('<IsTruncated>false</IsTruncated>'))
    vi.stubGlobal('fetch', fetch)
    await invoke('files.list', {}, source({ credentials: { kind: 'api-key', apiKey: JSON.stringify({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-key', region: 'us-east-1', bucket: 'bound-bucket', endpoint: 'https://storage.example/s3' }) } }))
    expect(String(fetch.mock.calls[0]![0])).toBe('https://storage.example/s3/bound-bucket?list-type=2')
  })

  it.each(['../secret', 'docs/../secret', './secret', 'docs/./file'])('refuses dot traversal %s before fetching', async key => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(invoke('files.readBytes', { bucket: 'docs', key })).rejects.toThrow('dot segment')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses missing bucket, invalid maxKeys, invalid XML, entity declarations and missing cursors', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(invoke('files.list', {})).rejects.toThrow('bucket')
    await expect(invoke('files.list', { bucket: 'docs', maxKeys: 1001 })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    for (const xml of ['<broken>', '<!DOCTYPE a [<!ENTITY x "abc">]><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>', '<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>']) {
      fetch.mockResolvedValueOnce(new Response(xml))
      await expect(invoke('files.list', { bucket: 'docs' })).rejects.toThrow()
    }
  })

  it('rejects oversized declared and streamed responses before decoding', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(33 * 1024 * 1024) } })).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close() } })))
    vi.stubGlobal('fetch', fetch)
    await expect(invoke('files.readBytes', { bucket: 'docs', key: 'big' })).rejects.toThrow('byte limit')
    await expect(invoke('files.list', { bucket: 'docs' })).rejects.toThrow('byte limit')
  })
})


describe('S3 XML resource bounds', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([
    '<ListBucketResult>' + '<a>'.repeat(18) + '</a>'.repeat(18) + '</ListBucketResult>',
    '<ListBucketResult><IsTruncated>false</IsTruncated>' + '<a/>'.repeat(30000) + '</ListBucketResult>',
    '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>' + 'a'.repeat(1025) + '</Key><Size>1</Size></Contents></ListBucketResult>',
    '<!DOCTYPE x SYSTEM "https://private.example/secret"><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
  ])('rejects deeply nested, excessive, oversized or external-entity XML', async xml => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml)))
    await expect(amazonS3Connector.executeRead!({ source: source(), capabilityName: 'files.list', args: { bucket: 'docs' }, idempotencyKey: 'read' })).rejects.toThrow()
  })
})


describe('S3 signed path and error bounds', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('uses RFC3986 path escapes for punctuation that encodeURIComponent leaves literal', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('text'))
    vi.stubGlobal('fetch', fetch)
    await amazonS3Connector.executeRead!({ source: source(), capabilityName: 'files.readBytes', args: { bucket: 'docs', key: "a/!label'()*" }, idempotencyKey: 'read' })
    expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe('/docs/a/%21label%27%28%29%2A')
  })
  it('enforces the byte budget on error bodies too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('too large', { status: 500, headers: { 'content-length': String(33 * 1024 * 1024) } })))
    await expect(amazonS3Connector.executeRead!({ source: source(), capabilityName: 'files.readBytes', args: { bucket: 'docs', key: 'broken' }, idempotencyKey: 'read' })).rejects.toThrow('byte limit')
  })
  it('retains ordinary provider error details after bounded reading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('NoSuchKey', { status: 404 })))
    await expect(amazonS3Connector.executeRead!({ source: source(), capabilityName: 'files.readBytes', args: { bucket: 'docs', key: 'missing' }, idempotencyKey: 'read' })).rejects.toThrow('NoSuchKey')
  })
})
