import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google Cloud Storage connector — buckets, objects, and ACLs.
 *
 * Auth is Google's standard OAuth2 user-grant flow:
 *   - authorize at https://accounts.google.com/o/oauth2/v2/auth
 *   - exchange / refresh at https://oauth2.googleapis.com/token
 *
 * The activepieces catalog declares `auth: oauth2` with access_token +
 * refresh_token credential fields, which maps onto the offline-access
 * variant of the user-grant flow (refresh tokens are minted when the
 * authorize call includes `access_type=offline&prompt=consent`).
 *
 * Scope picked: `devstorage.full_control`. The catalog exposes both
 * read and write actions (createBucket, deleteEmptyBucket, cloneObject,
 * deleteObject, createObjectAcl, deleteObjectAcl, createBucketAcl,
 * deleteBucketAcl, createBucketDefaultObjectAcl,
 * deleteBucketDefaultObjectAcl, searchObjects, searchBuckets) plus ACL
 * mutations on both buckets and objects. `read_only` cannot satisfy the
 * mutation surface, and `read_write` cannot satisfy the ACL surface;
 * `full_control` is the smallest scope that covers everything declared
 * in the catalog. Adapters that only need read access should override
 * `requiredScopes` per-capability via the runtime grant model.
 *
 * Action surface mirrors the activepieces catalog 1:1:
 *   Buckets:
 *     - buckets.search                   List buckets in a project.
 *     - buckets.create                   Insert a new bucket.
 *     - buckets.delete_empty             Delete an empty bucket.
 *   Objects:
 *     - objects.search                   List objects in a bucket.
 *     - objects.clone                    Server-side copy of an object.
 *     - objects.delete                   Delete an object (or object version).
 *   Bucket ACLs (the bucket-level ACL collection):
 *     - bucket_acl.create
 *     - bucket_acl.delete
 *   Bucket default object ACLs (applied to newly-created objects):
 *     - bucket_default_object_acl.create
 *     - bucket_default_object_acl.delete
 *   Object ACLs (per-object ACL collection):
 *     - object_acl.create
 *     - object_acl.delete
 *
 * Triggers (newObjectCreated, objectUpdated) are NOT modeled here. GCS
 * does not push webhooks for object-change events to arbitrary HTTPS
 * sinks without a Pub/Sub notification configuration; the activepieces
 * triggers poll the bucket listing. Polling triggers belong in a poller
 * adapter, not a request/response adapter, so they are intentionally
 * omitted.
 *
 * Consistency model is `authoritative`: the GCS JSON API returns the
 * canonical post-write resource representation on every successful 2xx,
 * including the `generation` (object version) and `metageneration`
 * counters used for optimistic concurrency. The adapter relies on the
 * response body as the source of truth for write outcomes.
 *
 * CAS:
 *   - Creates use `native-idempotency`. GCS's object insert accepts the
 *     `ifGenerationMatch=0` precondition to make creation conditional on
 *     the destination not already existing; bucket inserts surface 409
 *     on (project, name) collisions, which the declarative layer maps to
 *     `{ status: 'conflict' }`.
 *   - Deletes use `etag-if-match`. Bucket and object deletes accept
 *     `ifMetagenerationMatch` / `ifGenerationMatch` query preconditions;
 *     when the runtime carries an `etag` from a prior read, it threads it
 *     onto the delete request. ACL deletes are scoped by (bucket, entity)
 *     so collisions are well-defined.
 *
 * Base URL is `https://storage.googleapis.com/storage/v1`. Cloud Storage
 * also exposes an XML API at storage.googleapis.com root, but the
 * activepieces piece (and the rest action set above) targets the JSON
 * API exclusively.
 */
