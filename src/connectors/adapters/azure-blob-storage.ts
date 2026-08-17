import { createHmac } from 'node:crypto'
import {
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
  CredentialsExpired,
  ProviderRateLimited,
} from '../types.js'

const API_VERSION = '2023-11-03'
const DEFAULT_READ_LIMIT = 4 * 1024 * 1024
const MAX_READ_LIMIT = 10 * 1024 * 1024
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const RETRY_AFTER_MS = 60_000
const AZURE_BLOB_SUFFIXES = [
  '.blob.core.windows.net',
  '.blob.core.usgovcloudapi.net',
  '.blob.core.chinacloudapi.cn',
  '.blob.core.cloudapi.de',
] as const

interface AzureStorageCredentials {
  accountName: string
  accountKey?: string
  sas?: URLSearchParams
  endpoint: string
  secrets: string[]
}

interface AzureResponse {
  response: Response
  body: Uint8Array
}

export const azureBlobStorageConnector: ConnectorAdapter = {
  manifest: {
    kind: 'azure-blob-storage',
    displayName: 'Azure Blob Storage',
    description:
      'List and manage Azure Blob Storage containers, blobs, downloads, uploads, and index tags using a customer-owned storage connection string.',
    auth: {
      kind: 'api-key',
      hint: 'Azure Storage connection string containing AccountName and either AccountKey or SharedAccessSignature. Store it only in the encrypted credential field. Public Azure cloud endpoints are supported; development-storage and arbitrary custom endpoints are rejected.',
    },
    category: 'storage',
    defaultConsistencyModel: 'authoritative',
    rateLimit: { requests: 500, windowMs: 60_000, scope: 'data-source' },
    capabilities: [
      readCapability('containers.list', 'List storage containers with optional prefix and system/deleted filters.', {
        prefix: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        includeSystem: { type: 'boolean' },
        marker: { type: 'string', description: 'Opaque continuation marker from a previous response.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 5000 },
      }),
      mutationCapability('containers.create', 'Create a private blob container.', {
        containerName: { type: 'string', description: 'DNS-compatible Azure container name.' },
      }, ['containerName']),
      mutationCapability('containers.delete', 'Delete a blob container and its contents.', {
        containerName: { type: 'string' },
      }, ['containerName']),
      readCapability('blobs.list', 'List blobs in a container with metadata and optional snapshots.', {
        containerName: { type: 'string' },
        prefix: { type: 'string' },
        includeSnapshots: { type: 'boolean' },
        marker: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 5000 },
      }, ['containerName']),
      readCapability('blobs.findByTags', 'Find blobs in one container whose Azure index tags match all supplied values.', {
        containerName: { type: 'string' },
        tags: {
          type: 'object',
          minProperties: 1,
          maxProperties: 10,
          additionalProperties: { type: 'string' },
        },
        marker: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 5000 },
      }, ['containerName', 'tags']),
      readCapability('blobs.read', 'Download a bounded blob payload as base64 with its content type and ETag.', {
        containerName: { type: 'string' },
        blobName: { type: 'string' },
        maxBytes: { type: 'integer', minimum: 1, maximum: MAX_READ_LIMIT },
      }, ['containerName', 'blobName']),
      mutationCapability('blobs.upload', 'Upload or replace a block blob from UTF-8 or base64 content.', {
        containerName: { type: 'string' },
        blobName: { type: 'string' },
        content: {
          type: 'string',
          maxLength: 14_000_000,
          description: 'UTF-8 text or base64-encoded bytes, up to 10 MiB after decoding.',
        },
        encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
        contentType: { type: 'string' },
        tags: { type: 'object', maxProperties: 10, additionalProperties: { type: 'string' } },
      }, ['containerName', 'blobName', 'content']),
      mutationCapability('blobs.delete', 'Delete a blob and optionally its snapshots.', {
        containerName: { type: 'string' },
        blobName: { type: 'string' },
        deleteSnapshots: { type: 'string', enum: ['include', 'only'] },
      }, ['containerName', 'blobName']),
      mutationCapability('blobs.tags.set', 'Replace blob index tags or merge them with the current tags.', {
        containerName: { type: 'string' },
        blobName: { type: 'string' },
        tags: {
          type: 'object',
          minProperties: 1,
          maxProperties: 10,
          additionalProperties: { type: 'string' },
        },
        keepExistingTags: { type: 'boolean' },
      }, ['containerName', 'blobName', 'tags']),
    ],
  },

  async executeRead(inv): Promise<CapabilityReadResult> {
    const credentials = parseAzureStorageCredentials(inv.source.credentials)
    let data: unknown
    let etag: string | undefined

    switch (inv.capabilityName) {
      case 'containers.list': {
        const query = new URLSearchParams({ comp: 'list' })
        setOptionalQuery(query, 'prefix', optionalString(inv.args.prefix))
        setOptionalQuery(query, 'marker', optionalString(inv.args.marker))
        setOptionalQuery(query, 'maxresults', optionalInteger(inv.args.maxResults, 'maxResults'))
        const include = [
          inv.args.includeDeleted === true ? 'deleted' : undefined,
          inv.args.includeSystem === true ? 'system' : undefined,
          'metadata',
        ].filter((value): value is string => Boolean(value))
        query.set('include', include.join(','))
        const result = await azureRequest(credentials, inv, 'GET', [], query)
        data = parseContainerList(decodeUtf8(result.body))
        break
      }
      case 'blobs.list': {
        const containerName = requiredContainer(inv.args.containerName)
        const query = new URLSearchParams({ restype: 'container', comp: 'list' })
        setOptionalQuery(query, 'prefix', optionalString(inv.args.prefix))
        setOptionalQuery(query, 'marker', optionalString(inv.args.marker))
        setOptionalQuery(query, 'maxresults', optionalInteger(inv.args.maxResults, 'maxResults'))
        const include = ['metadata', inv.args.includeSnapshots === true ? 'snapshots' : undefined]
          .filter((value): value is string => Boolean(value))
        query.set('include', include.join(','))
        const result = await azureRequest(credentials, inv, 'GET', [containerName], query)
        data = parseBlobList(decodeUtf8(result.body))
        break
      }
      case 'blobs.findByTags': {
        const containerName = requiredContainer(inv.args.containerName)
        const tags = requiredTags(inv.args.tags)
        const query = new URLSearchParams({
          restype: 'container',
          comp: 'blobs',
          where: tagExpression(tags),
        })
        setOptionalQuery(query, 'marker', optionalString(inv.args.marker))
        setOptionalQuery(query, 'maxresults', optionalInteger(inv.args.maxResults, 'maxResults'))
        const result = await azureRequest(credentials, inv, 'GET', [containerName], query)
        data = parseTaggedBlobList(decodeUtf8(result.body))
        break
      }
      case 'blobs.read': {
        const containerName = requiredContainer(inv.args.containerName)
        const blobName = requiredBlobName(inv.args.blobName)
        const maxBytes = optionalInteger(inv.args.maxBytes, 'maxBytes') ?? DEFAULT_READ_LIMIT
        if (maxBytes > MAX_READ_LIMIT) throw new Error(`maxBytes cannot exceed ${MAX_READ_LIMIT}`)
        const result = await azureRequest(
          credentials,
          inv,
          'GET',
          [containerName, ...blobPath(blobName)],
          undefined,
          {},
          undefined,
          maxBytes,
        )
        etag = result.response.headers.get('etag') ?? undefined
        data = {
          content: Buffer.from(result.body).toString('base64'),
          encoding: 'base64',
          contentType: result.response.headers.get('content-type') ?? 'application/octet-stream',
          size: result.body.byteLength,
          etag,
          lastModified: result.response.headers.get('last-modified') ?? undefined,
        }
        break
      }
      default:
        throw new Error(`azure-blob-storage: unknown read capability ${inv.capabilityName}`)
    }

    return { data, etag, fetchedAt: Date.now() }
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    const credentials = parseAzureStorageCredentials(inv.source.credentials)
    let result: AzureResponse
    let data: unknown

    switch (inv.capabilityName) {
      case 'containers.create': {
        const containerName = requiredContainer(inv.args.containerName, false)
        result = await azureRequest(
          credentials,
          inv,
          'PUT',
          [containerName],
          new URLSearchParams({ restype: 'container' }),
        )
        data = { containerName }
        break
      }
      case 'containers.delete': {
        const containerName = requiredContainer(inv.args.containerName)
        result = await azureRequest(
          credentials,
          inv,
          'DELETE',
          [containerName],
          new URLSearchParams({ restype: 'container' }),
        )
        data = { containerName, deleted: true }
        break
      }
      case 'blobs.upload': {
        const containerName = requiredContainer(inv.args.containerName)
        const blobName = requiredBlobName(inv.args.blobName)
        const content = requiredString(inv.args.content, 'content')
        const encoding = inv.args.encoding === undefined ? 'utf-8' : requiredString(inv.args.encoding, 'encoding')
        if (encoding !== 'utf-8' && encoding !== 'base64') throw new Error('encoding must be utf-8 or base64')
        const body = encoding === 'base64'
          ? decodeStrictBase64(content)
          : Buffer.from(content, 'utf-8')
        if (body.byteLength > MAX_UPLOAD_BYTES) {
          throw new Error(`Azure Blob Storage upload exceeds the ${MAX_UPLOAD_BYTES}-byte limit`)
        }
        const headers: Record<string, string> = {
          'content-type': optionalString(inv.args.contentType) ?? 'application/octet-stream',
          'x-ms-blob-type': 'BlockBlob',
        }
        if (inv.args.tags !== undefined) headers['x-ms-tags'] = serializeTagsHeader(requiredTags(inv.args.tags))
        result = await azureRequest(
          credentials,
          inv,
          'PUT',
          [containerName, ...blobPath(blobName)],
          undefined,
          headers,
          body,
        )
        data = { blobName, containerName, size: body.byteLength }
        break
      }
      case 'blobs.delete': {
        const containerName = requiredContainer(inv.args.containerName)
        const blobName = requiredBlobName(inv.args.blobName)
        const headers: Record<string, string> = {}
        if (inv.args.deleteSnapshots !== undefined) {
          const value = requiredString(inv.args.deleteSnapshots, 'deleteSnapshots')
          if (value !== 'include' && value !== 'only') throw new Error('deleteSnapshots must be include or only')
          headers['x-ms-delete-snapshots'] = value
        }
        result = await azureRequest(
          credentials,
          inv,
          'DELETE',
          [containerName, ...blobPath(blobName)],
          undefined,
          headers,
        )
        data = { blobName, containerName, deleted: true }
        break
      }
      case 'blobs.tags.set': {
        const containerName = requiredContainer(inv.args.containerName)
        const blobName = requiredBlobName(inv.args.blobName)
        let tags = requiredTags(inv.args.tags)
        if (inv.args.keepExistingTags === true) {
          const current = await azureRequest(
            credentials,
            inv,
            'GET',
            [containerName, ...blobPath(blobName)],
            new URLSearchParams({ comp: 'tags' }),
          )
          tags = { ...parseTags(decodeUtf8(current.body)), ...tags }
        }
        const body = Buffer.from(tagsXml(tags), 'utf-8')
        result = await azureRequest(
          credentials,
          inv,
          'PUT',
          [containerName, ...blobPath(blobName)],
          new URLSearchParams({ comp: 'tags' }),
          { 'content-type': 'application/xml; charset=utf-8' },
          body,
        )
        data = { blobName, containerName, tags }
        break
      }
      default:
        throw new Error(`azure-blob-storage: unknown mutation capability ${inv.capabilityName}`)
    }

    return {
      status: 'committed',
      data,
      etagAfter: result.response.headers.get('etag') ?? undefined,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      const credentials = parseAzureStorageCredentials(source.credentials)
      await azureRequest(credentials, {
        source,
        capabilityName: '__test__',
        args: {},
        idempotencyKey: 'connection-test',
      }, 'GET', [], new URLSearchParams({ comp: 'list', maxresults: '1' }))
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
    }
  },
}

function readCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: { type: 'object', properties, required },
  }
}

function mutationCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: { type: 'object', properties, required },
    cas: 'none' as const,
    externalEffect: true,
  }
}

async function azureRequest(
  credentials: AzureStorageCredentials,
  inv: ConnectorInvocation,
  method: 'GET' | 'PUT' | 'DELETE',
  pathSegments: string[],
  query = new URLSearchParams(),
  extraHeaders: Record<string, string> = {},
  body?: Buffer,
  maxResponseBytes = MAX_RESPONSE_BYTES,
): Promise<AzureResponse> {
  const url = new URL(credentials.endpoint)
  url.pathname = pathSegments.length > 0 ? `/${pathSegments.map(encodePathSegment).join('/')}` : '/'
  for (const [key, value] of query) url.searchParams.append(key, value)
  if (credentials.sas) {
    for (const [key, value] of credentials.sas) {
      if (url.searchParams.has(key)) throw new Error('Azure SAS contains a conflicting request parameter')
      url.searchParams.append(key, value)
    }
  }

  const headers: Record<string, string> = {
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': API_VERSION,
    'x-ms-client-request-id': inv.idempotencyKey,
    ...extraHeaders,
  }
  if (body) headers['content-length'] = String(body.byteLength)
  if (credentials.accountKey) {
    headers.authorization = sharedKeyAuthorization(credentials, method, url, headers)
  }

  const requestBody = body ? Uint8Array.from(body).buffer : undefined
  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
    signal: AbortSignal.timeout(20_000),
  })
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    await response.body?.cancel()
    throw new Error(`Azure Blob Storage response exceeds the ${maxResponseBytes}-byte limit`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxResponseBytes) {
    throw new Error(`Azure Blob Storage response exceeds the ${maxResponseBytes}-byte limit`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new CredentialsExpired(`Azure Blob Storage rejected credentials (${response.status})`, inv.source.id)
  }
  if (response.status === 429 || response.status === 503) {
    const retryAfterMs = retryAfter(response.headers.get('retry-after'))
    throw new ProviderRateLimited(
      `Azure Blob Storage rate limit (${response.status}); retry after ${retryAfterMs}ms`,
      inv.source.id,
      { status: response.status, retryAfterMs },
    )
  }
  if (!response.ok) {
    const errorText = redact(decodeUtf8(bytes), credentials.secrets)
    throw new Error(`azure-blob-storage ${method} HTTP ${response.status}: ${errorText.slice(0, 300)}`)
  }
  return { response, body: bytes }
}

