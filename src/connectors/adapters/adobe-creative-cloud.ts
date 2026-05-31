import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Adobe Creative Cloud connector — Adobe IMS (Identity Management Service)
 * OAuth2 authorization-code flow against the publicly-documented Lightroom
 * Services API at https://lr.adobe.io, plus the IMS userinfo endpoint for
 * connection self-test.
 *
 * OAuth2 endpoints (Adobe IMS v2/v3):
 *   - authorize at https://ims-na1.adobelogin.com/ims/authorize/v2
 *   - exchange / refresh at https://ims-na1.adobelogin.com/ims/token/v3
 *   - userinfo at https://ims-na1.adobelogin.com/ims/userinfo/v2
 *
 * Adobe IMS is a standard RFC 6749 authorization-code grant. Access tokens
 * live ~24h and refresh tokens ~14 days; the declarative adapter routes
 * refreshes through the shared OAuth helpers and only declares the
 * authorize / token URLs here.
 *
 * The Creative Cloud surface is split across several distinct OpenAPI
 * products; the Lightroom Services API is the canonical "creative asset"
 * surface available to standard end-user OAuth clients (the Creative SDK,
 * Photoshop scripting, and the Asset Browser APIs require additional
 * partner programs). We scope this adapter to the public Lightroom +
 * IMS userinfo surface so every action here is callable with a vanilla
 * end-user Adobe ID + a self-service Developer Console OAuth Web App.
 *
 * Lightroom paths (https://lr.adobe.io) are catalog-scoped:
 *   /v2/account                       — account-level metadata
 *   /v2/catalogs                      — list catalogs the user owns
 *   /v2/catalogs/{catalog_id}         — read one catalog
 *   /v2/catalogs/{catalog_id}/albums  — list / create / update albums
 *   /v2/catalogs/{catalog_id}/assets  — list / search assets
 *   /v2/catalogs/{catalog_id}/assets/{asset_id}
 *   /v2/catalogs/{catalog_id}/albums/{album_id}/assets
 *
 * Lightroom requires every request to carry both the bearer access token
 * AND an `X-API-Key` header set to the OAuth client_id. The declarative
 * adapter sends the bearer through the standard credential placement; the
 * `X-API-Key` is templated into `defaultHeaders` using
 * `{credentials.clientId}` which the runtime substitutes from the resolved
 * data source. (See `declarative-rest.ts` for header templating.)
 *
 * Scope surface picked for the typical "agent enumerates the user's
 * library, searches assets, and organizes them into albums" pattern:
 *
 *   openid, profile, email          — IMS userinfo self-test
 *   offline_access                  — refresh token
 *   lr_partner_apis                 — Lightroom catalog read / search
 *   lr_partner_rendition_apis       — Lightroom rendition (preview) reads
 *
 * Adobe IMS scopes are comma-delimited at the authorize endpoint; the
 * declarative oauth runtime handles the separator. Write scopes
 * (album mutations) reuse `lr_partner_apis` — Adobe does not split read
 * vs write at the scope layer for the Lightroom partner surface, so the
 * action guard's least-privilege check keys off `requiredScopes` only
 * for filtering by capability identity (read vs mutation class), not by
 * a separate write scope.
 *
 * Action surface:
 *   - ims.userinfo            Self-test; resolves the authenticated Adobe ID.
 *   - account.get             Lightroom account metadata.
 *   - catalogs.list           Enumerate the user's Lightroom catalogs.
 *   - catalogs.get            Read one catalog.
 *   - albums.list             List albums in a catalog.
 *   - albums.get              Read one album.
 *   - albums.create           Create an album under a catalog.
 *   - albums.update           Rename / move / reparent an album.
 *   - albums.delete           Delete an album (assets are not deleted).
 *   - assets.list             Paginated catalog asset enumeration.
 *   - assets.get              Read one asset's metadata + revision tree.
 *   - assets.list_in_album    Assets attached to a specific album.
 *
 * Adobe Lightroom mutations are PUT-shaped with client-supplied UUIDs as
 * the resource id, so creates are `native-idempotency` (re-issuing the
 * same PUT with the same UUID is a no-op replay). Album updates are
 * `etag-if-match` — Lightroom returns ETag headers and rejects PUTs that
 * lack a matching `If-Match`. Deletes are `optimistic-read-verify` so the
 * action guard round-trips a metadata read before the destructive call.
 */
export const adobeCreativeCloudConnector = declarativeRestConnector({
  kind: 'adobe-creative-cloud',
  displayName: 'Adobe Creative Cloud',
  description:
    'Read and organize Adobe Lightroom catalogs, albums, and assets in a Creative Cloud account. Standard OAuth2 (Adobe IMS authorization-code grant) against the Lightroom Services API at lr.adobe.io.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://ims-na1.adobelogin.com/ims/authorize/v2',
    tokenUrl: 'https://ims-na1.adobelogin.com/ims/token/v3',
    scopes: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'lr_partner_apis',
      'lr_partner_rendition_apis',
    ],
    clientIdEnv: 'ADOBE_CREATIVE_CLOUD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ADOBE_CREATIVE_CLOUD_OAUTH_CLIENT_SECRET',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  // Lightroom catalog APIs live on lr.adobe.io; the IMS userinfo endpoint
  // is absolute-pathed under a different host. We keep the base on
  // lr.adobe.io and let the userinfo self-test action carry an absolute
  // URL via the templated `path`.
  baseUrl: 'https://lr.adobe.io',
  test: { method: 'GET', path: '/v2/account' },
  capabilities: [
    {
      name: 'ims.userinfo',
      class: 'read',
      description:
        'Read the authenticated Adobe ID profile (sub, name, email, account_type) from Adobe IMS. Useful as a non-Lightroom self-test that exercises the access token without needing a catalog.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: 'https://ims-na1.adobelogin.com/ims/userinfo/v2',
      },
      requiredScopes: ['openid', 'profile', 'email'],
    },
    {
      name: 'account.get',
      class: 'read',
      description:
        'Read Lightroom account metadata for the authenticated user (subscription tier, storage quota, default catalog id).',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v2/account' },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'catalogs.list',
      class: 'read',
      description:
        'Enumerate the Lightroom catalogs visible to the authenticated user. Most accounts have exactly one catalog; team plans surface multiple.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v2/catalogs' },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'catalogs.get',
      class: 'read',
      description:
        'Read one Lightroom catalog by id (returns catalog name, created, updated, asset count, and capability flags).',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: {
            type: 'string',
            description: 'Lightroom catalog UUID (from catalogs.list).',
          },
        },
        required: ['catalog_id'],
      },
      request: { method: 'GET', path: '/v2/catalogs/{catalog_id}' },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'albums.list',
      class: 'read',
      description:
        'List albums under a catalog. Returns a `links.next` href when paginated; pass `name_after` to resume.',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          subtype: {
            type: 'string',
            enum: ['collection', 'collection_set', 'project'],
            description: 'Filter by album subtype.',
          },
          name_after: {
            type: 'string',
            description: 'Pagination cursor returned in `links.next` from a prior page.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: 'Page size; Lightroom caps at 500.',
          },
        },
        required: ['catalog_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/catalogs/{catalog_id}/albums',
        query: {
          subtype: '{subtype}',
          name_after: '{name_after}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'albums.get',
      class: 'read',
      description: 'Read one album by id within a catalog (album name, subtype, parent_id, cover asset).',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          album_id: { type: 'string', description: 'Album UUID.' },
        },
        required: ['catalog_id', 'album_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/catalogs/{catalog_id}/albums/{album_id}',
      },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'albums.create',
      class: 'mutation',
      description:
        'Create an album under a catalog. The caller supplies the album UUID (Lightroom uses PUT with a client-chosen id), so re-issuing the same call is a deterministic replay.',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          album_id: {
            type: 'string',
            description: 'Caller-supplied album UUID. Must be a v4 UUID; Lightroom dedupes by (catalog_id, album_id).',
          },
          subtype: {
            type: 'string',
            enum: ['collection', 'collection_set', 'project'],
            description: 'Album subtype; defaults to "collection".',
          },
          payload: {
            type: 'object',
            description: 'AlbumPayload — { name, parent: { id } | null, cover: { id } | null, ... }.',
          },
        },
        required: ['catalog_id', 'album_id', 'payload'],
      },
      request: {
        method: 'PUT',
        path: '/v2/catalogs/{catalog_id}/albums/{album_id}',
        body: '{payload}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'albums.update',
      class: 'mutation',
      description:
        'Update an album (rename, reparent, change cover). Lightroom honors `If-Match` against the album ETag; the declarative layer flags this as etag-if-match so the action guard reads-before-writes.',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          album_id: { type: 'string', description: 'Album UUID.' },
          payload: {
            type: 'object',
            description: 'AlbumUpdatePayload — partial set of mutable fields (name, parent, cover).',
          },
        },
        required: ['catalog_id', 'album_id', 'payload'],
      },
      request: {
        method: 'PUT',
        path: '/v2/catalogs/{catalog_id}/albums/{album_id}',
        body: '{payload}',
      },
      cas: 'etag-if-match',
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'albums.delete',
      class: 'mutation',
      description:
        'Delete an album. Lightroom soft-deletes the album record but does NOT delete the contained assets (they remain in the catalog under "All Photos").',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          album_id: { type: 'string', description: 'Album UUID.' },
        },
        required: ['catalog_id', 'album_id'],
      },
      request: {
        method: 'DELETE',
        path: '/v2/catalogs/{catalog_id}/albums/{album_id}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'assets.list',
      class: 'read',
      description:
        'List assets in a catalog. Filters by subtype (image | video), capture date range, and a cursor for incremental enumeration.',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          subtype: {
            type: 'string',
            enum: ['image', 'video'],
            description: 'Filter by asset subtype.',
          },
          captured_after: {
            type: 'string',
            description: 'ISO8601 lower bound on capture timestamp.',
          },
          captured_before: {
            type: 'string',
            description: 'ISO8601 upper bound on capture timestamp.',
          },
          name_after: {
            type: 'string',
            description: 'Pagination cursor returned in `links.next` from a prior page.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: 'Page size; Lightroom caps at 500.',
          },
        },
        required: ['catalog_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/catalogs/{catalog_id}/assets',
        query: {
          subtype: '{subtype}',
          captured_after: '{captured_after}',
          captured_before: '{captured_before}',
          name_after: '{name_after}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'assets.get',
      class: 'read',
      description:
        'Read one asset by id within a catalog. Returns the asset payload (capture metadata, develop settings, rendition links).',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          asset_id: { type: 'string', description: 'Asset UUID.' },
        },
        required: ['catalog_id', 'asset_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/catalogs/{catalog_id}/assets/{asset_id}',
      },
      requiredScopes: ['lr_partner_apis'],
    },
    {
      name: 'assets.list_in_album',
      class: 'read',
      description:
        'List the assets attached to a specific album within a catalog. Use the `links.next` cursor to page.',
      parameters: {
        type: 'object',
        properties: {
          catalog_id: { type: 'string', description: 'Lightroom catalog UUID.' },
          album_id: { type: 'string', description: 'Album UUID.' },
          name_after: {
            type: 'string',
            description: 'Pagination cursor returned in `links.next` from a prior page.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            description: 'Page size; Lightroom caps at 500.',
          },
        },
        required: ['catalog_id', 'album_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/catalogs/{catalog_id}/albums/{album_id}/assets',
        query: {
          name_after: '{name_after}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['lr_partner_apis'],
    },
  ],
})
