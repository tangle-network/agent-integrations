import { declarativeRestConnector } from './declarative-rest.js'

/**
 * HeyGen connector.
 *
 * Authentication: workspace API key delivered via the `X-Api-Key` header. HeyGen
 * does not publish a third-party OAuth surface, so api-key is the only honest
 * placement; sending it as Bearer would silently 401 on the v1 endpoints.
 *
 * Endpoint surface: the public v1/v2 split is real — template generation and
 * avatar/voice listing live under v2 while status, listing, translation, asset
 * upload, and share-link minting live under v1. We declare the path version
 * inline per capability to keep the wire contract auditable from this file.
 *
 * Async generation contract: `videos.createFromTemplate` and `videos.translate`
 * both return a `video_id` (or `video_translate_id`) immediately; the actual
 * rendered MP4 is produced by the downstream pipeline. Callers MUST poll the
 * matching `*.status` capability — there is no synchronous result. The
 * `cas: 'native-idempotency'` annotation reflects that submitting the same
 * payload twice creates two render jobs, which is why the orchestrator must
 * supply an idempotency token; HeyGen itself does not deduplicate.
 */
export const heygenConnector = declarativeRestConnector({
  kind: 'heygen',
  displayName: 'HeyGen',
  description: 'Generate and manage AI avatar videos using HeyGen: render from templates, translate, list assets, and poll job status.',
  auth: {
    kind: 'api-key',
    hint: 'HeyGen workspace API key. Create one at https://app.heygen.com/settings under API.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.heygen.com',
  credentialPlacement: { kind: 'header', header: 'X-Api-Key' },
  // GET /v2/voices is a cheap authenticated probe that does not consume credits.
  test: { method: 'GET', path: '/v2/voices' },
  capabilities: [
    {
      name: 'videos.createFromTemplate',
      class: 'mutation',
      description:
        'Submit a template-based video render. Returns a video_id; poll videos.status until the asset is ready.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'HeyGen template id to render from.' },
          title: { type: 'string', description: 'Title of the generated video.' },
          variables: {
            type: 'object',
            description: 'Template variable bindings (text/avatar/voice overrides keyed by variable name).',
          },
          caption: { type: 'boolean', description: 'Burn-in captions on the rendered video.' },
          includeGif: { type: 'boolean', description: 'Also produce a GIF preview.' },
          enableSharing: { type: 'boolean', description: 'Enable public share link on completion.' },
          callbackUrl: { type: 'string', description: 'Webhook URL to notify when rendering completes.' },
          callbackId: { type: 'string', description: 'Caller-supplied ID echoed in webhook payload.' },
          dimensionWidth: { type: 'integer', description: 'Output video width in pixels.' },
          dimensionHeight: { type: 'integer', description: 'Output video height in pixels.' },
        },
        required: ['templateId', 'title'],
      },
      request: {
        method: 'POST',
        path: '/v2/template/{templateId}/generate',
        body: {
          title: '{title}',
          variables: '{variables}',
          caption: '{caption}',
          include_gif: '{includeGif}',
          enable_sharing: '{enableSharing}',
          callback_url: '{callbackUrl}',
          callback_id: '{callbackId}',
          dimension: { width: '{dimensionWidth}', height: '{dimensionHeight}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'videos.status',
      class: 'read',
      description: 'Retrieve the status, progress, and (if complete) output URLs for a generated video.',
      parameters: {
        type: 'object',
        properties: { videoId: { type: 'string', description: 'video_id returned from a generation call.' } },
        required: ['videoId'],
      },
      request: { method: 'GET', path: '/v1/video_status.get', query: { video_id: '{videoId}' } },
    },
    {
      name: 'videos.translateStatus',
      class: 'read',
      description: 'Retrieve the status of a translated video by its translate id.',
      parameters: {
        type: 'object',
        properties: {
          videoTranslateId: {
            type: 'string',
            description: 'video_translate_id returned from videos.translate.',
          },
        },
        required: ['videoTranslateId'],
      },
      request: { method: 'GET', path: '/v1/video_translate/{videoTranslateId}' },
    },
    {
      name: 'videos.shareUrl',
      class: 'read',
      description: 'Mint or fetch a sharable URL for a previously generated video.',
      parameters: {
        type: 'object',
        properties: { videoId: { type: 'string' } },
        required: ['videoId'],
      },
      request: { method: 'GET', path: '/v1/video/{videoId}/share' },
    },
    {
      name: 'videos.list',
      class: 'read',
      description: 'List videos in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max videos to return (server caps at 100).' },
          token: { type: 'string', description: 'Pagination token from a previous response.' },
        },
      },
      request: { method: 'GET', path: '/v1/video.list', query: { limit: '{limit}', token: '{token}' } },
    },
    {
      name: 'avatars.list',
      class: 'read',
      description: 'List avatars available to the workspace (system + custom).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/avatars' },
    },
    {
      name: 'voices.list',
      class: 'read',
      description: 'List voices available to the workspace.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/voices' },
    },
    {
      name: 'videos.translate',
      class: 'mutation',
      description:
        'Submit a video translation job. Returns a video_translate_id; poll videos.translateStatus for completion.',
      parameters: {
        type: 'object',
        properties: {
          videoUrl: {
            type: 'string',
            description: 'URL of the video to translate (direct URL, Google Drive, or YouTube).',
          },
          outputLanguage: { type: 'string', description: 'Target language code (e.g. en, es, fr, ja).' },
          title: { type: 'string', description: 'Title for the translated output.' },
          translateAudioOnly: {
            type: 'boolean',
            description: 'Translate audio without modifying faces.',
          },
          speakerNum: { type: 'integer', description: 'Number of distinct speakers in the source video.' },
          callbackUrl: { type: 'string', description: 'Webhook URL to notify when translation completes.' },
          callbackId: { type: 'string', description: 'Caller-supplied ID echoed in webhook payload.' },
        },
        required: ['videoUrl', 'outputLanguage'],
      },
      request: {
        method: 'POST',
        path: '/v1/video_translate',
        body: {
          video_url: '{videoUrl}',
          output_language: '{outputLanguage}',
          title: '{title}',
          translate_audio_only: '{translateAudioOnly}',
          speaker_num: '{speakerNum}',
          callback_url: '{callbackUrl}',
          callback_id: '{callbackId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assets.upload',
      class: 'mutation',
      description:
        'Register an asset by URL for use in subsequent renders. Multipart binary upload is not exposed here; the JSON body accepts a hosted URL plus the declared content type.',
      parameters: {
        type: 'object',
        properties: {
          fileUrl: {
            type: 'string',
            description: 'Publicly fetchable URL of the asset (JPEG, PNG, MP4, WEBM, or MPEG).',
          },
          contentType: {
            type: 'string',
            description: 'MIME type, e.g. image/png, video/mp4. Required so HeyGen can route the asset to the right pipeline.',
          },
          fileName: { type: 'string', description: 'Optional display name for the asset.' },
        },
        required: ['fileUrl', 'contentType'],
      },
      request: {
        method: 'POST',
        path: '/v1/asset',
        body: {
          file_url: '{fileUrl}',
          content_type: '{contentType}',
          file_name: '{fileName}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
