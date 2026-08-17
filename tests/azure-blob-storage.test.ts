import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  azureBlobStorageConnector,
  parseAzureStorageCredentials,
} from '../src/connectors/adapters/azure-blob-storage.js'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const ACCOUNT_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
const CONNECTION_STRING = `DefaultEndpointsProtocol=https;AccountName=tanglestorage;AccountKey=${ACCOUNT_KEY};EndpointSuffix=core.windows.net`
const NOW = new Date('2026-07-30T19:00:00.000Z')

function source(apiKey = CONNECTION_STRING): ResolvedDataSource {
  return {
    id: 'source_azure_blob',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'azure-blob-storage',
    label: 'Azure Blob test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey },
    status: 'active',
  }
}

function xmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/xml', ...headers },
  })
}

describe('Azure Blob Storage provider pack', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('registers all nine catalog operations and approval metadata', () => {
    expect(azureBlobStorageConnector.manifest.capabilities.map(
      (capability) => capability.name,
    ).sort()).toEqual([
      'blobs.delete',
      'blobs.findByTags',
      'blobs.list',
      'blobs.read',
      'blobs.tags.set',
      'blobs.upload',
      'containers.create',
      'containers.delete',
      'containers.list',
    ])
    for (const capability of azureBlobStorageConnector.manifest.capabilities) {
      if (capability.class === 'mutation') expect(capability.externalEffect, capability.name).toBe(true)
    }
    const factory = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'azure-blob-storage',
    )
    expect(factory?.envMap).toEqual({})
  })

  it('parses Shared Key and SAS connection strings without putting secrets in metadata', () => {
    expect(parseAzureStorageCredentials(source().credentials)).toMatchObject({
      accountName: 'tanglestorage',
      accountKey: ACCOUNT_KEY,
      endpoint: 'https://tanglestorage.blob.core.windows.net',
    })
    const sas = 'sv=2023-11-03&ss=b&srt=sco&sp=rl&se=2030-01-01T00%3A00%3A00Z&sig=secret-signature'
    expect(parseAzureStorageCredentials(source(
      `AccountName=tanglestorage;BlobEndpoint=https://tanglestorage.blob.core.windows.net;SharedAccessSignature=${sas}`,
    ).credentials)).toMatchObject({
      accountName: 'tanglestorage',
      endpoint: 'https://tanglestorage.blob.core.windows.net',
    })
  })

  it('rejects development storage, arbitrary endpoints, and malformed keys before fetch', () => {
    for (const connectionString of [
      'UseDevelopmentStorage=true',
      `AccountName=tanglestorage;AccountKey=${ACCOUNT_KEY};BlobEndpoint=https://169.254.169.254`,
      `AccountName=tanglestorage;AccountKey=${ACCOUNT_KEY};BlobEndpoint=https://tanglestorage.attacker.blob.core.windows.net`,
      'AccountName=tanglestorage;AccountKey=not-base64;EndpointSuffix=core.windows.net',
    ]) {
      expect(() => parseAzureStorageCredentials(source(connectionString).credentials)).toThrow()
    }
  })

  it('signs a canonical container listing and parses continuation state', async () => {
    let requestUrl = ''
    let requestHeaders = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      return xmlResponse(`<?xml version="1.0"?><EnumerationResults>
        <Containers><Container><Name>legal&amp;docs</Name><Properties>
          <Last-Modified>Thu, 30 Jul 2026 18:00:00 GMT</Last-Modified><Etag>etag-1</Etag>
        </Properties></Container></Containers><NextMarker>next-1</NextMarker>
      </EnumerationResults>`)
    }))

    const result = await azureBlobStorageConnector.executeRead!({
      source: source(),
      capabilityName: 'containers.list',
      args: { prefix: 'legal', maxResults: 2 },
      idempotencyKey: 'list-1',
    })

    expect(requestUrl).toBe(
      'https://tanglestorage.blob.core.windows.net/?comp=list&prefix=legal&maxresults=2&include=metadata',
    )
    expect(requestHeaders.get('x-ms-date')).toBe(NOW.toUTCString())
    expect(requestHeaders.get('x-ms-version')).toBe('2023-11-03')
    expect(requestHeaders.get('authorization')).toBe(expectedListAuthorization(requestHeaders))
    expect(result.data).toEqual({
      containers: [{
        name: 'legal&docs',
        etag: 'etag-1',
        lastModified: 'Thu, 30 Jul 2026 18:00:00 GMT',
        deleted: false,
      }],
      nextMarker: 'next-1',
    })
  })

  it('uploads exact bytes and keeps credentials and caller extras out of the request', async () => {
    let requestUrl = ''
    let requestHeaders = new Headers()
    let requestBody = Buffer.alloc(0)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      requestBody = Buffer.from(await new Response(init?.body).arrayBuffer())
      return new Response(null, { status: 201, headers: { etag: 'etag-upload' } })
    }))

    const result = await azureBlobStorageConnector.executeMutation!({
      source: source(),
      capabilityName: 'blobs.upload',
      args: {
        containerName: 'legal-docs',
        blobName: 'reports/Q3 plan.pdf',
        content: Buffer.from('secret report').toString('base64'),
        encoding: 'base64',
        contentType: 'application/pdf',
        tags: { Matter: 'Acme' },
        accountKey: 'attacker-field',
      },
      idempotencyKey: 'upload-1',
    })

    expect(requestUrl).toBe('https://tanglestorage.blob.core.windows.net/legal-docs/reports/Q3%20plan.pdf')
    expect(requestHeaders.get('content-type')).toBe('application/pdf')
    expect(requestHeaders.get('content-length')).toBe('13')
    expect(requestHeaders.get('x-ms-blob-type')).toBe('BlockBlob')
    expect(requestHeaders.get('x-ms-tags')).toBe('Matter=Acme')
    expect(requestHeaders.get('authorization')).toMatch(/^SharedKey tanglestorage:/)
    expect(requestBody.toString('utf-8')).toBe('secret report')
    expect(result).toMatchObject({ status: 'committed', etagAfter: 'etag-upload' })
  })

  it('rejects oversized uploads before making a provider request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(azureBlobStorageConnector.executeMutation!({
      source: source(),
      capabilityName: 'blobs.upload',
      args: {
        containerName: 'legal-docs',
        blobName: 'too-large.bin',
        content: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
        encoding: 'base64',
      },
      idempotencyKey: 'upload-large-1',
    })).rejects.toThrow('upload exceeds the 10485760-byte limit')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('merges tags through a signed read then writes escaped XML', async () => {
    const requests: Array<{ url: string; method: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? await new Response(init.body).text() : ''
      requests.push({ url: String(input), method: init?.method ?? '', body })
      if (requests.length === 1) {
        return xmlResponse('<Tags><TagSet><Tag><Key>Existing</Key><Value>yes</Value></Tag></TagSet></Tags>')
      }
      return new Response(null, { status: 204 })
    }))

    await azureBlobStorageConnector.executeMutation!({
      source: source(),
      capabilityName: 'blobs.tags.set',
      args: {
        containerName: 'legal-docs',
        blobName: 'report.pdf',
        tags: { Matter: 'A&B' },
        keepExistingTags: true,
      },
      idempotencyKey: 'tags-1',
    })

    expect(requests).toHaveLength(2)
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET https://tanglestorage.blob.core.windows.net/legal-docs/report.pdf?comp=tags',
      'PUT https://tanglestorage.blob.core.windows.net/legal-docs/report.pdf?comp=tags',
    ])
    expect(requests[1]?.body).toContain('<Key>Existing</Key><Value>yes</Value>')
    expect(requests[1]?.body).toContain('<Key>Matter</Key><Value>A&amp;B</Value>')
  })

  it('finds tagged blobs using an injection-safe expression and parses provider XML', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return xmlResponse(`<EnumerationResults><Blobs><Blob>
        <Name>reports/q3.pdf</Name><ContainerName>legal-docs</ContainerName>
        <Tags><TagSet><Tag><Key>Matter</Key><Value>Acme</Value></Tag></TagSet></Tags>
      </Blob></Blobs><NextMarker /></EnumerationResults>`)
    }))

    const result = await azureBlobStorageConnector.executeRead!({
      source: source(),
      capabilityName: 'blobs.findByTags',
      args: { containerName: 'legal-docs', tags: { Matter: 'Acme' } },
      idempotencyKey: 'find-tags-1',
    })

    const url = new URL(requestUrl)
    expect(url.searchParams.get('where')).toBe('"Matter" = \'Acme\'')
    expect(result.data).toEqual({
      blobs: [{ name: 'reports/q3.pdf', containerName: 'legal-docs', tags: { Matter: 'Acme' } }],
      nextMarker: undefined,
    })

    await expect(azureBlobStorageConnector.executeRead!({
      source: source(),
      capabilityName: 'blobs.findByTags',
      args: { containerName: 'legal-docs', tags: { Matter: "Acme' OR 1=1" } },
      idempotencyKey: 'find-tags-injection-1',
    })).rejects.toThrow('without apostrophes')
  })

  it('fails before buffering an oversized download and redacts provider echoes', async () => {
    const fetchMock = vi.fn(async () => new Response('x', {
      headers: { 'content-length': '5000' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(azureBlobStorageConnector.executeRead!({
      source: source(),
      capabilityName: 'blobs.read',
      args: { containerName: 'legal-docs', blobName: 'huge.bin', maxBytes: 100 },
      idempotencyKey: 'read-large-1',
    })).rejects.toThrow('response exceeds the 100-byte limit')

    vi.stubGlobal('fetch', vi.fn(async () => xmlResponse(
      `<Error><Message>credential ${ACCOUNT_KEY}</Message></Error>`,
      500,
    )))
    await expect(azureBlobStorageConnector.executeRead!({
      source: source(),
      capabilityName: 'containers.list',
      args: {},
      idempotencyKey: 'error-1',
    })).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      return message.includes('[REDACTED]') && !message.includes(ACCOUNT_KEY)
    })
  })

  it('uses SAS query credentials without emitting an Authorization header', async () => {
    let requestUrl = ''
    let authorization: string | null = 'unset'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization')
      return xmlResponse('<EnumerationResults><Containers /></EnumerationResults>')
    }))
    const sas = 'sv=2023-11-03&ss=b&srt=sco&sp=rl&se=2030-01-01T00%3A00%3A00Z&sig=secret-signature'
    await azureBlobStorageConnector.executeRead!({
      source: source(`AccountName=tanglestorage;SharedAccessSignature=${sas}`),
      capabilityName: 'containers.list',
      args: {},
      idempotencyKey: 'sas-1',
    })
    const url = new URL(requestUrl)
    expect(url.searchParams.get('sig')).toBe('secret-signature')
    expect(url.searchParams.get('comp')).toBe('list')
    expect(authorization).toBeNull()
  })
})

function expectedListAuthorization(headers: Headers): string {
  const canonicalHeaders = [
    `x-ms-client-request-id:${headers.get('x-ms-client-request-id')}\n`,
    `x-ms-date:${headers.get('x-ms-date')}\n`,
    `x-ms-version:${headers.get('x-ms-version')}\n`,
  ].join('')
  const canonicalResource = [
    `${canonicalHeaders}/tanglestorage/`,
    'comp:list',
    'include:metadata',
    'maxresults:2',
    'prefix:legal',
  ].join('\n')
  const stringToSign = ['GET', '', '', '', '', '', '', '', '', '', '', '', canonicalResource].join('\n')
  const signature = createHmac('sha256', Buffer.from(ACCOUNT_KEY, 'base64'))
    .update(stringToSign, 'utf-8')
    .digest('base64')
  return `SharedKey tanglestorage:${signature}`
}
