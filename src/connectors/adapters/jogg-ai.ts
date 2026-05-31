import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Jogg AI — AI-generated avatar video and product-content platform.
 *
 * Authentication: workspace API key delivered in the `x-api-key` header.
 *
 * The v1 surface covers four resource families:
 *   - avatars / photos        (avatar.photo.create, avatar.video.create)
 *   - product knowledge       (product.create.from_url, product.create.from_info, product.update)
 *   - generated-video polling (video.get)
 *   - media + template-driven video (media.upload, video.create.from_template)
 *
 * Video generation is asynchronous: the create.* mutations return a
 * `video_id`; the caller polls `video.get` until status === completed.
 * The webhook-style triggers (video.generated.successfully /
 * video.generation.failed) are catalogued but not modelled here — the
 * declarative-REST shape only carries request/response capabilities; webhook
 * delivery is wired in the connector runtime layer.
 */
export const joggAiConnector = declarativeRestConnector({
  kind: 'jogg-ai',
  displayName: 'Jogg AI',
  description:
    'Generate AI avatar photos and videos, manage product knowledge, upload media, and poll video generation status against the Jogg AI v1 API.',
  auth: {
    kind: 'api-key',
    hint: 'Jogg AI workspace API key — Settings → API Keys in the Jogg AI dashboard.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.jogg.ai',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: { 'content-type': 'application/json' },
  capabilities: [
    {
      name: 'avatar.photo.create',
      class: 'mutation',
      description:
        'Generate a still AI-avatar photo. Returns the generated photo URL plus an id usable as an avatar source in avatar.video.create.',
      parameters: {
        type: 'object',
        properties: {
          age: {
            type: 'string',
            description: 'Age group for the avatar (e.g. Young Adult, Adult, Senior).',
          },
          gender: {
            type: 'string',
            description: 'Gender for the avatar.',
          },
          ethnicity: {
            type: 'string',
            description: 'Ethnicity for the avatar.',
          },
          model: {
            type: 'string',
            description: 'Jogg AI image model identifier.',
          },
          avatar_style: {
            type: 'string',
            description: 'Visual style of the avatar.',
          },
          aspect_ratio: {
            type: 'string',
            description: 'Output photo aspect ratio (e.g. 9:16, 16:9, 1:1).',
          },
          appearance: {
            type: 'string',
            description: 'Free-text appearance prompt.',
          },
          background: {
            type: 'string',
            description: 'Free-text background prompt.',
          },
          image_url: {
            type: 'string',
            description: 'Optional reference-image URL the generator should match.',
          },
        },
        required: ['age', 'gender', 'model', 'avatar_style', 'aspect_ratio'],
      },
      request: {
        method: 'POST',
        path: '/v1/create_ai_avatar_photo',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'avatar.video.create',
      class: 'mutation',
      description:
        'Queue an avatar video render. Returns a video_id; poll video.get until status is completed.',
      parameters: {
        type: 'object',
        properties: {
          avatar_id: {
            type: 'string',
            description: 'Identifier of the avatar to speak the script.',
          },
          avatar_type: {
            type: 'string',
            description: 'Source type of the avatar (e.g. preset, custom, photo).',
          },
          voice_id: {
            type: 'string',
            description: 'Identifier of the voice to use.',
          },
          aspect_ratio: { type: 'string' },
          screen_style: {
            type: 'string',
            description: 'Background style for the rendered scene.',
          },
          script: {
            type: 'string',
            description: 'Script the avatar will speak. Provide either script or audio_url.',
          },
          audio_url: {
            type: 'string',
            description: 'Pre-recorded audio URL the avatar should lip-sync to. Provide either script or audio_url.',
          },
          caption: {
            type: 'boolean',
            description: 'Render burned-in subtitles.',
          },
          video_name: { type: 'string' },
        },
        required: ['avatar_id', 'avatar_type', 'voice_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/create_avatar_video',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'product.create.from_url',
      class: 'mutation',
      description:
        'Crawl a product URL and create a Jogg AI product entry from the extracted information.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Public product page URL to crawl.',
          },
          name: { type: 'string', description: 'Optional override for the product name.' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/v1/product/create_by_url',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'product.create.from_info',
      class: 'mutation',
      description: 'Create a Jogg AI product entry from a structured info payload.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: {
            type: 'string',
            description: 'Product introduction and selling points.',
          },
          target_audience: { type: 'string' },
          media: {
            type: 'object',
            description: 'Media resources to associate with the product.',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v1/product/create',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'product.update',
      class: 'mutation',
      description: 'Update an existing Jogg AI product entry.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'Jogg AI product identifier.' },
          name: { type: 'string' },
          description: { type: 'string' },
          target_audience: { type: 'string' },
          media: { type: 'object' },
        },
        required: ['product_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/product/update',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'video.get',
      class: 'read',
      description:
        'Fetch the status and output of a previously-queued video render. Returns status, URL when ready, and any error detail.',
      parameters: {
        type: 'object',
        properties: {
          video_id: { type: 'string', description: 'Identifier returned by avatar.video.create or video.create.from_template.' },
        },
        required: ['video_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/video/{video_id}',
      },
    },
    {
      name: 'media.upload',
      class: 'mutation',
      description:
        'Register a media asset (by URL) with Jogg AI so it can be referenced from products, templates, or avatar videos.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Media type (e.g. image, video, audio).',
          },
          url: {
            type: 'string',
            description: 'Publicly fetchable source URL for the media asset.',
          },
        },
        required: ['type', 'url'],
      },
      request: {
        method: 'POST',
        path: '/v1/upload',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'video.create.from_template',
      class: 'mutation',
      description:
        'Queue a video render driven by a Jogg AI template. Returns a video_id; poll video.get until ready.',
      parameters: {
        type: 'object',
        properties: {
          template_type: {
            type: 'string',
            description: 'Template source type (e.g. system, custom).',
          },
          template_id: {
            type: 'string',
            description: 'Identifier of the template to render.',
          },
          avatar_id: { type: 'string' },
          voice_id: { type: 'string' },
          script: { type: 'string' },
          audio_url: { type: 'string' },
          caption: { type: 'boolean' },
          video_name: { type: 'string' },
        },
        required: ['template_type', 'template_id'],
      },
      request: {
        method: 'POST',
        path: '/v1/create_video_from_template',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
