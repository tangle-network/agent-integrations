import { declarativeRestConnector } from './declarative-rest.js'

// OpenAI Platform REST API.
//   Auth     : Bearer <secret-key> on api.openai.com
//             Keys come from https://platform.openai.com/api-keys
//             Project-scoped keys (sk-proj-...) and legacy user keys
//             (sk-...) both work; the credential is opaque to us.
//   Docs     : https://platform.openai.com/docs/api-reference
//   Versioning: REST surface is unversioned; the wire shape is stable
//             enough that the request specs below do not need a /v1
//             rev gate, but we do route every path through /v1/* per
//             the published reference.

const chatMessage = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool', 'developer'] },
    content: {
      // Either a flat string OR the multi-part content array (text + image_url + input_audio).
      // We accept both shapes; OpenAI server-side does the discrimination.
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
        strict: { type: 'boolean' },
      },
      required: ['name'],
    },
  },
  required: ['type', 'function'],
}

export const openaiConnector = declarativeRestConnector({
  kind: 'openai',
  displayName: 'OpenAI',
  description:
    'Call OpenAI Platform APIs (chat/completions, responses, embeddings, images, audio, files, fine-tuning) with a project-scoped secret key.',
  auth: {
    kind: 'api-key',
    hint: 'OpenAI secret key (sk-proj-... or sk-...) from https://platform.openai.com/api-keys. Prefer a project-scoped key restricted to the workloads you intend to authorize.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.openai.com',
  // Bearer placement — declarative-rest renders `Authorization: Bearer <apiKey>`.
  credentialPlacement: { kind: 'bearer' },
  // GET /v1/models is the canonical reachability probe — it always returns the
  // model list for the key's project; no extra scope required.
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    // ─── Models ────────────────────────────────────────────────────────
    {
      name: 'models.list',
      class: 'read',
      description: 'List models available to the authenticated project.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/models' },
    },
    {
      name: 'models.get',
      class: 'read',
      description: 'Retrieve a single model by id.',
      parameters: {
        type: 'object',
        properties: { model: { type: 'string' } },
        required: ['model'],
      },
      request: { method: 'GET', path: '/v1/models/{model}' },
    },

    // ─── Chat completions (legacy but still primary) ──────────────────
    {
      name: 'chat.completions.create',
      class: 'mutation',
      description:
        'Create a chat completion. Set stream=false; the platform SDK is non-streaming. Use responses.create for the modern Responses API.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          messages: { type: 'array', items: chatMessage },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          max_tokens: { type: 'integer', minimum: 1 },
          max_completion_tokens: { type: 'integer', minimum: 1 },
          n: { type: 'integer', minimum: 1 },
          stop: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          presence_penalty: { type: 'number' },
          frequency_penalty: { type: 'number' },
          seed: { type: 'integer' },
          response_format: { type: 'object' },
          tools: { type: 'array', items: toolDefinition },
          tool_choice: { oneOf: [{ type: 'string' }, { type: 'object' }] },
          parallel_tool_calls: { type: 'boolean' },
          user: { type: 'string' },
          stream: { type: 'boolean', const: false },
          reasoning_effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high'] },
        },
        required: ['model', 'messages'],
      },
      request: { method: 'POST', path: '/v1/chat/completions', body: 'args' },
      // Each POST is server-side stateless; replay yields a fresh sampling.
      // 'native-idempotency' here means "the platform treats each call as new" —
      // dedup must happen at the caller's MutationGuard layer.
      cas: 'native-idempotency',
    },

    // ─── Responses API (modern surface) ───────────────────────────────
    {
      name: 'responses.create',
      class: 'mutation',
      description:
        'Create a response via the modern Responses API. Supports text+vision input, hosted tools (web_search, file_search, code_interpreter, computer_use), and structured output.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'object' } },
            ],
          },
          instructions: { type: 'string' },
          previous_response_id: { type: 'string' },
          tools: { type: 'array', items: { type: 'object' } },
          tool_choice: { oneOf: [{ type: 'string' }, { type: 'object' }] },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          max_output_tokens: { type: 'integer', minimum: 1 },
          metadata: { type: 'object' },
          store: { type: 'boolean' },
          reasoning: { type: 'object' },
          text: { type: 'object' },
          parallel_tool_calls: { type: 'boolean' },
          stream: { type: 'boolean', const: false },
          user: { type: 'string' },
        },
        required: ['model', 'input'],
      },
      request: { method: 'POST', path: '/v1/responses', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'responses.get',
      class: 'read',
      description: 'Retrieve a previously created Response by id.',
      parameters: {
        type: 'object',
        properties: { responseId: { type: 'string' } },
        required: ['responseId'],
      },
      request: { method: 'GET', path: '/v1/responses/{responseId}' },
    },
    {
      name: 'responses.delete',
      class: 'mutation',
      description: 'Delete a stored Response (only valid when the original was stored).',
      parameters: {
        type: 'object',
        properties: { responseId: { type: 'string' } },
        required: ['responseId'],
      },
      request: { method: 'DELETE', path: '/v1/responses/{responseId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'responses.cancel',
      class: 'mutation',
      description: 'Cancel an in-flight background Response.',
      parameters: {
        type: 'object',
        properties: { responseId: { type: 'string' } },
        required: ['responseId'],
      },
      request: { method: 'POST', path: '/v1/responses/{responseId}/cancel' },
      cas: 'native-idempotency',
    },

    // ─── Embeddings ───────────────────────────────────────────────────
    {
      name: 'embeddings.create',
      class: 'mutation',
      description: 'Create an embedding vector for the given input(s).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
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
        required: ['model', 'input'],
      },
      request: { method: 'POST', path: '/v1/embeddings', body: 'args' },
      cas: 'native-idempotency',
    },

    // ─── Images ───────────────────────────────────────────────────────
    {
      name: 'images.generate',
      class: 'mutation',
      description: 'Generate an image from a prompt (DALL·E / gpt-image-1).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: { type: 'string' },
          n: { type: 'integer', minimum: 1, maximum: 10 },
          size: { type: 'string' },
          quality: { type: 'string' },
          style: { type: 'string' },
          response_format: { type: 'string', enum: ['url', 'b64_json'] },
          user: { type: 'string' },
        },
        required: ['prompt'],
      },
      request: { method: 'POST', path: '/v1/images/generations', body: 'args' },
      cas: 'native-idempotency',
    },

    // ─── Audio ────────────────────────────────────────────────────────
    {
      name: 'audio.speech.create',
      class: 'mutation',
      description: 'Synthesize speech audio from text (tts-1, tts-1-hd, gpt-4o-mini-tts).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: { type: 'string' },
          voice: { type: 'string' },
          response_format: { type: 'string', enum: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] },
          speed: { type: 'number', minimum: 0.25, maximum: 4 },
          instructions: { type: 'string' },
        },
        required: ['model', 'input', 'voice'],
      },
      request: { method: 'POST', path: '/v1/audio/speech', body: 'args' },
      cas: 'native-idempotency',
    },

    // ─── Moderations ──────────────────────────────────────────────────
    {
      name: 'moderations.create',
      class: 'mutation',
      description: 'Classify content against OpenAI usage policies.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
        },
        required: ['input'],
      },
      request: { method: 'POST', path: '/v1/moderations', body: 'args' },
      cas: 'native-idempotency',
    },

    // ─── Files ────────────────────────────────────────────────────────
    {
      name: 'files.list',
      class: 'read',
      description: 'List files uploaded to the project (fine-tuning, batch, vector store, etc.).',
      parameters: {
        type: 'object',
        properties: {
          purpose: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10000 },
          order: { type: 'string', enum: ['asc', 'desc'] },
          after: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/files',
        query: {
          purpose: '{purpose}',
          limit: '{limit}',
          order: '{order}',
          after: '{after}',
        },
      },
    },
    {
      name: 'files.get',
      class: 'read',
      description: 'Retrieve a file metadata record by id.',
      parameters: {
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      },
      request: { method: 'GET', path: '/v1/files/{fileId}' },
    },
    {
      name: 'files.delete',
      class: 'mutation',
      description: 'Delete an uploaded file.',
      parameters: {
        type: 'object',
        properties: { fileId: { type: 'string' } },
        required: ['fileId'],
      },
      request: { method: 'DELETE', path: '/v1/files/{fileId}' },
      cas: 'native-idempotency',
    },

    // ─── Fine-tuning ──────────────────────────────────────────────────
    {
      name: 'fineTuning.jobs.list',
      class: 'read',
      description: 'List fine-tuning jobs for the project.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          after: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/fine_tuning/jobs',
        query: { limit: '{limit}', after: '{after}' },
      },
    },
    {
      name: 'fineTuning.jobs.get',
      class: 'read',
      description: 'Retrieve a fine-tuning job by id.',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
      request: { method: 'GET', path: '/v1/fine_tuning/jobs/{jobId}' },
    },
    {
      name: 'fineTuning.jobs.create',
      class: 'mutation',
      description: 'Start a fine-tuning job from a previously uploaded training file.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          training_file: { type: 'string' },
          validation_file: { type: 'string' },
          suffix: { type: 'string' },
          method: { type: 'object' },
          hyperparameters: { type: 'object' },
          integrations: { type: 'array', items: { type: 'object' } },
          seed: { type: 'integer' },
        },
        required: ['model', 'training_file'],
      },
      request: { method: 'POST', path: '/v1/fine_tuning/jobs', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'fineTuning.jobs.cancel',
      class: 'mutation',
      description: 'Cancel a running fine-tuning job.',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
      request: { method: 'POST', path: '/v1/fine_tuning/jobs/{jobId}/cancel' },
      cas: 'native-idempotency',
    },

    // ─── Batch ────────────────────────────────────────────────────────
    {
      name: 'batches.create',
      class: 'mutation',
      description: 'Submit a batch job over an uploaded JSONL input file.',
      parameters: {
        type: 'object',
        properties: {
          input_file_id: { type: 'string' },
          endpoint: { type: 'string' },
          completion_window: { type: 'string', enum: ['24h'] },
          metadata: { type: 'object' },
        },
        required: ['input_file_id', 'endpoint', 'completion_window'],
      },
      request: { method: 'POST', path: '/v1/batches', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'batches.get',
      class: 'read',
      description: 'Retrieve a batch job by id.',
      parameters: {
        type: 'object',
        properties: { batchId: { type: 'string' } },
        required: ['batchId'],
      },
      request: { method: 'GET', path: '/v1/batches/{batchId}' },
    },
    {
      name: 'batches.list',
      class: 'read',
      description: 'List batch jobs for the project.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          after: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/batches',
        query: { limit: '{limit}', after: '{after}' },
      },
    },
    {
      name: 'batches.cancel',
      class: 'mutation',
      description: 'Cancel an in-flight batch job.',
      parameters: {
        type: 'object',
        properties: { batchId: { type: 'string' } },
        required: ['batchId'],
      },
      request: { method: 'POST', path: '/v1/batches/{batchId}/cancel' },
      cas: 'native-idempotency',
    },
  ],
})
