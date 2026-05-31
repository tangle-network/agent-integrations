import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google Gemini — Generative Language API (v1beta).
 *
 * The public API at `generativelanguage.googleapis.com` accepts a Google AI
 * Studio API key passed as the `?key=` query parameter. (Cloud-billed Vertex
 * AI traffic uses a different host + OAuth2; that flow belongs in a separate
 * connector because the request/response shapes diverge.)
 *
 * Endpoints follow Google's `:method` action-style URLs — e.g.
 * `/v1beta/models/{model}:generateContent`. We model the colon segment as a
 * literal in the path because `declarativeRestConnector` interpolates only
 * `{name}` template segments.
 *
 * Capability surface chosen for agent-driven use:
 *   - models.list / models.get  — discover what's available to the key.
 *   - models.generateContent     — single-turn or multi-turn generation.
 *   - models.streamGenerateContent — long-form streaming (returns SSE; we
 *                                     surface the raw JSON array Google emits).
 *   - models.countTokens         — pre-flight cost estimation.
 *   - models.embedContent / batchEmbedContents — embeddings for retrieval.
 *   - files.list / files.get / files.delete — File API (uploaded media that
 *                                              `generateContent` can reference).
 *   - cachedContents.{list,get,create,delete} — Context caching (cheaper
 *                                                  repeated-prefix inference).
 *
 * Generation is a read in the consistency sense — it has no upstream mutation
 * — but classifying it as `class: 'read'` would tell the agent runtime it
 * has no external effect, which is wrong (it bills the customer). We model
 * generation as a mutation with `cas: 'none'` + `externalEffect: true`. The
 * connector defaults to `cache` consistency: Gemini outputs are not a source
 * of truth, callers re-call to get fresh tokens.
 *
 * Credentials shape: the runtime supplies `{ kind: 'api-key', apiKey: string }`;
 * `credentialPlacement` below puts the `apiKey` into `?key=` on every request.
 */
