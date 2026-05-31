import { declarativeRestConnector } from './declarative-rest.js'

// Azure OpenAI Service REST API.
//   Auth     : `api-key: <secret>` header (NOT Authorization: Bearer).
//             AAD bearer tokens also work, but the api-key header is the
//             portable shape every Azure OpenAI resource accepts.
//   Endpoint : per-resource — https://<resource-name>.openai.azure.com.
//             The endpoint is metadata; we resolve it from the connection
//             source (`metadata.endpoint`) via declarative-rest's
//             metadataKey baseUrl resolver.
//   Routing  : per-DEPLOYMENT path segments
//             `/openai/deployments/{deployment}/<surface>?api-version=...`.
//             The deployment is whatever the customer named their model
//             binding in the Azure portal; we keep it as a request-time
//             argument so a single connection can fan out across all
//             deployments the api-key is authorized for, per
//             "generalize model requests" / no-hardwired-model rule.
//   Versioning: Azure pins each request with `api-version`. We default to a
//             current GA + stable preview pair (`apiVersion` arg, with a
//             stable GA fallback so callers can omit it).
//   Docs     : https://learn.microsoft.com/azure/ai-services/openai/reference

const AZURE_OPENAI_GA_API_VERSION = '2024-10-21'
const AZURE_OPENAI_PREVIEW_API_VERSION = '2024-10-01-preview'

const chatMessage = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool', 'function', 'developer'] },
    content: {
      oneOf: [
        { type: 'string' },
        {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              text: { type: 'string' },
              image_url: { type: 'object', properties: { url: { type: 'string' } } },
            },
            required: ['type'],
          },
        },
      ],
    },
    name: { type: 'string' },
    tool_call_id: { type: 'string' },
  },
  required: ['role'],
}

const toolDefinition = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['function'] },
    function: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        parameters: { type: 'object' },
      },
      required: ['name'],
    },
  },
  required: ['type', 'function'],
}