export function parseAzureStorageCredentials(credentials: ConnectorCredentials): AzureStorageCredentials {
  const raw = credentials.kind === 'api-key'
    ? credentials.apiKey
    : credentials.kind === 'custom' && typeof credentials.values.connectionString === 'string'
      ? credentials.values.connectionString
      : undefined
  if (!raw?.trim()) throw new Error('Azure Blob Storage requires an encrypted connection string')

  const fields = new Map<string, string>()
  for (const part of raw.split(';')) {
    if (!part.trim()) continue
    const separator = part.indexOf('=')
    if (separator <= 0) throw new Error('Azure Storage connection string is malformed')
    const key = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim()
    if (!value || fields.has(key)) throw new Error('Azure Storage connection string is malformed')
    fields.set(key, value)
  }
  if (fields.get('usedevelopmentstorage')?.toLowerCase() === 'true') {
    throw new Error('Azure development-storage endpoints are not allowed')
  }

  const accountName = fields.get('accountname')
  if (!accountName || !/^[a-z0-9]{3,24}$/.test(accountName)) {
    throw new Error('Azure Storage connection string has an invalid AccountName')
  }
  const accountKey = fields.get('accountkey')
  if (accountKey) decodeAccountKey(accountKey)
  const sasRaw = fields.get('sharedaccesssignature')?.replace(/^\?/, '')
  const sas = sasRaw ? validateSas(sasRaw) : undefined
  if (!accountKey && !sas) {
    throw new Error('Azure Storage connection string requires AccountKey or SharedAccessSignature')
  }

  const suffix = fields.get('endpointsuffix') ?? 'core.windows.net'
  const endpoint = fields.get('blobendpoint') ?? `https://${accountName}.blob.${suffix}`
  validateAzureEndpoint(endpoint, accountName)
  return {
    accountName,
    accountKey,
    sas,
    endpoint: new URL(endpoint).origin,
    secrets: [raw, accountKey, sasRaw, sas?.get('sig')].filter((value): value is string => Boolean(value)),
  }
}

