import { declarativeRestConnector } from './declarative-rest.js'

// Instagram Business / Creator accounts are managed through the Facebook Graph
// API: the OAuth handshake is Facebook Login (Meta for Developers app), and
// per-account requests address the IG User Node (`/{ig-user-id}`) and its
// media/comment edges. The Instagram User ID is the IG-scoped business account
// id returned from `/me/accounts?fields=instagram_business_account`; the
// orchestrator resolves it during onboarding and stores it on the connection
// metadata as `igUserId`. The graph host is shared with Facebook (Pages, Ads,
// WhatsApp Cloud, etc.) and is fixed per API version — we pin v21.0, the
// current GA surface as of 2025-Q4.
//
// Token exchange uses Facebook's long-lived user-access-token flow; we accept
// either short- or long-lived tokens at runtime — both authenticate the same
// graph requests as `?access_token=…` (Meta does not document a Bearer header
// for the public graph). Credential is therefore placed as a query parameter,
// not an Authorization header.

const mediaContainerProperties = {
  type: 'object',
  properties: {
    image_url: { type: 'string' },
    video_url: { type: 'string' },
    media_type: { type: 'string', enum: ['IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'] },
    caption: { type: 'string' },
    location_id: { type: 'string' },
    user_tags: { type: 'array' },
    product_tags: { type: 'array' },
    children: { type: 'array', items: { type: 'string' } },
    is_carousel_item: { type: 'boolean' },
    thumb_offset: { type: 'integer' },
    share_to_feed: { type: 'boolean' },
    cover_url: { type: 'string' },
    audio_name: { type: 'string' },
    collaborators: { type: 'array', items: { type: 'string' } },
  },
}

