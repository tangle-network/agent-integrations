import { declarativeRestConnector } from './declarative-rest.js'

// LinkedIn exposes two coexisting REST surfaces under api.linkedin.com:
//   - the legacy `/v2/*` surface (userinfo, organizations, organizationAcls)
//   - the versioned `/rest/*` surface (Posts API, socialActions/comments,
//     Marketing endpoints) which requires a `LinkedIn-Version: YYYYMM` header
//     and `X-Restli-Protocol-Version: 2.0.0`.
//
// Both surfaces share the same OAuth 2.0 (3-legged) access tokens. Member
// (user) tokens carry sign-in + `w_member_social` scopes; Marketing / company
// page actions require the LinkedIn Marketing Developer Platform scopes
// (`r_organization_social`, `w_organization_social`, `rw_organization_admin`).
//
// Consistency: LinkedIn shares/posts are append-only, advisory — the platform
// exposes no ETag / If-Match path for post creation, and `w_member_social`
// is rate-limited per-member-per-day. We use:
//   - cas:'none' for post creation (caller-owned idempotency via the
//     X-RestLi-Method header + idempotencyKey shape the engine threads).
//   - cas:'native-idempotency' for delete-by-urn (idempotent on the urn).
//   - cas:'optimistic-read-verify' for comment edit-by-urn.
//
// The `LinkedIn-Version` pin below targets a stable, generally-available
// monthly revision; bump in tandem with the Marketing API release notes.
export const linkedinConnector = declarativeRestConnector({
  kind: 'linkedin',
  displayName: 'LinkedIn',
  description:
    'Read the connected LinkedIn member profile and administered organizations, and create / read / delete member or organization posts and comments via the LinkedIn REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: [
      'openid',
      'profile',
      'email',
      'w_member_social',
      'r_organization_social',
      'w_organization_social',
      'rw_organization_admin',
    ],
    clientIdEnv: 'LINKEDIN_OAUTH_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.linkedin.com',
  defaultHeaders: {
    'LinkedIn-Version': '202405',
    'X-Restli-Protocol-Version': '2.0.0',
  },
  test: { method: 'GET', path: '/v2/userinfo' },
  capabilities: [
    {
      name: 'userinfo',
      class: 'read',
      description:
        'Return the OpenID-Connect userinfo for the connected LinkedIn member (sub, name, given_name, family_name, picture, email, email_verified, locale).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/userinfo' },
      requiredScopes: ['openid', 'profile'],
    },
    {
      name: 'organizations.get',
      class: 'read',
      description:
        'Read a single LinkedIn organization (company page) by numeric id. The connected member must be an administrator of the organization.',
      parameters: {
        type: 'object',
        properties: { organizationId: { type: 'string' } },
        required: ['organizationId'],
      },
      request: { method: 'GET', path: '/v2/organizations/{organizationId}' },
      requiredScopes: ['r_organization_social'],
    },
    {
      name: 'organizations.acls.list',
      class: 'read',
      description:
        'List the organizations (and roles) for which the connected member has an ACL — i.e. the company pages they can read or post on behalf of.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER', 'RECRUITING_POSTER'],
            default: 'ADMINISTRATOR',
          },
          state: {
            type: 'string',
            enum: ['APPROVED', 'REQUESTED', 'REJECTED', 'REVOKED'],
            default: 'APPROVED',
          },
          count: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
          start: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/organizationAcls',
        query: {
          q: 'roleAssignee',
          role: '{role}',
          state: '{state}',
          count: '{count}',
          start: '{start}',
        },
      },
      requiredScopes: ['r_organization_social', 'rw_organization_admin'],
    },
    {
      name: 'posts.create',
      class: 'mutation',
      description:
        'Create a LinkedIn post on the REST Posts API. `author` is the member or organization URN (e.g. `urn:li:person:{sub}` or `urn:li:organization:{id}`). `commentary` is the post text; `distribution.feedDistribution` defaults to `MAIN_FEED`; `lifecycleState` defaults to `PUBLISHED`. Append-only — caller owns dedupe via idempotencyKey.',
      parameters: {
        type: 'object',
        properties: {
          author: {
            type: 'string',
            description: 'URN of the post author (urn:li:person:{sub} or urn:li:organization:{id}).',
          },
          commentary: { type: 'string', description: 'Post text body.' },
          visibility: {
            type: 'string',
            enum: ['PUBLIC', 'CONNECTIONS', 'LOGGED_IN', 'CONTAINER'],
            default: 'PUBLIC',
          },
          distribution: {
            type: 'object',
            description:
              'Distribution policy. Defaults to { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }.',
          },
          content: {
            type: 'object',
            description:
              'Optional rich-media content block ({ article: {...} } | { media: {...} } | { multiImage: {...} } | { poll: {...} } | { carousel: {...} }).',
          },
          lifecycleState: {
            type: 'string',
            enum: ['PUBLISHED', 'DRAFT'],
            default: 'PUBLISHED',
          },
          isReshareDisabledByAuthor: { type: 'boolean', default: false },
        },
        required: ['author', 'commentary'],
      },
      request: {
        method: 'POST',
        path: '/rest/posts',
        body: {
          author: '{author}',
          commentary: '{commentary}',
          visibility: '{visibility}',
          distribution: '{distribution}',
          content: '{content}',
          lifecycleState: '{lifecycleState}',
          isReshareDisabledByAuthor: '{isReshareDisabledByAuthor}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['w_member_social'],
    },
    {
      name: 'posts.get',
      class: 'read',
      description:
        'Read a single post by its URN (e.g. `urn:li:share:1234567890` or `urn:li:ugcPost:1234567890`). The URN must be URL-encoded by the caller.',
      parameters: {
        type: 'object',
        properties: {
          postUrn: {
            type: 'string',
            description: 'URL-encoded URN of the post (urn:li:share:* or urn:li:ugcPost:*).',
          },
        },
        required: ['postUrn'],
      },
      request: { method: 'GET', path: '/rest/posts/{postUrn}' },
      requiredScopes: ['r_organization_social'],
    },
    {
      name: 'posts.list.byAuthor',
      class: 'read',
      description:
        'List posts authored by a given URN (member or organization). Uses the Posts API finder `q=author`.',
      parameters: {
        type: 'object',
        properties: {
          author: {
            type: 'string',
            description: 'URN of the author to list posts for.',
          },
          count: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          start: { type: 'integer', minimum: 0, default: 0 },
          sortBy: {
            type: 'string',
            enum: ['CREATED', 'LAST_MODIFIED'],
            default: 'CREATED',
          },
        },
        required: ['author'],
      },
      request: {
        method: 'GET',
        path: '/rest/posts',
        query: {
          q: 'author',
          author: '{author}',
          count: '{count}',
          start: '{start}',
          sortBy: '{sortBy}',
        },
      },
      requiredScopes: ['r_organization_social'],
    },
    {
      name: 'posts.delete',
      class: 'mutation',
      description:
        'Delete a post by its URL-encoded URN. Idempotent on the URN — replays after success return 404 and the engine maps that to a no-op.',
      parameters: {
        type: 'object',
        properties: {
          postUrn: { type: 'string' },
        },
        required: ['postUrn'],
      },
      request: { method: 'DELETE', path: '/rest/posts/{postUrn}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['w_member_social'],
    },
    {
      name: 'comments.list',
      class: 'read',
      description:
        'List comments on a share / post. `shareUrn` is the URL-encoded URN of the parent share (urn:li:share:* or urn:li:ugcPost:*).',
      parameters: {
        type: 'object',
        properties: {
          shareUrn: { type: 'string' },
          count: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          start: { type: 'integer', minimum: 0, default: 0 },
        },
        required: ['shareUrn'],
      },
      request: {
        method: 'GET',
        path: '/rest/socialActions/{shareUrn}/comments',
        query: { count: '{count}', start: '{start}' },
      },
      requiredScopes: ['r_organization_social'],
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description:
        'Create a top-level comment on a share / post. `actor` is the member or organization URN posting the comment; `message.text` is the comment text. Append-only — caller owns dedupe via idempotencyKey.',
      parameters: {
        type: 'object',
        properties: {
          shareUrn: {
            type: 'string',
            description: 'URL-encoded URN of the parent share (urn:li:share:* or urn:li:ugcPost:*).',
          },
          actor: {
            type: 'string',
            description: 'URN of the commenting member or organization.',
          },
          message: {
            type: 'object',
            description: 'Comment body `{ text: string, attributes?: [...] }`.',
          },
          parentComment: {
            type: 'string',
            description: 'Optional URN of a parent comment for threaded replies.',
          },
        },
        required: ['shareUrn', 'actor', 'message'],
      },
      request: {
        method: 'POST',
        path: '/rest/socialActions/{shareUrn}/comments',
        body: {
          actor: '{actor}',
          object: '{shareUrn}',
          message: '{message}',
          parentComment: '{parentComment}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['w_member_social'],
    },
    {
      name: 'comments.update',
      class: 'mutation',
      description:
        'Edit the text of an existing comment by its URN. Only the original comment actor can edit. Verified via read-after-write because LinkedIn returns no ETag.',
      parameters: {
        type: 'object',
        properties: {
          shareUrn: { type: 'string' },
          commentUrn: { type: 'string', description: 'URL-encoded URN of the comment to update.' },
          actor: { type: 'string' },
          message: { type: 'object' },
        },
        required: ['shareUrn', 'commentUrn', 'actor', 'message'],
      },
      request: {
        method: 'POST',
        path: '/rest/socialActions/{shareUrn}/comments/{commentUrn}',
        headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' },
        body: { actor: '{actor}', message: '{message}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
      requiredScopes: ['w_member_social'],
    },
    {
      name: 'comments.delete',
      class: 'mutation',
      description: 'Delete a comment by URN. `actor` must be the comment author. Idempotent on the URN.',
      parameters: {
        type: 'object',
        properties: {
          shareUrn: { type: 'string' },
          commentUrn: { type: 'string' },
          actor: { type: 'string' },
        },
        required: ['shareUrn', 'commentUrn', 'actor'],
      },
      request: {
        method: 'DELETE',
        path: '/rest/socialActions/{shareUrn}/comments/{commentUrn}',
        query: { actor: '{actor}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['w_member_social'],
    },
    {
      name: 'socialActions.get',
      class: 'read',
      description:
        'Read the aggregate social-action counts (likes, comments) for a share / post URN.',
      parameters: {
        type: 'object',
        properties: { shareUrn: { type: 'string' } },
        required: ['shareUrn'],
      },
      request: { method: 'GET', path: '/rest/socialActions/{shareUrn}' },
      requiredScopes: ['r_organization_social'],
    },
  ],
})
