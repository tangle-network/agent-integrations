import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google Contacts — OAuth2 Bearer against people.googleapis.com (People API v1).
 *
 * The People API is the supported successor to the deprecated Contacts API
 * v3 and is the surface that Google's own "Contacts" UI, Gmail's address
 * book, and Workspace's directory share. Every resource is keyed by
 * `people/{contactId}` (for personal contacts) or `people/{directoryId}`
 * (for directory entries the user can read). Mutating endpoints require
 * an `updatePersonFields` mask (PATCH) or a typed body (POST/DELETE) and
 * use the `Etag` field on the Person resource for optimistic concurrency.
 *
 * Scopes:
 *   - contacts            — read + write personal contacts
 *   - contacts.readonly   — read personal contacts (used for low-risk reads)
 *   - contacts.other.readonly — read "Other contacts" auto-imported from
 *                                Gmail / Calendar interactions
 *   - directory.readonly  — read the Workspace directory (org users)
 *   - userinfo.email      — used by the test request below
 *
 * See https://developers.google.com/people/api/rest/v1 .
 */
export const googleContactsConnector = declarativeRestConnector({
  kind: 'google-contacts',
  displayName: 'Google Contacts',
  description:
    'Read, search, create, update, and delete personal Google contacts via the Google People API v1 (people.googleapis.com), including "Other contacts" and Workspace directory entries.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/contacts.other.readonly',
      'https://www.googleapis.com/auth/directory.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://people.googleapis.com',
  // OpenID userinfo endpoint is the cheapest no-side-effect probe accepted
  // by a vanilla `userinfo.email` grant; People API has no equivalent
  // "ping" endpoint, and `people/me` would 403 without contacts scope on
  // some restricted grants.
  test: {
    method: 'GET',
    path: '/v1/people/me',
    query: { personFields: 'names,emailAddresses' },
  },
  capabilities: [
    {
      name: 'people.get',
      class: 'read',
      description:
        'Read a single Person by resource name (e.g. "people/c12345678901234567"). `personFields` is required and selects which fields the response should populate.',
      parameters: {
        type: 'object',
        properties: {
          resourceName: {
            type: 'string',
            description: 'Person resource name like "people/{contact_id}" or "people/me" for the authenticated user.',
          },
          personFields: {
            type: 'string',
            description:
              'Comma-separated list of person fields to return, e.g. "names,emailAddresses,phoneNumbers,organizations,addresses,biographies".',
          },
        },
        required: ['resourceName', 'personFields'],
      },
      request: {
        method: 'GET',
        path: '/v1/{resourceName}',
        query: { personFields: '{personFields}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    },
    {
      name: 'people.list',
      class: 'read',
      description:
        'List the authenticated user\'s personal contacts ("people/me/connections"). Supports pagination and a sync token for incremental fetches.',
      parameters: {
        type: 'object',
        properties: {
          personFields: {
            type: 'string',
            description: 'Comma-separated list of person fields to return.',
          },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
          syncToken: {
            type: 'string',
            description: 'Token from a previous response used to fetch only changes since that response.',
          },
          requestSyncToken: {
            type: 'boolean',
            description: 'Set true to request a syncToken in the response for later incremental sync.',
          },
          sortOrder: {
            type: 'string',
            description: 'LAST_MODIFIED_ASCENDING | LAST_MODIFIED_DESCENDING | FIRST_NAME_ASCENDING | LAST_NAME_ASCENDING.',
          },
        },
        required: ['personFields'],
      },
      request: {
        method: 'GET',
        path: '/v1/people/me/connections',
        query: {
          personFields: '{personFields}',
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          syncToken: '{syncToken}',
          requestSyncToken: '{requestSyncToken}',
          sortOrder: '{sortOrder}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    },
    {
      name: 'people.search',
      class: 'read',
      description:
        'Server-side prefix search over the user\'s contacts using "people:searchContacts". Returns ranked matches by name, email, phone, or organization.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Prefix to match against name, email, phone, or org fields.' },
          readMask: {
            type: 'string',
            description: 'Comma-separated field mask, e.g. "names,emailAddresses,phoneNumbers".',
          },
          pageSize: { type: 'integer', minimum: 1, maximum: 30 },
        },
        required: ['query', 'readMask'],
      },
      request: {
        method: 'GET',
        path: '/v1/people:searchContacts',
        query: {
          query: '{query}',
          readMask: '{readMask}',
          pageSize: '{pageSize}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    },
    {
      name: 'otherContacts.list',
      class: 'read',
      description:
        '"Other contacts" — addresses Google auto-imports from Gmail/Calendar interactions. Read-only and exposed under a separate scope.',
      parameters: {
        type: 'object',
        properties: {
          readMask: { type: 'string', description: 'Comma-separated field mask (names, emailAddresses, phoneNumbers).' },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
          syncToken: { type: 'string' },
          requestSyncToken: { type: 'boolean' },
        },
        required: ['readMask'],
      },
      request: {
        method: 'GET',
        path: '/v1/otherContacts',
        query: {
          readMask: '{readMask}',
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          syncToken: '{syncToken}',
          requestSyncToken: '{requestSyncToken}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/contacts.other.readonly'],
    },
    {
      name: 'otherContacts.search',
      class: 'read',
      description: 'Prefix search across "Other contacts".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          readMask: { type: 'string' },
          pageSize: { type: 'integer', minimum: 1, maximum: 30 },
        },
        required: ['query', 'readMask'],
      },
      request: {
        method: 'GET',
        path: '/v1/otherContacts:search',
        query: {
          query: '{query}',
          readMask: '{readMask}',
          pageSize: '{pageSize}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/contacts.other.readonly'],
    },
    {
      name: 'directory.list',
      class: 'read',
      description:
        'List Workspace directory people (org users + shared contacts). Available only on Google Workspace tenants where the admin enabled directory sharing.',
      parameters: {
        type: 'object',
        properties: {
          readMask: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description:
              'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT and/or DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE.',
          },
          mergeSources: {
            type: 'array',
            items: { type: 'string' },
            description: 'DIRECTORY_MERGE_SOURCE_TYPE_CONTACT to merge personal contact data when available.',
          },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
          syncToken: { type: 'string' },
          requestSyncToken: { type: 'boolean' },
        },
        required: ['readMask', 'sources'],
      },
      request: {
        method: 'GET',
        path: '/v1/people:listDirectoryPeople',
        query: {
          readMask: '{readMask}',
          sources: '{sources}',
          mergeSources: '{mergeSources}',
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          syncToken: '{syncToken}',
          requestSyncToken: '{requestSyncToken}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/directory.readonly'],
    },
    {
      name: 'directory.search',
      class: 'read',
      description: 'Prefix search across the Workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          readMask: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          mergeSources: { type: 'array', items: { type: 'string' } },
          pageSize: { type: 'integer', minimum: 1, maximum: 500 },
        },
        required: ['query', 'readMask', 'sources'],
      },
      request: {
        method: 'GET',
        path: '/v1/people:searchDirectoryPeople',
        query: {
          query: '{query}',
          readMask: '{readMask}',
          sources: '{sources}',
          mergeSources: '{mergeSources}',
          pageSize: '{pageSize}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/directory.readonly'],
    },
    {
      name: 'people.create',
      class: 'mutation',
      description:
        'Create a new personal contact. The body is a full Person resource (names, emailAddresses, phoneNumbers, organizations, etc.). `personFields` selects which fields to return on the populated response.',
      parameters: {
        type: 'object',
        properties: {
          person: {
            type: 'object',
            description: 'Person resource body, e.g. { names: [{ givenName, familyName }], emailAddresses: [...] }.',
          },
          personFields: { type: 'string' },
        },
        required: ['person'],
      },
      request: {
        method: 'POST',
        path: '/v1/people:createContact',
        query: { personFields: '{personFields}' },
        body: '{person}',
      },
      // People API has no Idempotency-Key on createContact; consecutive POSTs
      // produce duplicate contacts. The MutationGuard layer must dedupe by
      // idempotencyKey on the caller side.
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/contacts'],
    },
    {
      name: 'people.update',
      class: 'mutation',
      description:
        'Update a personal contact. `updatePersonFields` is required and is a comma-separated FieldMask of the mutated top-level fields. The Person body must include the current `etag` for optimistic concurrency.',
      parameters: {
        type: 'object',
        properties: {
          resourceName: { type: 'string', description: 'Resource name like "people/{contact_id}".' },
          updatePersonFields: {
            type: 'string',
            description: 'Comma-separated FieldMask of mutated top-level fields, e.g. "names,emailAddresses".',
          },
          personFields: {
            type: 'string',
            description: 'Field mask selecting which fields the response should re-populate.',
          },
          person: {
            type: 'object',
            description: 'Person body with `etag` from the prior read and the new field values.',
          },
        },
        required: ['resourceName', 'updatePersonFields', 'person'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/{resourceName}:updateContact',
        query: {
          updatePersonFields: '{updatePersonFields}',
          personFields: '{personFields}',
        },
        body: '{person}',
      },
      // updateContact rejects stale `etag` values with HTTP 400 FAILED_PRECONDITION,
      // which is the People API's optimistic-concurrency contract.
      cas: 'etag-if-match',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/contacts'],
    },
    {
      name: 'people.delete',
      class: 'mutation',
      description: 'Delete a personal contact by resource name.',
      parameters: {
        type: 'object',
        properties: {
          resourceName: { type: 'string', description: 'Resource name like "people/{contact_id}".' },
        },
        required: ['resourceName'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/{resourceName}:deleteContact',
      },
      // Repeating DELETE on an already-deleted resource yields 404 NOT_FOUND
      // but is idempotent in effect (the contact remains deleted).
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/contacts'],
    },
    {
      name: 'people.batchGet',
      class: 'read',
      description:
        'Read up to 200 contacts in one round trip. `resourceNames` is a repeated query parameter.',
      parameters: {
        type: 'object',
        properties: {
          resourceNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Up to 200 "people/{contact_id}" resource names.',
          },
          personFields: { type: 'string' },
        },
        required: ['resourceNames', 'personFields'],
      },
      request: {
        method: 'GET',
        path: '/v1/people:batchGet',
        query: {
          resourceNames: '{resourceNames}',
          personFields: '{personFields}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    },
  ],
})
