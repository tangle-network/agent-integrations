import { declarativeRestConnector } from './declarative-rest.js'

/**
 * AltText.ai (https://alttext.ai) generates SEO-friendly, accessible alt text
 * for images using AI vision models. The public REST API is rooted at
 * `https://alttext.ai/api/v1` and authenticated with a personal API key
 * presented as `X-API-Key: <key>` — the same shape Activepieces uses for
 * `@activepieces/piece-alt-text-ai`.
 *
 * Capability surface mirrors the upstream `generateAltTextAction`:
 *   - generateAltTextAction → images.generateAltText
 *
 * The upstream action exposes four input fields:
 *   - image            (required) — URL or base64-encoded image bytes
 *   - keywords         (optional) — phrases to bias the alt text toward
 *   - negativeKeywords (optional) — phrases to exclude from the alt text
 *   - keywordSource    (optional) — free text used to derive keywords
 * which we forward verbatim to POST /images so downstream agents can pass
 * the same field names the Activepieces piece accepts.
 */
export const altTextAiConnector = declarativeRestConnector({
  kind: 'alt-text-ai',
  displayName: 'AltText.ai',
  description:
    'Generate SEO-friendly alt text for images via the AltText.ai vision API.',
  auth: {
    kind: 'api-key',
    hint: 'AltText.ai API key (Account → API Access). Sent as X-API-Key.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://alttext.ai/api/v1',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'images.generateAltText',
      class: 'mutation',
      description:
        'Generate alt text for a single image. Accepts a URL or base64-encoded raw bytes plus optional keyword guidance.',
      parameters: {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            description:
              'Public image URL OR base64-encoded raw image bytes. Required.',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Keywords or phrases the generated alt text should consider including.',
          },
          negativeKeywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Keywords or phrases the generated alt text must not include.',
          },
          keywordSource: {
            type: 'string',
            description:
              'Free-form text used as a source for relevant keywords (e.g. the page body).',
          },
        },
        required: ['image'],
      },
      request: {
        method: 'POST',
        path: '/images',
        body: {
          image: { url: '{image}', raw: '{image}' },
          keywords: '{keywords}',
          negative_keywords: '{negativeKeywords}',
          keyword_source: '{keywordSource}',
        },
      },
      // AltText.ai responds with a stable per-request id; resubmitting the
      // same image+keyword payload yields the same alt text deterministically.
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'images.batchGenerateAltText',
      class: 'mutation',
      description:
        'Generate alt text for a batch of images. Accepts an array of image entries; each entry mirrors the single-image action input.',
      parameters: {
        type: 'object',
        properties: {
          images: {
            type: 'array',
            description:
              'Array of { image, keywords?, negative_keywords?, keyword_source? } entries. Required.',
            items: { type: 'object' },
          },
        },
        required: ['images'],
      },
      request: {
        method: 'POST',
        path: '/images/bulk',
        body: { images: '{images}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'images.deleteResult',
      class: 'mutation',
      description: 'Delete a stored alt-text result by its per-request id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'AltText.ai per-request id returned from generate.' },
        },
        required: ['id'],
      },
      request: {
        method: 'DELETE',
        path: '/images/{id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
