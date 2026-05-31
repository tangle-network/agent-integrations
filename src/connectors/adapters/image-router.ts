import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ImageRouter connector.
 *
 * ImageRouter is a model-routing API that exposes many third-party image
 * generation and image-edit models behind a single OpenAI-compatible surface.
 * Authentication is a workspace API key delivered via the `Authorization:
 * Bearer` header — the activepieces piece declares `auth: "api_key"`, and the
 * upstream `/v1/openai/*` endpoints reject non-Bearer placements, so api-key
 * with bearer placement is the only honest wiring.
 *
 * Endpoint surface mirrors the OpenAI Images API: `POST /v1/openai/images/generations`
 * for text->image (`createImage`) and `POST /v1/openai/images/edits` for
 * image->image (`imageToImage`). Both return a JSON envelope with a `data[]`
 * array of `{ url }` or `{ b64_json }` objects depending on `response_format`.
 *
 * Mutation semantics: image generation is non-idempotent — re-submitting the
 * same prompt produces a fresh render and burns credits. We declare
 * `cas: 'native-idempotency'` so the orchestrator supplies an idempotency
 * token; ImageRouter itself does not deduplicate. `externalEffect: true`
 * because successful calls consume billable model credits even when the
 * caller drops the response.
 *
 * The activepieces piece declares only write actions (no triggers, no reads);
 * we additionally expose `models.list` because it is the canonical
 * authenticated probe (cheap, no credit consumption) and the agent needs a
 * concrete model id to populate `createImage.model`.
 */
export const imageRouterConnector = declarativeRestConnector({
  kind: 'image-router',
  displayName: 'ImageRouter',
  description:
    'Generate images with any model available on ImageRouter — text-to-image and image-to-image edits via an OpenAI-compatible API surface.',
  auth: {
    kind: 'api-key',
    hint: 'ImageRouter API key. Create one at https://imagerouter.io under Account > API Keys.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.imagerouter.io',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  // GET /v1/openai/models is the cheapest authenticated probe — lists routable
  // models and does not consume image-generation credits.
  test: { method: 'GET', path: '/v1/openai/models' },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description:
        'List image generation and edit models routable through ImageRouter. Use the returned `id` values to populate createImage.model / imageToImage.model.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/openai/models' },
    },
    {
      name: 'createImage',
      class: 'mutation',
      description:
        'Generate one or more images from a text prompt. Returns a JSON envelope with `data[]` containing `url` (when response_format=url, default) or `b64_json` (when response_format=b64_json).',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt describing the image you want to generate.',
          },
          model: {
            type: 'string',
            description:
              'Routable model id (see models.list). Examples: "openai/dall-e-3", "stabilityai/sdxl-turbo".',
          },
          n: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'Number of images to generate. Not all models honor n>1.',
          },
          quality: {
            type: 'string',
            description: 'Image quality hint (e.g. "standard", "hd"). Not all models support this.',
          },
          size: {
            type: 'string',
            description: 'Image size in `WxH` form (e.g. "1024x1024"). Model-dependent allowed values.',
          },
          responseFormat: {
            type: 'string',
            enum: ['url', 'b64_json'],
            description: 'How to receive the generated image: hosted URL or inline base64.',
          },
          user: {
            type: 'string',
            description: 'End-user identifier forwarded to the upstream model for abuse tracking.',
          },
        },
        required: ['prompt', 'model'],
      },
      request: {
        method: 'POST',
        path: '/v1/openai/images/generations',
        body: {
          prompt: '{prompt}',
          model: '{model}',
          n: '{n}',
          quality: '{quality}',
          size: '{size}',
          response_format: '{responseFormat}',
          user: '{user}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'imageToImage',
      class: 'mutation',
      description:
        'Edit or transform an input image (optionally with one or more mask images) using a prompt. Returns the same `data[]` envelope as createImage.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt describing the desired edit / transformation.',
          },
          model: {
            type: 'string',
            description: 'Routable model id supporting image edit (see models.list).',
          },
          image: {
            type: 'string',
            description:
              'Input image as a publicly-fetchable URL, a `data:image/...;base64,...` URI, or a hosted asset id the model can resolve.',
          },
          images: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Up to 16 additional input images (URLs or data: URIs) for multi-image edit models that accept a reference set.',
          },
          mask: {
            type: 'string',
            description:
              'Optional single mask image. White pixels are the editable region; black pixels are preserved.',
          },
          masks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of mask images, one per entry in `images`.',
          },
          n: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: 'Number of edited images to generate.',
          },
          size: {
            type: 'string',
            description: 'Output image size in `WxH` form (model-dependent allowed values).',
          },
          responseFormat: {
            type: 'string',
            enum: ['url', 'b64_json'],
            description: 'How to receive the edited image: hosted URL or inline base64.',
          },
          user: {
            type: 'string',
            description: 'End-user identifier forwarded to the upstream model for abuse tracking.',
          },
        },
        required: ['prompt', 'model', 'image'],
      },
      request: {
        method: 'POST',
        path: '/v1/openai/images/edits',
        body: {
          prompt: '{prompt}',
          model: '{model}',
          image: '{image}',
          images: '{images}',
          mask: '{mask}',
          masks: '{masks}',
          n: '{n}',
          size: '{size}',
          response_format: '{responseFormat}',
          user: '{user}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