export const geminiConnector = declarativeRestConnector({
  kind: 'gemini',
  displayName: 'Google Gemini',
  description:
    'Google Gemini Generative Language API — text/multimodal generation, embeddings, token counting, file uploads, and context caching.',
  auth: {
    kind: 'api-key',
    hint: 'Google AI Studio API key (https://aistudio.google.com/app/apikey). For Vertex AI / OAuth2-billed traffic, use a separate connector.',
  },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://generativelanguage.googleapis.com',
  credentialPlacement: { kind: 'query', parameter: 'key' },
  test: { method: 'GET', path: '/v1beta/models' },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description: 'List models available to the API key.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1beta/models',
        query: { pageSize: '{pageSize}', pageToken: '{pageToken}' },
      },
    },
    {
      name: 'models.get',
      class: 'read',
      description: 'Describe a single model (context window, supported methods, version).',
      parameters: {
        type: 'object',
        properties: { model: { type: 'string', description: 'e.g. "gemini-2.0-flash" or "models/gemini-2.0-flash".' } },
        required: ['model'],
      },
      request: { method: 'GET', path: '/v1beta/models/{model}' },
    },
    {
      name: 'models.countTokens',
      class: 'read',
      description: 'Count input tokens for a prompt against a model (cheap; useful for budget gating).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          contents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'model'] },
                parts: { type: 'array', items: { type: 'object' } },
              },
              required: ['parts'],
            },
          },
          generateContentRequest: { type: 'object' },
        },
        required: ['model'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/models/{model}:countTokens',
        body: { contents: '{contents}', generateContentRequest: '{generateContentRequest}' },
      },
    },
    {
      name: 'models.generateContent',
      class: 'mutation',
      description:
        'Generate content (text/multimodal). Modeled as a mutation because the call has billed external effect even though it does not write to a persistent resource.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          contents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'model'] },
                parts: { type: 'array', items: { type: 'object' } },
              },
              required: ['parts'],
            },
          },
          systemInstruction: { type: 'object' },
          generationConfig: {
            type: 'object',
            properties: {
              temperature: { type: 'number' },
              topP: { type: 'number' },
              topK: { type: 'integer' },
              candidateCount: { type: 'integer', minimum: 1, maximum: 8 },
              maxOutputTokens: { type: 'integer' },
              stopSequences: { type: 'array', items: { type: 'string' } },
              responseMimeType: { type: 'string' },
              responseSchema: { type: 'object' },
            },
          },
          safetySettings: { type: 'array', items: { type: 'object' } },
          tools: { type: 'array', items: { type: 'object' } },
          toolConfig: { type: 'object' },
          cachedContent: { type: 'string', description: 'Name of a cachedContents resource to reuse a prefix.' },
        },
        required: ['model', 'contents'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/models/{model}:generateContent',
        body: {
          contents: '{contents}',
          systemInstruction: '{systemInstruction}',
          generationConfig: '{generationConfig}',
          safetySettings: '{safetySettings}',
          tools: '{tools}',
          toolConfig: '{toolConfig}',
          cachedContent: '{cachedContent}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'models.streamGenerateContent',
      class: 'mutation',
      description:
        'Streamed generation. Google emits SSE; the declarative REST runtime returns the aggregated response body. Use Gemini directly via WebSocket/SSE for token-by-token streaming.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          contents: { type: 'array', items: { type: 'object' } },
          systemInstruction: { type: 'object' },
          generationConfig: { type: 'object' },
          safetySettings: { type: 'array', items: { type: 'object' } },
          tools: { type: 'array', items: { type: 'object' } },
          toolConfig: { type: 'object' },
          cachedContent: { type: 'string' },
        },
        required: ['model', 'contents'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/models/{model}:streamGenerateContent',
        query: { alt: 'sse' },
        body: {
          contents: '{contents}',
          systemInstruction: '{systemInstruction}',
          generationConfig: '{generationConfig}',
          safetySettings: '{safetySettings}',
          tools: '{tools}',
          toolConfig: '{toolConfig}',
          cachedContent: '{cachedContent}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'models.embedContent',
      class: 'mutation',
      description: 'Embed a single content payload (billed; modeled as mutation w/ external effect).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'e.g. "text-embedding-004" or "models/text-embedding-004".' },
          content: {
            type: 'object',
            properties: { parts: { type: 'array', items: { type: 'object' } } },
            required: ['parts'],
          },
          taskType: {
            type: 'string',
            enum: [
              'TASK_TYPE_UNSPECIFIED',
              'RETRIEVAL_QUERY',
              'RETRIEVAL_DOCUMENT',
              'SEMANTIC_SIMILARITY',
              'CLASSIFICATION',
              'CLUSTERING',
              'QUESTION_ANSWERING',
              'FACT_VERIFICATION',
              'CODE_RETRIEVAL_QUERY',
            ],
          },
          title: { type: 'string' },
          outputDimensionality: { type: 'integer', minimum: 1 },
        },
        required: ['model', 'content'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/models/{model}:embedContent',
        body: {
          content: '{content}',
          taskType: '{taskType}',
          title: '{title}',
          outputDimensionality: '{outputDimensionality}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'models.batchEmbedContents',
      class: 'mutation',
      description: 'Embed multiple content payloads in a single billed call.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          requests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                model: { type: 'string' },
                content: { type: 'object' },
                taskType: { type: 'string' },
                title: { type: 'string' },
                outputDimensionality: { type: 'integer' },
              },
              required: ['model', 'content'],
            },
          },
        },
        required: ['model', 'requests'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/models/{model}:batchEmbedContents',
        body: { requests: '{requests}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'files.list',
      class: 'read',
      description: 'List media uploaded via the File API (referenced from generateContent by URI).',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1beta/files',
        query: { pageSize: '{pageSize}', pageToken: '{pageToken}' },
      },
    },
    {
      name: 'files.get',
      class: 'read',
      description: 'Get metadata for an uploaded file by name (e.g. "files/abc123").',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: { method: 'GET', path: '/v1beta/{name}' },
    },
    {
      name: 'files.delete',
      class: 'mutation',
      description: 'Delete an uploaded file. Files auto-expire after 48 hours; explicit delete is for early reclaim.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: { method: 'DELETE', path: '/v1beta/{name}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'cachedContents.list',
      class: 'read',
      description: 'List cached-content resources owned by the API key.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1beta/cachedContents',
        query: { pageSize: '{pageSize}', pageToken: '{pageToken}' },
      },
    },
    {
      name: 'cachedContents.get',
      class: 'read',
      description: 'Describe a cached-content resource (e.g. "cachedContents/abc").',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: { method: 'GET', path: '/v1beta/{name}' },
    },
    {
      name: 'cachedContents.create',
      class: 'mutation',
      description: 'Create a cached-content resource so a prefix (system instruction, large file) is billed once and reused.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Fully qualified model, e.g. "models/gemini-1.5-flash-001".' },
          contents: { type: 'array', items: { type: 'object' } },
          systemInstruction: { type: 'object' },
          tools: { type: 'array', items: { type: 'object' } },
          toolConfig: { type: 'object' },
          displayName: { type: 'string' },
          ttl: { type: 'string', description: 'Duration string, e.g. "3600s".' },
          expireTime: { type: 'string', description: 'RFC3339 timestamp; mutually exclusive with ttl.' },
        },
        required: ['model', 'contents'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/cachedContents',
        body: {
          model: '{model}',
          contents: '{contents}',
          systemInstruction: '{systemInstruction}',
          tools: '{tools}',
          toolConfig: '{toolConfig}',
          displayName: '{displayName}',
          ttl: '{ttl}',
          expireTime: '{expireTime}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'cachedContents.delete',
      class: 'mutation',
      description: 'Delete a cached-content resource.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: { method: 'DELETE', path: '/v1beta/{name}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