function validateAzureEndpoint(endpoint: string, accountName: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('Azure Storage BlobEndpoint is invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Azure Storage BlobEndpoint must be a public HTTPS account endpoint')
  }
  const hostname = url.hostname.toLowerCase()
  if (!AZURE_BLOB_SUFFIXES.some((suffix) => hostname === `${accountName}${suffix}`)) {
    throw new Error('Azure Storage BlobEndpoint is not an allowed Azure Blob endpoint')
  }
}

function validateSas(raw: string): URLSearchParams {
  const params = new URLSearchParams(raw)
  const allowed = new Set([
    'sv', 'ss', 'srt', 'sp', 'se', 'st', 'spr', 'sig', 'si', 'sr', 'sip',
    'skoid', 'sktid', 'skt', 'ske', 'sks', 'skv', 'ses', 'rscc', 'rscd', 'rsce', 'rscl', 'rsct',
  ])
  for (const [key] of params) {
    if (!allowed.has(key.toLowerCase())) throw new Error('Azure SAS contains an unsupported parameter')
  }
  if (!params.get('sig') || (!params.get('sp') && !params.get('si'))) {
    throw new Error('Azure SharedAccessSignature is missing its signature or permissions')
  }
  return params
}

function sharedKeyAuthorization(
  credentials: AzureStorageCredentials,
  method: string,
  url: URL,
  headers: Record<string, string>,
): string {
  const canonicalHeaders = Object.entries(headers)
    .filter(([key]) => key.toLowerCase().startsWith('x-ms-'))
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('')
  const query = new Map<string, string[]>()
  for (const [key, value] of url.searchParams) {
    const normalized = key.toLowerCase()
    query.set(normalized, [...(query.get(normalized) ?? []), value])
  }
  const canonicalQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => `\n${key}:${values.sort().join(',')}`)
    .join('')
  const contentLength = headers['content-length'] === '0' ? '' : (headers['content-length'] ?? '')
  const stringToSign = [
    method,
    headers['content-encoding'] ?? '',
    headers['content-language'] ?? '',
    contentLength,
    headers['content-md5'] ?? '',
    headers['content-type'] ?? '',
    '',
    headers['if-modified-since'] ?? '',
    headers['if-match'] ?? '',
    headers['if-none-match'] ?? '',
    headers['if-unmodified-since'] ?? '',
    headers.range ?? '',
    `${canonicalHeaders}/${credentials.accountName}${url.pathname}${canonicalQuery}`,
  ].join('\n')
  const signature = createHmac('sha256', decodeAccountKey(credentials.accountKey!))
    .update(stringToSign, 'utf-8')
    .digest('base64')
  return `SharedKey ${credentials.accountName}:${signature}`
}

function decodeAccountKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('Azure Storage AccountKey is not valid base64')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength < 16 || decoded.toString('base64') !== value) {
    throw new Error('Azure Storage AccountKey is not valid base64')
  }
  return decoded
}

function requiredContainer(value: unknown, allowSystem = true): string {
  const container = requiredString(value, 'containerName')
  const standard = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(container)
  const system = allowSystem && /^\$(?:root|web|logs)$/.test(container)
  if (!standard && !system) throw new Error('containerName is not a valid Azure container name')
  return container
}

function requiredBlobName(value: unknown): string {
  const name = requiredString(value, 'blobName')
  if (name.length > 1024) throw new Error('blobName cannot exceed 1024 characters')
  if (name.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('blobName cannot contain dot path segments')
  }
  return name
}

function blobPath(name: string): string[] {
  return name.split('/')
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '%252F')
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('expected a string argument')
  return value
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${name} must be a positive integer`)
  return Number(value)
}

function requiredTags(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('tags must be an object')
  const entries = Object.entries(value)
  if (entries.length < 1 || entries.length > 10) throw new Error('tags must contain between 1 and 10 entries')
  return Object.fromEntries(entries.map(([key, entry]) => {
    if (!/^[A-Za-z0-9 _.:/-]{1,128}$/.test(key) || key.includes('"')) {
      throw new Error('Azure blob tag keys contain unsupported characters')
    }
    if (typeof entry !== 'string' || entry.length > 256 || entry.includes("'")) {
      throw new Error('Azure blob tag values must be strings without apostrophes and at most 256 characters')
    }
    return [key, entry]
  }))
}

function tagExpression(tags: Record<string, string>): string {
  return Object.entries(tags).map(([key, value]) => `"${key}" = '${value}'`).join(' AND ')
}

function serializeTagsHeader(tags: Record<string, string>): string {
  return new URLSearchParams(tags).toString()
}

function tagsXml(tags: Record<string, string>): string {
  const items = Object.entries(tags)
    .map(([key, value]) => `<Tag><Key>${escapeXml(key)}</Key><Value>${escapeXml(value)}</Value></Tag>`)
    .join('')
  return `<?xml version="1.0" encoding="utf-8"?><Tags><TagSet>${items}</TagSet></Tags>`
}

function parseContainerList(xml: string): unknown {
  return {
    containers: xmlBlocks(xml, 'Container').map((block) => ({
      name: xmlText(block, 'Name'),
      etag: xmlText(block, 'Etag'),
      lastModified: xmlText(block, 'Last-Modified'),
      deleted: xmlText(block, 'Deleted') === 'true',
    })),
    nextMarker: xmlText(xml, 'NextMarker') || undefined,
  }
}

function parseBlobList(xml: string): unknown {
  return {
    blobs: xmlBlocks(xml, 'Blob').map((block) => ({
      name: xmlText(block, 'Name'),
      etag: xmlText(block, 'Etag'),
      lastModified: xmlText(block, 'Last-Modified'),
      contentLength: numberOrUndefined(xmlText(block, 'Content-Length')),
      contentType: xmlText(block, 'Content-Type') || undefined,
    })),
    nextMarker: xmlText(xml, 'NextMarker') || undefined,
  }
}

function parseTaggedBlobList(xml: string): unknown {
  return {
    blobs: xmlBlocks(xml, 'Blob').map((block) => ({
      name: xmlText(block, 'Name'),
      containerName: xmlText(block, 'ContainerName'),
      tags: parseTags(block),
    })),
    nextMarker: xmlText(xml, 'NextMarker') || undefined,
  }
}

function parseTags(xml: string): Record<string, string> {
  return Object.fromEntries(xmlBlocks(xml, 'Tag').map((block) => [
    xmlText(block, 'Key'),
    xmlText(block, 'Value'),
  ]).filter(([key]) => Boolean(key)))
}

function xmlBlocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'g'))]
    .map((match) => match[1] ?? '')
}

function xmlText(xml: string, tag: string): string {
  return decodeXml(xmlBlocks(xml, tag)[0] ?? '')
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

function decodeStrictBase64(value: string): Buffer {
  if (value.length % 4 !== 0) {
    throw new Error('content is not valid base64')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) throw new Error('content is not valid base64')
  return decoded
}

function setOptionalQuery(query: URLSearchParams, key: string, value: string | number | undefined): void {
  if (value !== undefined) query.set(key, String(value))
}

function retryAfter(value: string | null): number {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1000, seconds * 1000) : RETRY_AFTER_MS
}

function redact(value: string, secrets: string[]): string {
  return secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), value)
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