export const googleCloudStorageConnector = declarativeRestConnector({
  kind: 'google-cloud-storage',
  displayName: 'Google Cloud Storage',
  description:
    'Manage buckets, objects, and ACLs in Google Cloud Storage via the JSON API at storage.googleapis.com/storage/v1.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/devstorage.full_control'],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://storage.googleapis.com/storage/v1',
  test: { method: 'GET', path: '/b', query: { project: '{project}', maxResults: '1' } },
  capabilities: [
    {
      name: 'buckets.search',
      class: 'read',
      description: 'List buckets in a Google Cloud project.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Google Cloud project id that owns the buckets.' },
          prefix: { type: 'string', description: 'Optional name prefix to filter results.' },
          maxResults: { type: 'integer', description: 'Max buckets per page (1..1000).' },
          pageToken: { type: 'string', description: 'Continuation token from a prior page response.' },
        },
        required: ['project'],
      },
      request: {
        method: 'GET',
        path: '/b',
        query: {
          project: '{project}',
          prefix: '{prefix}',
          maxResults: '{maxResults}',
          pageToken: '{pageToken}',
        },
      },
    },
    {
      name: 'buckets.create',
      class: 'mutation',
      description: 'Insert a new bucket in the given project. Bucket names are globally unique.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project id that will own the bucket.' },
          name: { type: 'string', description: 'Globally-unique bucket name.' },
          location: {
            type: 'string',
            description: 'Bucket location (e.g. "US", "EU", "us-central1"). Defaults to "US" when omitted.',
          },
          storageClass: {
            type: 'string',
            enum: ['STANDARD', 'NEARLINE', 'COLDLINE', 'ARCHIVE'],
            description: 'Default storage class for newly-created objects.',
          },
        },
        required: ['project', 'name'],
      },
      request: {
        method: 'POST',
        path: '/b',
        query: { project: '{project}' },
        body: { name: '{name}', location: '{location}', storageClass: '{storageClass}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'buckets.delete_empty',
      class: 'mutation',
      description: 'Delete an empty bucket. Fails with 409 if the bucket still contains objects.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          ifMetagenerationMatch: {
            type: 'string',
            description: 'Optimistic-concurrency precondition on bucket metageneration.',
          },
        },
        required: ['bucket'],
      },
      request: {
        method: 'DELETE',
        path: '/b/{bucket}',
        query: { ifMetagenerationMatch: '{ifMetagenerationMatch}' },
      },
      cas: 'etag-if-match',
    },
    {
      name: 'objects.search',
      class: 'read',
      description: 'List objects in a bucket. Supports prefix + delimiter for folder-style enumeration.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          prefix: { type: 'string', description: 'Object name prefix to filter on (folder-style listing).' },
          delimiter: { type: 'string', description: 'Path delimiter (typically "/") to roll up sub-prefixes.' },
          maxResults: { type: 'integer', description: 'Max objects per page (1..1000).' },
          pageToken: { type: 'string', description: 'Continuation token from a prior page response.' },
          versions: { type: 'boolean', description: 'Include non-current object versions in the response.' },
        },
        required: ['bucket'],
      },
      request: {
        method: 'GET',
        path: '/b/{bucket}/o',
        query: {
          prefix: '{prefix}',
          delimiter: '{delimiter}',
          maxResults: '{maxResults}',
          pageToken: '{pageToken}',
          versions: '{versions}',
        },
      },
    },
    {
      name: 'objects.clone',
      class: 'mutation',
      description: 'Server-side copy an object to a new bucket + name. Source and destination may live in different buckets.',
      parameters: {
        type: 'object',
        properties: {
          sourceBucket: { type: 'string', description: 'Source bucket name.' },
          sourceObject: { type: 'string', description: 'Source object name (URL-encoded if it contains "/").' },
          destinationBucket: { type: 'string', description: 'Destination bucket name.' },
          destinationObject: { type: 'string', description: 'Destination object name.' },
          sourceGeneration: {
            type: 'string',
            description: 'Pin the copy to a specific source generation (object version).',
          },
        },
        required: ['sourceBucket', 'sourceObject', 'destinationBucket', 'destinationObject'],
      },
      request: {
        method: 'POST',
        path: '/b/{sourceBucket}/o/{sourceObject}/copyTo/b/{destinationBucket}/o/{destinationObject}',
        query: { sourceGeneration: '{sourceGeneration}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'objects.delete',
      class: 'mutation',
      description: 'Delete an object. When the bucket has versioning enabled, pass `generation` to delete a specific version.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          object: { type: 'string', description: 'Object name.' },
          generation: { type: 'string', description: 'Specific object version to delete.' },
          ifGenerationMatch: {
            type: 'string',
            description: 'Optimistic-concurrency precondition on object generation.',
          },
        },
        required: ['bucket', 'object'],
      },
      request: {
        method: 'DELETE',
        path: '/b/{bucket}/o/{object}',
        query: {
          generation: '{generation}',
          ifGenerationMatch: '{ifGenerationMatch}',
        },
      },
      cas: 'etag-if-match',
    },
    {
      name: 'bucket_acl.create',
      class: 'mutation',
      description: 'Grant a role to an entity on the bucket-level ACL collection.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          entity: {
            type: 'string',
            description: 'ACL entity (e.g. "user-alice@example.com", "group-eng@example.com", "allUsers").',
          },
          role: {
            type: 'string',
            enum: ['READER', 'WRITER', 'OWNER'],
            description: 'Role granted to the entity.',
          },
        },
        required: ['bucket', 'entity', 'role'],
      },
      request: {
        method: 'POST',
        path: '/b/{bucket}/acl',
        body: { entity: '{entity}', role: '{role}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bucket_acl.delete',
      class: 'mutation',
      description: 'Revoke a bucket-level ACL grant from an entity.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          entity: { type: 'string', description: 'ACL entity to remove.' },
        },
        required: ['bucket', 'entity'],
      },
      request: { method: 'DELETE', path: '/b/{bucket}/acl/{entity}' },
      cas: 'etag-if-match',
    },
    {
      name: 'bucket_default_object_acl.create',
      class: 'mutation',
      description:
        'Add an entry to the bucket default object ACL. New objects created in the bucket inherit this grant unless overridden at insert time.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          entity: { type: 'string', description: 'ACL entity (e.g. "user-alice@example.com").' },
          role: {
            type: 'string',
            enum: ['READER', 'OWNER'],
            description: 'Role granted to the entity on newly-created objects.',
          },
        },
        required: ['bucket', 'entity', 'role'],
      },
      request: {
        method: 'POST',
        path: '/b/{bucket}/defaultObjectAcl',
        body: { entity: '{entity}', role: '{role}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bucket_default_object_acl.delete',
      class: 'mutation',
      description: 'Remove an entry from the bucket default object ACL.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          entity: { type: 'string', description: 'ACL entity to remove.' },
        },
        required: ['bucket', 'entity'],
      },
      request: { method: 'DELETE', path: '/b/{bucket}/defaultObjectAcl/{entity}' },
      cas: 'etag-if-match',
    },
    {
      name: 'object_acl.create',
      class: 'mutation',
      description: 'Grant a role to an entity on a specific object\'s ACL collection.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          object: { type: 'string', description: 'Object name.' },
          entity: { type: 'string', description: 'ACL entity (e.g. "user-alice@example.com", "allUsers").' },
          role: {
            type: 'string',
            enum: ['READER', 'OWNER'],
            description: 'Role granted to the entity on this object.',
          },
          generation: {
            type: 'string',
            description: 'Specific object version to grant on; defaults to the current generation.',
          },
        },
        required: ['bucket', 'object', 'entity', 'role'],
      },
      request: {
        method: 'POST',
        path: '/b/{bucket}/o/{object}/acl',
        query: { generation: '{generation}' },
        body: { entity: '{entity}', role: '{role}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'object_acl.delete',
      class: 'mutation',
      description: 'Revoke a per-object ACL grant from an entity.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string', description: 'Bucket name.' },
          object: { type: 'string', description: 'Object name.' },
          entity: { type: 'string', description: 'ACL entity to remove.' },
          generation: {
            type: 'string',
            description: 'Specific object version to revoke from; defaults to the current generation.',
          },
        },
        required: ['bucket', 'object', 'entity'],
      },
      request: {
        method: 'DELETE',
        path: '/b/{bucket}/o/{object}/acl/{entity}',
        query: { generation: '{generation}' },
      },
      cas: 'etag-if-match',
    },
  ],
})
