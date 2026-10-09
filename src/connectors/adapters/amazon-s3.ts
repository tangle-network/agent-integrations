import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { ConnectorAdapter } from '../types.js'
import { declarativeRestConnector } from './declarative-rest.js'

const restConnector = declarativeRestConnector({
  kind: 'amazon-s3',
  displayName: 'Amazon S3',
  description: 'Scalable storage in the cloud. Read, upload, delete, and manage files in S3 buckets.',
  auth: {
    kind: 'api-key',
    hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"} for an IAM principal with S3 permissions. Optional "sessionToken" and "endpoint" (S3-compatible stores). Requests are signed with AWS Signature V4; the region selects the s3.<region>.amazonaws.com endpoint.',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  // S3 REST API, path-style. Each request is signed with AWS Signature V4
  // (service `s3`, which signs the request path verbatim); the bundle's region
  // is substituted into the `{region}` host template.
  credentialPlacement: { kind: 'aws-sigv4', service: 's3' },
  baseUrl: 'https://s3.{region}.amazonaws.com',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'files.list',
      class: 'read',
      description: 'List one page of objects in a bucket using ListObjectsV2. Returns objects (key, etag, size), isTruncated, and nextContinuationToken. Follow the token while isTruncated is true, including empty pages.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', minLength: 1, description: 'Bucket name; defaults to the connection credential bundle bucket when omitted.' },
          continuationToken: { type: 'string', description: 'Opaque NextContinuationToken from the previous ListObjectsV2 XML response.' },
          prefix: { type: 'string', description: 'Folder path to filter results (e.g., docs/)' },
          maxKeys: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of files to return (1–1000)' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/{bucket}',
        redirect: 'error',
        maxResponseBytes: 2 * 1024 * 1024,
        query: { 'list-type': 2, prefix: '{prefix}', 'max-keys': '{maxKeys}', 'continuation-token': '{continuationToken}' },
      },
    },
    {
      name: 'files.read',
      class: 'read',
      description: 'Read a file from S3.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', minLength: 1, description: 'Bucket name; defaults to the connection credential bundle bucket when omitted.' },
          versionId: { type: 'string', description: 'Optional immutable S3 object version.' },
          key: { type: 'string', minLength: 1, description: 'Exact object key relative to the bucket, not a URL. Slashes are preserved; dot segments are refused.' },
        },
        required: ['key'],
      },
      request: {
        method: 'GET',
        path: '/{bucket}/{key}',
        pathSegmentParameters: ['key'],
        redirect: 'error',
        maxResponseBytes: 32 * 1024 * 1024,
        query: { versionId: '{versionId}' },
      },
    },
    {
      name: 'files.readBytes',
      class: 'read',
      description: 'Read exact object bytes as data.base64 plus data.contentType and an ETag. Use this for binary files and source-evidence ingestion; decode base64 before parsing.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', minLength: 1, description: 'Bucket name; defaults to the connection credential bundle bucket when omitted.' },
          versionId: { type: 'string', description: 'Optional immutable S3 object version.' },
          key: { type: 'string', minLength: 1, description: 'Exact object key relative to the bucket, not a URL. Slashes are preserved; dot segments are refused.' },
        },
        required: ['key'],
      },
      request: {
        method: 'GET',
        path: '/{bucket}/{key}',
        pathSegmentParameters: ['key'],
        redirect: 'error',
        maxResponseBytes: 32 * 1024 * 1024,
        responseBody: 'base64',
        query: { versionId: '{versionId}' },
      },
    },
    {
      name: 'files.upload',
      class: 'mutation',
      description: 'Upload a file to S3.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The file path and name in S3' },
          contentType: { type: 'string', description: 'MIME type of the file' },
        },
        required: ['key'],
      },
      request: {
        method: 'PUT',
        path: '/{key}',
        headers: { 'Content-Type': '{contentType}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'files.delete',
      class: 'mutation',
      description: 'Delete a file from S3.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The full path to the file to delete' },
        },
        required: ['key'],
      },
      request: {
        method: 'DELETE',
        path: '/{key}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'files.generateSignedUrl',
      class: 'read',
      description: 'Generate a signed URL for temporary access to a file.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The file path in S3' },
          expiresIn: { type: 'integer', description: 'URL validity duration in minutes' },
        },
        required: ['key', 'expiresIn'],
      },
      request: {
        method: 'GET',
        path: '/{key}',
        query: { 'X-Amz-Expires': '{expiresIn}' },
      },
    },
    {
      name: 'files.moveFile',
      class: 'mutation',
      description: 'Move a file to a different location in S3.',
      parameters: {
        type: 'object',
        properties: {
          sourceKey: { type: 'string', description: 'Current file path' },
          destinationKey: { type: 'string', description: 'New file path' },
        },
        required: ['sourceKey', 'destinationKey'],
      },
      request: {
        method: 'PUT',
        path: '/{destinationKey}',
        headers: { 'x-amz-copy-source': '{sourceKey}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'files.copyFile',
      class: 'mutation',
      description: 'Server-side copy of an object to a new key. Source is left in place.',
      parameters: {
        type: 'object',
        properties: {
          sourceKey: {
            type: 'string',
            description: 'Existing object identifier as {bucket}/{key}.',
          },
          destinationKey: {
            type: 'string',
            description: 'New object key (relative to the destination bucket).',
          },
        },
        required: ['sourceKey', 'destinationKey'],
      },
      request: {
        method: 'PUT',
        path: '/{destinationKey}',
        headers: { 'x-amz-copy-source': '{sourceKey}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'files.setMetadata',
      class: 'mutation',
      description:
        'Replace object metadata in place via the S3 copy-self pattern (x-amz-metadata-directive: REPLACE).',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Object key whose metadata should be replaced.' },
          contentType: { type: 'string', description: 'New Content-Type for the object.' },
          metadata: {
            type: 'string',
            description:
              'Serialized x-amz-meta-* JSON forwarded as the x-amz-meta-user header (caller-controlled).',
          },
        },
        required: ['key'],
      },
      request: {
        method: 'PUT',
        path: '/{key}',
        headers: {
          'x-amz-copy-source': '{key}',
          'x-amz-metadata-directive': 'REPLACE',
          'Content-Type': '{contentType}',
          'x-amz-meta-user': '{metadata}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'files.createBucket',
      class: 'mutation',
      description:
        'Create a new bucket in the configured region. Request is a PUT against the bucket name path.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name to create.' },
          region: {
            type: 'string',
            description: 'AWS region for the bucket (sent via x-amz-bucket-region).',
          },
        },
        required: ['bucket'],
      },
      request: {
        method: 'PUT',
        path: '/{bucket}',
        headers: { 'x-amz-bucket-region': '{region}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})

/** Provider XML stays inside the adapter; hosts consume one paginated shape. */
export const amazonS3Connector: ConnectorAdapter = {
  ...restConnector,
  async executeRead(inv) {
    if (inv.capabilityName === 'files.list' || inv.capabilityName === 'files.read' || inv.capabilityName === 'files.readBytes') {
      const bucket = inv.args.bucket
      if (bucket !== undefined && (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))) {
        throw new Error('S3 bucket must be a bucket name, not a URL or path')
      }
      if (inv.capabilityName === 'files.list') {
        const maximum = inv.args.maxKeys
        if (maximum !== undefined && (typeof maximum !== 'number' || !Number.isInteger(maximum) || maximum < 1 || maximum > 1000)) {
          throw new Error('S3 maxKeys must be an integer between 1 and 1000')
        }
      } else if (typeof inv.args.key !== 'string' || !inv.args.key || Buffer.byteLength(inv.args.key, 'utf8') > 1024) {
        throw new Error('S3 key must contain between 1 and 1024 UTF-8 bytes')
      }
    }
    const result = await restConnector.executeRead!(inv)
    if (inv.capabilityName !== 'files.list') return result
    const raw = (result.data as { raw?: unknown } | null)?.raw
    if (typeof raw !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true) {
      throw new Error('S3 returned an invalid ListObjectsV2 XML response')
    }
    if ((raw.match(/</g)?.length ?? 0) > 30000) throw new Error('S3 XML exceeds element limit')
    const parsed = new XMLParser({ parseTagValue: false, trimValues: false, ignoreAttributes: true, maxNestedTags: 16 }).parse(raw)
    const page = parsed?.ListBucketResult
    if (!page || (page.IsTruncated !== 'true' && page.IsTruncated !== 'false')) {
      throw new Error('S3 returned an invalid ListObjectsV2 page')
    }
    const isTruncated = page.IsTruncated === 'true'
    const nextContinuationToken = page.NextContinuationToken
    if (isTruncated && (typeof nextContinuationToken !== 'string' || !nextContinuationToken || nextContinuationToken.length > 16384)) {
      throw new Error('S3 truncated page is missing its continuation token')
    }
    const contents = page.Contents === undefined ? [] : Array.isArray(page.Contents) ? page.Contents : [page.Contents]
    if (contents.length > 1000) throw new Error('S3 page exceeds 1000 object limit')
    const objects = contents.map((item: Record<string, unknown>) => {
      if (typeof item.Key !== 'string' || !item.Key || Buffer.byteLength(item.Key, 'utf8') > 1024) throw new Error('S3 object is missing its key')
      const size = Number(item.Size)
      if (typeof item.Size !== 'string' || !/^\d+$/.test(item.Size) || !Number.isSafeInteger(size)) {
        throw new Error('S3 object has an invalid size')
      }
      if (item.ETag !== undefined && typeof item.ETag !== 'string') throw new Error('S3 object has an invalid ETag')
      return { key: item.Key, size, ...(item.ETag === undefined ? {} : { etag: item.ETag }) }
    })
    return { ...result, data: { objects, isTruncated, ...(isTruncated ? { nextContinuationToken } : {}) } }
  },
}
