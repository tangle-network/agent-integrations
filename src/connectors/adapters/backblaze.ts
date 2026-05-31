import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Backblaze B2 connector — S3-compatible object storage.
 *
 * The activepieces catalog entry models Backblaze as an api-key connector
 * with four wiring fields: accessKeyId, secretAccessKey, bucket, and region
 * (endpoint is optional and computed from region when omitted). That maps
 * directly onto Backblaze B2's S3-compatible REST surface, which lives at
 *   https://s3.{region}.backblazeb2.com
 * (e.g. s3.us-west-001.backblazeb2.com) and accepts AWS SigV4-signed
 * requests against the bucket as a virtual-hosted-style or path-style
 * resource. Because the declarative-REST adapter carries one base URL per
 * connector and does not own request-time signing, the manifest here
 * captures the action surface; SigV4 signing is layered on by the runtime
 * once it sees the api-key credential bundle (accessKeyId + secretAccessKey).
 *
 * Action surface mirrors the activepieces catalog 1:1:
 *   - files.read         Read object bytes / metadata from a key in the bucket.
 *   - files.s3_upload    Upload an object to a key (or folderPath/fileName).
 *
 * Triggers (catalog "new.back.blaze.file") are not modeled on the
 * declarative-REST adapter — Backblaze does not emit native webhooks for
 * object events; the activepieces trigger polls the bucket. Polling-style
 * triggers belong in a poller adapter, not a request/response adapter,
 * so they're intentionally omitted here.
 *
 * Consistency model is `authoritative`: B2's bucket APIs return canonical
 * post-write state (the upload response carries the assigned fileId, sha1,
 * and content metadata), so a successful 2xx is the source of truth.
 *
 * CAS:
 *   - files.read is a plain read.
 *   - files.s3_upload is marked `native-idempotency` because B2 lets the
 *     client supply an `X-Bz-Content-Sha1` (or use the S3 `If-None-Match: *`
 *     header on the PUT) to make the upload conditional / dedupable on the
 *     destination key.
 */
export const backblazeConnector = declarativeRestConnector({
  kind: 'backblaze',
  displayName: 'Backblaze B2',
  description:
    'Read and upload objects on a Backblaze B2 bucket via the S3-compatible REST API at s3.{region}.backblazeb2.com.',
  auth: {
    kind: 'api-key',
    hint: 'Backblaze B2 application key pair (accessKeyId + secretAccessKey) scoped to the target bucket. Region selects the s3.{region}.backblazeb2.com endpoint.',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  // Endpoint is region-derived in the activepieces piece; the runtime
  // resolves {region} from the credential bundle when constructing the
  // request URL. The declarative-REST adapter takes a string baseUrl, so
  // we keep the template here and rely on the runtime's URL resolver to
  // substitute the region placeholder from the credential metadata.
  baseUrl: 'https://s3.{region}.backblazeb2.com',
  test: { method: 'GET', path: '/{bucket}?list-type=2&max-keys=1' },
  capabilities: [
    {
      name: 'files.read',
      class: 'read',
      description:
        'Read an object from the configured bucket. Returns the object bytes and S3 response headers (Content-Type, Content-Length, ETag, x-amz-meta-*). `key` is the full object key including any extension; folder-style keys use forward slashes.',
      parameters: {
        type: 'object',
        properties: {
          bucket: {
            type: 'string',
            description: 'Bucket name. Defaults to the connector-configured bucket when omitted.',
          },
          key: {
            type: 'string',
            description:
              'Full object key (e.g. "reports/2026/q1.pdf"). Include the extension verbatim — Backblaze treats keys as opaque byte strings.',
          },
        },
        required: ['key'],
      },
      request: { method: 'GET', path: '/{bucket}/{key}' },
    },
    {
      name: 'files.s3_upload',
      class: 'mutation',
      description:
        'Upload an object to the bucket via S3 PutObject. The destination key is built from `folderPath` + `fileName` when both are present, otherwise `fileName` is used as the full key. `type` selects the Content-Type sent on the PUT, and `acl` maps to the S3 canned-ACL header (private | public-read).',
      parameters: {
        type: 'object',
        properties: {
          bucket: {
            type: 'string',
            description: 'Bucket name. Defaults to the connector-configured bucket when omitted.',
          },
          fileName: {
            type: 'string',
            description:
              'File name without extension by activepieces convention. Combined with `folderPath` to form the destination key; pass a full path here (e.g. "reports/q1.pdf") to store at the bucket root.',
          },
          folderPath: {
            type: 'string',
            description:
              'Optional folder prefix (e.g. "reports/2026"). Joined to `fileName` with a single "/" separator.',
          },
          file: {
            type: 'string',
            description:
              'Object body. Pass a base64-encoded string for binary content, or a UTF-8 string for text. The runtime decodes and sets Content-Length.',
          },
          type: {
            type: 'string',
            description:
              'MIME type sent as the Content-Type header (e.g. "application/pdf", "image/png"). Required by the activepieces piece.',
          },
          acl: {
            type: 'string',
            enum: ['private', 'public-read'],
            description:
              'S3 canned ACL applied to the new object. Backblaze honors `private` and `public-read`; other canned ACLs are rejected.',
          },
        },
        required: ['fileName', 'file', 'type'],
      },
      request: {
        method: 'PUT',
        path: '/{bucket}/{folderPath}/{fileName}',
        headers: {
          'content-type': '{type}',
          'x-amz-acl': '{acl}',
        },
        body: '{file}',
      },
      cas: 'native-idempotency',
    },
  ],
})