export const instagramBusinessConnector = declarativeRestConnector({
  kind: 'instagram-business',
  displayName: 'Instagram Business',
  description:
    'Publish, read, and moderate content on an Instagram Business or Creator account via the Facebook Graph API: create media containers, publish posts/reels/stories, read insights, fetch comments, and reply or hide threads.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: [
      'instagram_basic',
      'instagram_content_publish',
      'instagram_manage_comments',
      'instagram_manage_insights',
      'instagram_manage_messages',
      'pages_show_list',
      'pages_read_engagement',
      'business_management',
    ],
    clientIdEnv: 'INSTAGRAM_BUSINESS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'INSTAGRAM_BUSINESS_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.facebook.com/v21.0',
  // Graph API takes the user access token as a query parameter (?access_token=).
  // No Authorization header is honored on the public graph.
  credentialPlacement: { kind: 'query', parameter: 'access_token' },
  test: { method: 'GET', path: '/{igUserId}', query: { fields: 'id,username' } },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description:
        'Read the connected IG Business account profile (id, username, name, biography, followers_count, follows_count, media_count, profile_picture_url, website).',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['igUserId'],
      },
      request: {
        method: 'GET',
        path: '/{igUserId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['instagram_basic'],
    },
    {
      name: 'media.list',
      class: 'read',
      description:
        'List media (posts / reels / stories) published by the IG Business account, paginated via the Graph API cursor (after/before).',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer' },
          after: { type: 'string' },
          before: { type: 'string' },
        },
        required: ['igUserId'],
      },
      request: {
        method: 'GET',
        path: '/{igUserId}/media',
        query: {
          fields: '{fields}',
          limit: '{limit}',
          after: '{after}',
          before: '{before}',
        },
      },
      requiredScopes: ['instagram_basic'],
    },
    {
      name: 'media.get',
      class: 'read',
      description:
        'Read a single media object (post, reel, or story) including caption, media_type, permalink, timestamp, like_count, comments_count, and thumbnail_url.',
      parameters: {
        type: 'object',
        properties: {
          mediaId: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['mediaId'],
      },
      request: {
        method: 'GET',
        path: '/{mediaId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['instagram_basic'],
    },
    {
      name: 'media.insights',
      class: 'read',
      description:
        'Read engagement insights (impressions, reach, saved, video_views, plays, total_interactions, etc.) for a published media object.',
      parameters: {
        type: 'object',
        properties: {
          mediaId: { type: 'string' },
          metric: { type: 'string' },
          period: { type: 'string' },
          breakdown: { type: 'string' },
        },
        required: ['mediaId', 'metric'],
      },
      request: {
        method: 'GET',
        path: '/{mediaId}/insights',
        query: {
          metric: '{metric}',
          period: '{period}',
          breakdown: '{breakdown}',
        },
      },
      requiredScopes: ['instagram_manage_insights'],
    },
    {
      name: 'account.insights',
      class: 'read',
      description:
        'Read account-level insights (reach, impressions, profile_views, follower_count, audience_gender_age, online_followers) for the IG Business account.',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          metric: { type: 'string' },
          period: { type: 'string' },
          metric_type: { type: 'string' },
          since: { type: 'integer' },
          until: { type: 'integer' },
        },
        required: ['igUserId', 'metric', 'period'],
      },
      request: {
        method: 'GET',
        path: '/{igUserId}/insights',
        query: {
          metric: '{metric}',
          period: '{period}',
          metric_type: '{metric_type}',
          since: '{since}',
          until: '{until}',
        },
      },
      requiredScopes: ['instagram_manage_insights'],
    },
    {
      name: 'comments.list',
      class: 'read',
      description:
        'List top-level comments on a media object. Use replies.list to walk nested threads.',
      parameters: {
        type: 'object',
        properties: {
          mediaId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer' },
          after: { type: 'string' },
        },
        required: ['mediaId'],
      },
      request: {
        method: 'GET',
        path: '/{mediaId}/comments',
        query: {
          fields: '{fields}',
          limit: '{limit}',
          after: '{after}',
        },
      },
      requiredScopes: ['instagram_manage_comments'],
    },
    {
      name: 'comment.get',
      class: 'read',
      description:
        'Read a single comment by id including text, timestamp, like_count, hidden, replies, and from.username.',
      parameters: {
        type: 'object',
        properties: {
          commentId: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['commentId'],
      },
      request: {
        method: 'GET',
        path: '/{commentId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['instagram_manage_comments'],
    },
    {
      name: 'replies.list',
      class: 'read',
      description: 'List replies to a comment thread.',
      parameters: {
        type: 'object',
        properties: {
          commentId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['commentId'],
      },
      request: {
        method: 'GET',
        path: '/{commentId}/replies',
        query: { fields: '{fields}', limit: '{limit}' },
      },
      requiredScopes: ['instagram_manage_comments'],
    },
    {
      name: 'hashtag.search',
      class: 'read',
      description:
        'Resolve a hashtag string into its IG hashtag id. Hashtag-search quotas are enforced per IG user per 7-day window.',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          q: { type: 'string' },
        },
        required: ['igUserId', 'q'],
      },
      request: {
        method: 'GET',
        path: '/ig_hashtag_search',
        query: { user_id: '{igUserId}', q: '{q}' },
      },
      requiredScopes: ['instagram_basic'],
    },
    {
      name: 'hashtag.recentMedia',
      class: 'read',
      description: 'List recently tagged media for a hashtag id.',
      parameters: {
        type: 'object',
        properties: {
          hashtagId: { type: 'string' },
          igUserId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['hashtagId', 'igUserId'],
      },
      request: {
        method: 'GET',
        path: '/{hashtagId}/recent_media',
        query: {
          user_id: '{igUserId}',
          fields: '{fields}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['instagram_basic'],
    },
    {
      name: 'mentions.list',
      class: 'read',
      description: 'List media in which the IG Business account is @-mentioned.',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['igUserId'],
      },
      request: {
        method: 'GET',
        path: '/{igUserId}/tags',
        query: { fields: '{fields}', limit: '{limit}' },
      },
      requiredScopes: ['instagram_basic'],
    },
    {
      name: 'media.createContainer',
      class: 'mutation',
      description:
        'Step 1 of the Content Publishing API: create a media container holding the image_url / video_url + caption. The container id returned must be passed to media.publish once `status_code=FINISHED`.',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          container: mediaContainerProperties,
        },
        required: ['igUserId', 'container'],
      },
      request: {
        method: 'POST',
        path: '/{igUserId}/media',
        body: {
          image_url: '{container.image_url}',
          video_url: '{container.video_url}',
          media_type: '{container.media_type}',
          caption: '{container.caption}',
          location_id: '{container.location_id}',
          user_tags: '{container.user_tags}',
          product_tags: '{container.product_tags}',
          children: '{container.children}',
          is_carousel_item: '{container.is_carousel_item}',
          thumb_offset: '{container.thumb_offset}',
          share_to_feed: '{container.share_to_feed}',
          cover_url: '{container.cover_url}',
          audio_name: '{container.audio_name}',
          collaborators: '{container.collaborators}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['instagram_content_publish'],
    },
    {
      name: 'media.containerStatus',
      class: 'read',
      description:
        'Poll the container processing status (status_code: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED). Required between createContainer and publish for video / reel uploads.',
      parameters: {
        type: 'object',
        properties: {
          containerId: { type: 'string' },
        },
        required: ['containerId'],
      },
      request: {
        method: 'GET',
        path: '/{containerId}',
        query: { fields: 'status_code,status' },
      },
      requiredScopes: ['instagram_content_publish'],
    },
    {
      name: 'media.publish',
      class: 'mutation',
      description:
        'Step 2 of the Content Publishing API: publish a previously-created container to the IG Business feed. Returns the newly created media id.',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
          creationId: { type: 'string' },
        },
        required: ['igUserId', 'creationId'],
      },
      request: {
        method: 'POST',
        path: '/{igUserId}/media_publish',
        body: { creation_id: '{creationId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['instagram_content_publish'],
    },
    {
      name: 'publishingLimit.get',
      class: 'read',
      description:
        'Read the IG Business account publishing-rate quota: how many of the 50 / 24h publishes remain. Use before bulk-scheduling.',
      parameters: {
        type: 'object',
        properties: {
          igUserId: { type: 'string' },
        },
        required: ['igUserId'],
      },
      request: {
        method: 'GET',
        path: '/{igUserId}/content_publishing_limit',
        query: { fields: 'config,quota_usage' },
      },
      requiredScopes: ['instagram_content_publish'],
    },
    {
      name: 'comments.reply',
      class: 'mutation',
      description: 'Post a reply to a comment thread on a media object.',
      parameters: {
        type: 'object',
        properties: {
          commentId: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['commentId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/{commentId}/replies',
        body: { message: '{message}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['instagram_manage_comments'],
    },
    {
      name: 'comments.hide',
      class: 'mutation',
      description: 'Hide or unhide a comment from public view (does not delete it).',
      parameters: {
        type: 'object',
        properties: {
          commentId: { type: 'string' },
          hide: { type: 'boolean' },
        },
        required: ['commentId', 'hide'],
      },
      request: {
        method: 'POST',
        path: '/{commentId}',
        body: { hide: '{hide}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['instagram_manage_comments'],
    },
    {
      name: 'comments.delete',
      class: 'mutation',
      description: 'Permanently delete a comment authored by, or moderatable by, the connected account.',
      parameters: {
        type: 'object',
        properties: {
          commentId: { type: 'string' },
        },
        required: ['commentId'],
      },
      request: {
        method: 'DELETE',
        path: '/{commentId}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['instagram_manage_comments'],
    },
  ],
})
