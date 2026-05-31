import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ModelsLab generative-media connector.
 *
 * Authentication: workspace API key. ModelsLab's documented contract is to
 * pass the key as a `key` field inside the JSON body; the V6 API also honours
 * `Authorization: Bearer <key>` on the same routes, which is the form the
 * declarative-rest engine can express. Callers that hit a route lacking
 * bearer support must pass `key` explicitly inside args until the engine
 * grows a body-credential placement.
 *
 * Capability surface mirrors the activepieces actions list one-for-one
 * (currently a single `text.to.image` action). The route covered is
 * `POST /api/v6/realtime/text2img` — the realtime variant runs synchronously
 * and returns image URLs in the same response, which fits the
 * declarative-rest one-shot request model. Async / queued endpoints
 * (`fetch_queued_response`) belong in a follow-on bespoke adapter once
 * polling is wired through the engine.
 */

export const modelslabConnector = declarativeRestConnector({
  kind: 'modelslab',
  displayName: 'ModelsLab',
  description:
    'Developer-first generative-media API — synchronous text-to-image generation via the realtime endpoint, returning hosted image URLs.',
  auth: {
    kind: 'api-key',
    hint: 'ModelsLab API key (generated at modelslab.com → Dashboard → API Keys). Sent as Authorization: Bearer.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://modelslab.com',
  // Mirror the documented body-key contract via the bearer header. The
  // engine cannot inject credentials into a JSON body, and ModelsLab accepts
  // bearer on all V6 realtime routes.
  credentialPlacement: { kind: 'bearer' },
  capabilities: [
    {
      name: 'text.to.image',
      class: 'mutation',
      description:
        'Generate one or more images from a text prompt using ModelsLab Realtime. Returns hosted output URLs synchronously when the model is warm; falls back to a queued status payload when capacity is constrained.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt describing the desired image.',
          },
          negative_prompt: {
            type: 'string',
            description: 'Concepts, styles, or artefacts to exclude from the output.',
          },
          model_id: {
            type: 'string',
            description:
              'ModelsLab model identifier (e.g. sdxl, midjourney, realtime-v2). Defaults to the workspace-configured realtime model when omitted.',
          },
          width: {
            type: 'integer',
            minimum: 256,
            maximum: 1024,
            description: 'Output width in pixels. Must be divisible by 8.',
          },
          height: {
            type: 'integer',
            minimum: 256,
            maximum: 1024,
            description: 'Output height in pixels. Must be divisible by 8.',
          },
          num_inference_steps: {
            type: 'integer',
            minimum: 20,
            maximum: 50,
            description: 'Denoising steps. Higher values trade latency for fidelity.',
          },
          guidance_scale: {
            type: 'number',
            minimum: 1,
            maximum: 20,
            description: 'Classifier-free guidance scale — how strictly the model follows the prompt.',
          },
          samples: {
            type: 'integer',
            minimum: 1,
            maximum: 4,
            description: 'Number of independent images to return in a single response.',
          },
          seed: {
            type: 'integer',
            description: 'Deterministic seed for reproducibility. Pass -1 to randomise (the ModelsLab default).',
          },
          safety_checker: {
            type: 'boolean',
            description: 'Enable the upstream NSFW safety filter. Defaults to true server-side.',
          },
          enhance_prompt: {
            type: 'boolean',
            description: 'Let ModelsLab rewrite the prompt for better prompt-fidelity before generation.',
          },
          webhook: {
            type: 'string',
            description: 'Optional callback URL — ModelsLab POSTs the completed payload here if the request goes async.',
          },
          track_id: {
            type: 'string',
            description: 'Caller-supplied correlation id echoed back in webhook callbacks.',
          },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/api/v6/realtime/text2img',
        body: 'args',
      },
      // Generative inference is not idempotent — replaying the same prompt
      // yields a new sample (modulo a fixed seed, which the caller owns).
      // ModelsLab does not honour an idempotency key on /text2img.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
