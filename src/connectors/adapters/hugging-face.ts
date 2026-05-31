import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Hugging Face Inference connector.
 *
 * Authentication: a user/workspace access token (`hf_…`) delivered as a
 * `Bearer` credential in the `Authorization` header. There is no 3-legged
 * OAuth surface on the inference endpoint.
 *
 * Endpoint surface: model-scoped task inference (`/models/{model_id}`) for
 * the classic serverless Inference API, plus the OpenAI-compatible chat
 * completions route exposed by the Hugging Face Inference Router. Every
 * task is a `POST` against the per-model URL with a task-shaped JSON body.
 *
 * Mapping to the activepieces catalog actions (verified against
 * `activepieces-catalog.json` → `id: "hugging-face"`):
 *   - documentQuestionAnswering → document-question-answering
 *   - languageTranslation       → translation
 *   - textClassification        → text-classification
 *   - textSummarization         → summarization
 *   - chatCompletion            → router /v1/chat/completions
 *   - createImage               → text-to-image
 *   - objectDetection           → object-detection
 *   - imageClassification       → image-classification
 *
 * Inference is non-idempotent (each call samples a fresh output) and has
 * an external billing effect, so mutation capabilities declare `cas: 'none'`
 * and `externalEffect: true`. Read-only metadata lookups against the Hub
 * model registry are exposed as `read` capabilities.
 */
