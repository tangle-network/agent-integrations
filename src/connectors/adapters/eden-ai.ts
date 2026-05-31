import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Eden AI connector.
 *
 * Eden AI is an aggregator API that proxies a uniform request shape to many
 * underlying providers (OpenAI, Cohere, Google, AWS, Microsoft, etc.). Each
 * endpoint accepts a `providers` field whose value is a comma-separated list
 * of provider keys; the first entry is the primary and any following entries
 * are fallbacks tried in order.
 *
 * Auth: workspace API key sent as a Bearer token on the Authorization header.
 * Eden does not expose an OAuth surface; the only credential is the key
 * minted from the dashboard at https://app.edenai.run/admin/api-settings.
 *
 * Consistency model: `advisory`. Every action mutates state on third-party
 * provider backends (text generated, audio synthesized, OCR billed) and Eden
 * does not honour an idempotency key on the aggregation endpoints, so replay
 * yields a fresh charge and a fresh sample. Callers own dedupe.
 */
export const edenAiConnector = declarativeRestConnector({
  kind: 'eden-ai',
  displayName: 'Eden AI',
  description:
    'Call Eden AI aggregated endpoints (text generation, language detection, OCR, translation, TTS, image generation, document parsing) across a configurable provider list.',
  auth: {
    kind: 'api-key',
    hint: 'Eden AI workspace API key. Mint one at https://app.edenai.run/admin/api-settings/features-preferences and send as a Bearer token.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.edenai.run/v2',
  // Bearer is the declarative-rest default but make it explicit so a future
  // edit cannot silently flip the credential placement.
  credentialPlacement: { kind: 'bearer' },
  // Cheapest authenticated probe: the public info endpoint listing providers
  // requires no body and validates the bearer token.
  test: { method: 'GET', path: '/info/provider_subfeatures' },
  capabilities: [
    {
      name: 'generate.text',
      class: 'mutation',
      description:
        'Generate text from a prompt by routing to one or more LLM providers. `providers` is a comma-separated list; later entries are fallbacks.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string', description: 'Primary provider key, optionally followed by fallback keys (e.g. "openai,cohere").' },
          text: { type: 'string', description: 'The prompt or instruction to generate from.' },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          max_tokens: { type: 'integer', minimum: 1 },
          model: { type: 'string', description: 'Provider-specific model id (e.g. "openai/gpt-4o").' },
          fallback_providers: { type: 'string', description: 'Comma-separated fallback providers (alternative to listing them in providers).' },
          show_original_response: { type: 'boolean' },
          settings: { type: 'object', description: 'Per-provider settings overrides keyed by provider name.' },
        },
        required: ['providers', 'text'],
      },
      request: { method: 'POST', path: '/text/generation', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'summarize.text',
      class: 'mutation',
      description: 'Summarize a passage of text. Output length is controlled by `output_sentences`.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string', description: 'ISO 639-1 language code (e.g. "en").' },
          output_sentences: { type: 'integer', minimum: 1, maximum: 20 },
          model: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text'],
      },
      request: { method: 'POST', path: '/text/summarize', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'extract.keywords',
      class: 'mutation',
      description: 'Extract weighted keywords from text.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text'],
      },
      request: { method: 'POST', path: '/text/keyword_extraction', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'detect.language',
      class: 'mutation',
      description: 'Detect the language of an input text. Returns ISO 639-1 codes plus confidence per provider.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text'],
      },
      request: { method: 'POST', path: '/text/language_detection', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'extract.entities',
      class: 'mutation',
      description: 'Run named-entity recognition on a passage of text.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text'],
      },
      request: { method: 'POST', path: '/text/named_entity_recognition', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'moderate.text',
      class: 'mutation',
      description: 'Run content-moderation scoring (toxicity, hate, sexual, etc.) on input text.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text'],
      },
      request: { method: 'POST', path: '/text/moderation', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'spell.check',
      class: 'mutation',
      description: 'Run a spelling/grammar correction pass on input text.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text', 'language'],
      },
      request: { method: 'POST', path: '/text/spell_check', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'translate.text',
      class: 'mutation',
      description: 'Translate text between languages. `source_language` may be omitted to auto-detect.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          source_language: { type: 'string', description: 'ISO 639-1 code or "auto" to detect.' },
          target_language: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text', 'target_language'],
      },
      request: { method: 'POST', path: '/translation/automatic_translation', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'invoice.parser',
      class: 'mutation',
      description:
        'Parse a financial invoice document. Accepts a public `file_url` (the declarative engine JSON-encodes bodies, so binary uploads use a bespoke path).',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          file_url: { type: 'string', description: 'Public URL to the invoice file (PDF or image).' },
          language: { type: 'string' },
          file_password: { type: 'string' },
          convert_to_pdf: { type: 'boolean' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'file_url'],
      },
      request: { method: 'POST', path: '/ocr/invoice_parser', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'receipt.parser',
      class: 'mutation',
      description: 'Parse a receipt document via URL. Same constraints as invoice.parser.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          file_url: { type: 'string' },
          language: { type: 'string' },
          file_password: { type: 'string' },
          convert_to_pdf: { type: 'boolean' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'file_url'],
      },
      request: { method: 'POST', path: '/ocr/receipt_parser', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'ocr.image',
      class: 'mutation',
      description: 'Run OCR (text extraction) on an image or scanned document referenced by URL.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          file_url: { type: 'string' },
          language: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'file_url'],
      },
      request: { method: 'POST', path: '/ocr/ocr', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'image.generation',
      class: 'mutation',
      description: 'Generate one or more images from a text prompt at a fixed resolution.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string', description: 'The image-generation prompt.' },
          resolution: { type: 'string', description: 'Image resolution, e.g. "512x512" or "1024x1024".' },
          num_images: { type: 'integer', minimum: 1, maximum: 10 },
          model: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text', 'resolution'],
      },
      request: { method: 'POST', path: '/image/generation', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'text.to.speech',
      class: 'mutation',
      description: 'Synthesize speech audio from text. `option` selects voice gender ("MALE" | "FEMALE").',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'string' },
          text: { type: 'string' },
          language: { type: 'string' },
          option: { type: 'string', description: 'Voice gender: "MALE" or "FEMALE".' },
          rate: { type: 'integer', minimum: -100, maximum: 100 },
          pitch: { type: 'integer', minimum: -100, maximum: 100 },
          volume: { type: 'integer', minimum: -100, maximum: 100 },
          audio_format: { type: 'string', description: 'Container format (e.g. "mp3", "wav").' },
          sampling_rate: { type: 'integer', minimum: 0, maximum: 200000 },
          model: { type: 'string' },
          fallback_providers: { type: 'string' },
          show_original_response: { type: 'boolean' },
        },
        required: ['providers', 'text', 'language'],
      },
      request: { method: 'POST', path: '/audio/text_to_speech', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
