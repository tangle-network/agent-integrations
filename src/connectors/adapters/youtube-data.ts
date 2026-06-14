import { declarativeRestConnector } from './declarative-rest.js'

/**
 * YouTube Data API (v3) — resolve a channel, list its recent uploads, and pull
 * public video metadata for any creator the connected identity can see.
 *
 * Auth model: standard Google OAuth2 with `youtube.readonly`. The connected
 * Google account authenticates the call; the data returned is public, so this
 * reads ANY public channel (not just the connected user's own). Reuses the
 * shared Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`) — no separate
 * API key.
 *
 * Scope boundary: this is reads only. Transcript bodies are deliberately NOT
 * here — `captions.download` is owner-only on the Data API, so third-party
 * transcripts come from the executing agent's own tooling against YouTube's
 * timed-text interface, not this connector. `captions.list` reports only whether
 * caption tracks EXIST, so a caller can decide whether to fetch them out-of-band.
 *
 * Consistency: public YouTube metadata (view counts, recent uploads) trails the
 * live site by minutes, so the connector is `cache` — not a real-time mirror.
 */
export const youtubeDataConnector = declarativeRestConnector({
  kind: 'youtube',
  displayName: 'YouTube',
  description:
    'Resolve a YouTube channel by @handle, username, or id; list its most recent uploads; and fetch public video metadata (title, description, duration, view/like counts) for any public channel the connected Google identity can read.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://www.googleapis.com/youtube/v3',
  // channels.list with mine=true is the cheapest probe (1 quota unit) that
  // confirms the token reaches the Data API with the youtube scope. It returns
  // empty for an account without a channel — still a 200, still a valid token.
  test: { method: 'GET', path: '/channels', query: { part: 'id', mine: 'true' } },
  capabilities: [
    {
      name: 'channels.resolve',
      class: 'read',
      description:
        'Resolve a channel and read its snippet, statistics, and the uploads-playlist id needed by channels.recentUploads. Pass exactly one of handle (e.g. "@MrBeast"), username (legacy), or channelId (GET /channels?part=snippet,statistics,contentDetails).',
      parameters: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Channel @handle, e.g. "@MrBeast" (with or without the leading @).' },
          username: { type: 'string', description: 'Legacy channel username (only for old custom-username channels).' },
          channelId: { type: 'string', description: 'Canonical channel id (UC...), if already known.' },
        },
      },
      request: {
        method: 'GET',
        path: '/channels',
        query: {
          part: 'snippet,statistics,contentDetails',
          forHandle: '{handle}',
          forUsername: '{username}',
          id: '{channelId}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    },
    {
      name: 'channels.recentUploads',
      class: 'read',
      description:
        'List a channel\'s most recent uploads (video id, title, description, publishedAt) from its uploads playlist. Get uploadsPlaylistId from channels.resolve (contentDetails.relatedPlaylists.uploads). maxResults is 1-50, default 15 (GET /playlistItems?part=snippet,contentDetails).',
      parameters: {
        type: 'object',
        properties: {
          uploadsPlaylistId: { type: 'string', description: 'The channel\'s uploads playlist id (UU...), from channels.resolve.' },
          maxResults: { type: 'integer', description: 'How many recent uploads to return (1-50, default 15).' },
          pageToken: { type: 'string', description: 'Page token from a prior response\'s nextPageToken to page further back.' },
        },
        required: ['uploadsPlaylistId'],
      },
      request: {
        method: 'GET',
        path: '/playlistItems',
        query: {
          part: 'snippet,contentDetails',
          playlistId: '{uploadsPlaylistId}',
          maxResults: '{maxResults}',
          pageToken: '{pageToken}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    },
    {
      name: 'videos.list',
      class: 'read',
      description:
        'Fetch public metadata for up to 50 videos by id — title, description, duration, and view/like/comment counts. Pass a comma-separated id list, e.g. "id1,id2,id3" (GET /videos?part=snippet,statistics,contentDetails).',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'string', description: 'Comma-separated video ids (max 50), e.g. "dQw4w9WgXcQ,abc123".' },
        },
        required: ['ids'],
      },
      request: {
        method: 'GET',
        path: '/videos',
        query: { part: 'snippet,statistics,contentDetails', id: '{ids}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    },
    {
      name: 'captions.list',
      class: 'read',
      description:
        'List the caption tracks AVAILABLE for a video (language, kind, auto-vs-manual). Reports availability only — caption bodies are owner-only on the Data API, so fetch transcript text out-of-band. (GET /captions?part=snippet&videoId=...).',
      parameters: {
        type: 'object',
        properties: {
          videoId: { type: 'string', description: 'The video id to list caption tracks for.' },
        },
        required: ['videoId'],
      },
      request: {
        method: 'GET',
        path: '/captions',
        query: { part: 'snippet', videoId: '{videoId}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    },
  ],
})