export const azureOpenaiConnector = declarativeRestConnector({
  kind: 'azure-openai',
  displayName: 'Azure OpenAI',
  description:
    'Call Azure OpenAI Service deployments (chat completions, completions, embeddings, images, audio) on your tenant-owned resource endpoint with a per-resource api-key.',
  auth: {
    kind: 'api-key',
    hint: 'Azure OpenAI resource key from the Azure Portal (Keys and Endpoint blade). The connection metadata must also carry the per-resource endpoint, e.g. https://<resource>.openai.azure.com.',
  },
  category: 'other',
  // Azure OpenAI is generative — no read-your-writes contract. Use advisory.
  defaultConsistencyModel: 'advisory',
  baseUrl: { metadataKey: 'endpoint' },
  // api-key header per Azure spec; declarative-rest renders `api-key: <apiKey>`.
  credentialPlacement: { kind: 'header', header: 'api-key' },
  // The deployment list endpoint is the canonical reachability probe; it does
  // not require a specific deployment name and validates both endpoint and key.
  test: {
    method: 'GET',
    path: '/openai/deployments',
    query: { 'api-version': AZURE_OPENAI_GA_API_VERSION },
  },
  capabilities: [
    // ─── Deployment + model discovery ─────────────────────────────────
    {
      name: 'deployments.list',
      class: 'read',
      description: 'List deployments (model bindings) on this Azure OpenAI resource.',
      parameters: {
        type: 'object',
        properties: {
          apiVersion: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/openai/deployments',
        query: { 'api-version': `{apiVersion}` },
      },
    },
    {
      name: 'deployments.get',
      class: 'read',
      description: 'Retrieve a single deployment by name.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
        },
        required: ['deployment'],
      },
      request: {
        method: 'GET',
        path: '/openai/deployments/{deployment}',
        query: { 'api-version': `{apiVersion}` },
      },
    },
    {
      name: 'models.list',
      class: 'read',
      description: 'List models available to this Azure OpenAI resource (independent of deployment).',
      parameters: {
        type: 'object',
        properties: {
          apiVersion: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/openai/models',
        query: { 'api-version': `{apiVersion}` },
      },
    },

    // ─── Chat completions ─────────────────────────────────────────────
    // Catalog upstream maps `askGpt` here — but we expose the full chat
    // surface (any role, tools, streaming flag, structured output) so a
    // single connection works against every deployment the key authorizes
    // rather than hard-wiring a "question" prompt template.
    {
      name: 'chat.completions.create',
      class: 'mutation',
      description:
        'Create a chat completion against a named deployment. Mirrors the catalog `askGpt` action with the full Azure chat surface (tools, structured output, vision).',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          messages: { type: 'array', items: chatMessage },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          n: { type: 'integer', minimum: 1 },
          stop: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          max_tokens: { type: 'integer', minimum: 1 },
          max_completion_tokens: { type: 'integer', minimum: 1 },
          presence_penalty: { type: 'number', minimum: -2, maximum: 2 },
          frequency_penalty: { type: 'number', minimum: -2, maximum: 2 },
          logit_bias: { type: 'object' },
          user: { type: 'string' },
          seed: { type: 'integer' },
          response_format: { type: 'object' },
          tools: { type: 'array', items: toolDefinition },
          tool_choice: { oneOf: [{ type: 'string' }, { type: 'object' }] },
          parallel_tool_calls: { type: 'boolean' },
          stream: { type: 'boolean', const: false },
        },
        required: ['deployment', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/chat/completions',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Legacy completions (still served for fine-tuned + older deployments) ──
    {
      name: 'completions.create',
      class: 'mutation',
      description:
        'Create a non-chat completion against a named deployment. Useful for fine-tuned base-model deployments and legacy text-completion workflows.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          prompt: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          max_tokens: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          n: { type: 'integer', minimum: 1 },
          stop: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          presence_penalty: { type: 'number', minimum: -2, maximum: 2 },
          frequency_penalty: { type: 'number', minimum: -2, maximum: 2 },
          logit_bias: { type: 'object' },
          user: { type: 'string' },
          seed: { type: 'integer' },
          stream: { type: 'boolean', const: false },
        },
        required: ['deployment', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/completions',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Embeddings ───────────────────────────────────────────────────
    {
      name: 'embeddings.create',
      class: 'mutation',
      description: 'Generate embedding vectors for the given input(s) against an embeddings deployment.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          input: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
            ],
          },
          encoding_format: { type: 'string', enum: ['float', 'base64'] },
          dimensions: { type: 'integer', minimum: 1 },
          user: { type: 'string' },
        },
        required: ['deployment', 'input'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/embeddings',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Images ───────────────────────────────────────────────────────
    {
      name: 'images.generate',
      class: 'mutation',
      description: 'Generate an image from a prompt against a DALL·E / gpt-image deployment.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          prompt: { type: 'string' },
          n: { type: 'integer', minimum: 1, maximum: 10 },
          size: { type: 'string' },
          quality: { type: 'string' },
          style: { type: 'string' },
          response_format: { type: 'string', enum: ['url', 'b64_json'] },
          user: { type: 'string' },
        },
        required: ['deployment', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/images/generations',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Audio ────────────────────────────────────────────────────────
    {
      name: 'audio.transcriptions.create',
      class: 'mutation',
      description: 'Transcribe audio (whisper-style) against a transcription deployment.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          file: { type: 'string', description: 'Base64-encoded audio payload or upload reference.' },
          prompt: { type: 'string' },
          response_format: { type: 'string', enum: ['json', 'text', 'srt', 'verbose_json', 'vtt'] },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
          language: { type: 'string' },
        },
        required: ['deployment', 'file'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/audio/transcriptions',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'audio.translations.create',
      class: 'mutation',
      description: 'Translate audio to English against a transcription deployment.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          file: { type: 'string' },
          prompt: { type: 'string' },
          response_format: { type: 'string', enum: ['json', 'text', 'srt', 'verbose_json', 'vtt'] },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['deployment', 'file'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/audio/translations',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'audio.speech.create',
      class: 'mutation',
      description: 'Synthesize speech audio from text against a text-to-speech deployment.',
      parameters: {
        type: 'object',
        properties: {
          deployment: { type: 'string' },
          apiVersion: { type: 'string' },
          input: { type: 'string' },
          voice: { type: 'string' },
          response_format: { type: 'string', enum: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] },
          speed: { type: 'number', minimum: 0.25, maximum: 4 },
        },
        required: ['deployment', 'input', 'voice'],
      },
      request: {
        method: 'POST',
        path: '/openai/deployments/{deployment}/audio/speech',
        query: { 'api-version': `{apiVersion}` },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
  ],
})

// Exported so tests and downstream tooling can pin the GA / preview defaults.
export const AZURE_OPENAI_DEFAULT_API_VERSIONS = {
  ga: AZURE_OPENAI_GA_API_VERSION,
  preview: AZURE_OPENAI_PREVIEW_API_VERSION,
}
