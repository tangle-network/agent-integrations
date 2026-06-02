import { declarativeRestConnector } from './declarative-rest.js'

export const amazonS3Connector = declarativeRestConnector({
  kind: 'amazon-s3',
  displayName: 'Amazon S3',
  description: 'Scalable storage in the cloud. Read, upload, delete, and manage files in S3 buckets.',
  auth: {
    kind: 'api-key',
    hint: 'AWS Access Key ID and Secret Access Key. Provide credentials for IAM user with S3 permissions.',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://s3.amazonaws.com',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'files.list',
      class: 'read',
      description: 'List files in an S3 bucket folder.',
      parameters: {
        type: 'object',
        properties: {
          prefix: { type: 'string', description: 'Folder path to filter results (e.g., docs/)' },
          maxKeys: { type: 'integer', description: 'Maximum number of files to return (1–1000)' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/',
        query: { prefix: '{prefix}', 'max-keys': '{maxKeys}' },
      },
    },
    {
      name: 'files.read',
      class: 'read',
      description: 'Read a file from S3.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The full path to the file in S3' },
        },
        required: ['key'],
      },
      request: {
        method: 'GET',
        path: '/{key}',
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