export const huggingFaceConnector = declarativeRestConnector({
  kind: 'hugging-face',
  displayName: 'Hugging Face',
  description:
    'Run inference on 100,000+ open ML models on Hugging Face for NLP, vision, and audio tasks via the Inference API and the OpenAI-compatible Inference Router.',
  auth: {
    kind: 'api-key',
    hint: 'Hugging Face user access token (starts with hf_…). Create one at https://huggingface.co/settings/tokens with at least the "Make calls to inference providers" scope.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api-inference.huggingface.co',
  // GET /api/whoami-v2 lives on the Hub host, not the inference host. The
  // inference root itself is a low-cost authenticated probe that returns 200
  // for a valid token.
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'chat.completion',
      class: 'mutation',
      description:
        'OpenAI-compatible chat completion against any Hugging Face router-exposed model (e.g. meta-llama/Meta-Llama-3-8B-Instruct, Qwen/Qwen2.5-72B-Instruct). Pass the OpenAI-style body (model, messages, temperature, max_tokens, top_p, stop, stream).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Hugging Face model id served by the Inference Router.' },
          messages: {
            type: 'array',
            description: 'Ordered conversation turns ({ role, content }).',
            items: { type: 'object' },
          },
          max_tokens: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          frequency_penalty: { type: 'number', minimum: -2, maximum: 2 },
          presence_penalty: { type: 'number', minimum: -2, maximum: 2 },
          stop: { type: 'array', items: { type: 'string' } },
          stream: { type: 'boolean' },
        },
        required: ['model', 'messages'],
      },
      // The chat-completions endpoint is served by the Inference Router on a
      // different host. The declarative engine resolves absolute URLs in
      // `path` verbatim, so we point straight at the router.
      request: {
        method: 'POST',
        path: 'https://router.huggingface.co/v1/chat/completions',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'text.summarization',
      class: 'mutation',
      description:
        'Summarize input text against a summarization model (default upstream: facebook/bart-large-cnn). Body shape: { inputs, parameters }.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Summarization model id, e.g. facebook/bart-large-cnn.' },
          inputs: { type: 'string', description: 'Source text to summarize.' },
          parameters: {
            type: 'object',
            properties: {
              min_length: { type: 'integer', minimum: 0 },
              max_length: { type: 'integer', minimum: 1 },
              do_sample: { type: 'boolean' },
            },
          },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', parameters: '{parameters}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'text.classification',
      class: 'mutation',
      description:
        'Classify input text (sentiment, topic, NLI, etc.) against a text-classification model (default upstream: distilbert-base-uncased-finetuned-sst-2-english).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Text classification model id.' },
          inputs: { type: 'string', description: 'Text to classify.' },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'language.translation',
      class: 'mutation',
      description:
        'Translate input text using a translation model (e.g. Helsinki-NLP/opus-mt-en-fr or facebook/nllb-200-distilled-600M).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Translation model id.' },
          inputs: { type: 'string', description: 'Source text to translate.' },
          parameters: {
            type: 'object',
            properties: {
              src_lang: { type: 'string' },
              tgt_lang: { type: 'string' },
            },
          },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', parameters: '{parameters}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'document.question.answering',
      class: 'mutation',
      description:
        'Answer a question grounded in a document image against a document-question-answering model (e.g. impira/layoutlm-document-qa). `inputs` carries `image` as a base64 string or hosted URL plus the natural-language `question`.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Document QA model id.' },
          inputs: {
            type: 'object',
            properties: {
              image: { type: 'string', description: 'Base64-encoded image bytes or a URL the model server can fetch.' },
              question: { type: 'string' },
            },
            required: ['image', 'question'],
          },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'create.image',
      class: 'mutation',
      description:
        'Generate an image from a text prompt with a text-to-image model (e.g. stabilityai/stable-diffusion-xl-base-1.0, black-forest-labs/FLUX.1-dev). Response is raw image bytes.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Text-to-image model id.' },
          inputs: { type: 'string', description: 'Prompt describing the desired image.' },
          parameters: {
            type: 'object',
            properties: {
              negative_prompt: { type: 'string' },
              width: { type: 'integer', minimum: 64, maximum: 2048 },
              height: { type: 'integer', minimum: 64, maximum: 2048 },
              num_inference_steps: { type: 'integer', minimum: 1, maximum: 100 },
              guidance_scale: { type: 'number', minimum: 0, maximum: 20 },
              seed: { type: 'integer' },
            },
          },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', parameters: '{parameters}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'object.detection',
      class: 'mutation',
      description:
        'Detect objects in an image with an object-detection model (e.g. facebook/detr-resnet-50). `inputs` is a base64 image string or hosted URL.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Object detection model id.' },
          inputs: { type: 'string', description: 'Base64-encoded image bytes or a URL the model server can fetch.' },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'image.classification',
      class: 'mutation',
      description:
        'Classify an image with an image-classification model (e.g. google/vit-base-patch16-224). `inputs` is a base64 image string or hosted URL.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Image classification model id.' },
          inputs: { type: 'string', description: 'Base64-encoded image bytes or a URL the model server can fetch.' },
          options: {
            type: 'object',
            properties: {
              use_cache: { type: 'boolean' },
              wait_for_model: { type: 'boolean' },
            },
          },
        },
        required: ['model', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}',
        body: { inputs: '{inputs}', options: '{options}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'models.get',
      class: 'read',
      description: 'Fetch Hub metadata for a model (pipeline tag, license, downloads, last-modified) from the public Hub API.',
      parameters: {
        type: 'object',
        properties: { model: { type: 'string' } },
        required: ['model'],
      },
      request: {
        method: 'GET',
        path: 'https://huggingface.co/api/models/{model}',
      },
    },
    {
      name: 'models.search',
      class: 'read',
      description:
        'Search the Hugging Face model Hub. Use `search` for free-text queries, `filter` for pipeline-tag/library filters, and `sort` to order by downloads, likes, or modification time.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          filter: { type: 'string', description: 'Filter expression, e.g. "text-classification" or "pipeline_tag:summarization".' },
          author: { type: 'string' },
          sort: { type: 'string', enum: ['downloads', 'likes', 'lastModified'] },
          direction: { type: 'integer', enum: [-1, 1] },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
      request: {
        method: 'GET',
        path: 'https://huggingface.co/api/models',
        query: {
          search: '{search}',
          filter: '{filter}',
          author: '{author}',
          sort: '{sort}',
          direction: '{direction}',
          limit: '{limit}',
        },
      },
    },
  ],
})
