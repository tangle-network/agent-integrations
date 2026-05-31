import { declarativeRestConnector } from './declarative-rest.js'

// Jina AI public APIs are split across several hostnames. The catalog action
// list is empty upstream, but the auth-field surface (URL+format, query+SERP
// options, classifier model+labels+training, DeepSearch budget/effort/hostname
// filters, embedding/rerank inputs) maps onto the documented Jina endpoints:
//   - r.jina.ai           Reader      — URL → markdown/HTML/text/JSON
//   - s.jina.ai           Search      — query → SERP + optional full content
//   - api.jina.ai/v1      Core API    — classify / embeddings / rerank / classifier
//   - deepsearch.jina.ai  DeepSearch  — chat-completions-shaped reasoning + search
//
// All four accept the same `Authorization: Bearer <JINA_API_KEY>` (declarative
// default). Per-request options come straight from the public docs; we keep
// every Reader knob as a header on the request because that is how r.jina.ai
// transports them (X-Return-Format, X-Remove-All-Images, etc.). We do NOT
// hardwire a Jina model — model selection is a request-time string so the
// connection works against every model the API key authorizes.
//
// Refs:
//   https://jina.ai/reader
//   https://jina.ai/api-dashboard/reader
//   https://jina.ai/embeddings
//   https://jina.ai/reranker
//   https://jina.ai/classifier
//   https://jina.ai/deepsearch

export const jinaAiConnector = declarativeRestConnector({
  kind: 'jina-ai',
  displayName: 'Jina AI',
  description:
    'AI-powered web content extraction (Reader), web search (SERP), classification, embeddings, reranking, and DeepSearch reasoning against the Jina AI APIs.',
  auth: {
    kind: 'api-key',
    hint: 'Jina AI API key from https://jina.ai/?sui=apikey. Used as a Bearer token across r.jina.ai, s.jina.ai, api.jina.ai and deepsearch.jina.ai.',
  },
  category: 'other',
  // Jina is generative + retrieval. No read-your-writes semantics on its
  // request/response surface (the only stateful resource is the classifier
  // model, which is append-only in practice). Advisory is the honest default.
  defaultConsistencyModel: 'advisory',
  // api.jina.ai/v1 is the richest surface; per-capability `path` values
  // include the leading scheme/host for the other Jina hostnames so
  // declarative-rest's per-request URL takes precedence over the base.
  baseUrl: 'https://api.jina.ai/v1',
  test: { method: 'GET', path: '/embeddings/models' },
  capabilities: [
    // ─── Reader: URL → markdown/HTML/text/JSON ──────────────────────────
    // r.jina.ai accepts the target URL appended directly to the host and
    // transports Reader options as `X-*` headers. We expose every option the
    // catalog auth-field surface enumerated (format, image stripping, link/
    // image gathering, iframe / shadow DOM extraction, redirect handling,
    // EU compliance, JSON response, timeout, css selectors, tracking
    // suppression, cache bypass).
    {
      name: 'reader.read',
      class: 'read',
      description:
        'Extract clean content (markdown, HTML, text, screenshot, or JSON) from a webpage via Jina Reader (r.jina.ai).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target webpage URL.' },
          format: {
            type: 'string',
            enum: ['markdown', 'html', 'text', 'screenshot', 'pageshot'],
            description: 'Reader X-Return-Format. Defaults to markdown server-side.',
          },
          remove_all_images: { type: 'boolean' },
          links_summary: { type: 'string', enum: ['none', 'all', 'true'] },
          images_summary: { type: 'string', enum: ['none', 'all', 'true'] },
          do_not_track: { type: 'boolean' },
          iframe_extraction: { type: 'boolean' },
          shadow_dom_extraction: { type: 'boolean' },
          follow_redirect: { type: 'boolean' },
          eu_compliance: { type: 'boolean' },
          json_response: { type: 'boolean' },
          timeout_seconds: { type: 'integer', minimum: 0 },
          css_selector: { type: 'string' },
          wait_for_selector: { type: 'string' },
          exclude_selector: { type: 'string' },
          bypass_cached_content: { type: 'boolean' },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: 'https://r.jina.ai/{url}',
        headers: {
          'X-Return-Format': '{format}',
          'X-Remove-All-Images': '{remove_all_images}',
          'X-With-Links-Summary': '{links_summary}',
          'X-With-Images-Summary': '{images_summary}',
          'X-No-Cache': '{bypass_cached_content}',
          'X-Iframe-Extraction': '{iframe_extraction}',
          'X-Shadow-Dom-Extraction': '{shadow_dom_extraction}',
          'X-With-Iframe': '{iframe_extraction}',
          'X-With-Shadow-Dom': '{shadow_dom_extraction}',
          'X-With-Generated-Alt': '{images_summary}',
          'X-Timeout': '{timeout_seconds}',
          'X-Target-Selector': '{css_selector}',
          'X-Wait-For-Selector': '{wait_for_selector}',
          'X-Remove-Selector': '{exclude_selector}',
          'X-No-Track': '{do_not_track}',
          'X-Follow-Redirect': '{follow_redirect}',
          'X-EU-Compliance': '{eu_compliance}',
          Accept: '{json_response}',
        },
      },
    },

    // ─── Search: SERP via s.jina.ai ─────────────────────────────────────
    {
      name: 'search.query',
      class: 'read',
      description:
        'Run a web search via Jina Search (s.jina.ai). Returns ranked SERP results and optionally the full Reader-extracted content of every hit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          read_full_content: { type: 'boolean' },
          fetch_favicons: { type: 'boolean' },
          preferred_country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
          preferred_location: { type: 'string' },
          preferred_language: { type: 'string' },
          pagination: { type: 'integer', minimum: 0 },
          in_site_search: { type: 'string' },
          bypass_cached_content: { type: 'boolean' },
          boost_hostnames: { type: 'string' },
          bad_hostnames: { type: 'string' },
          only_hostnames: { type: 'string' },
          response_format: { type: 'string', enum: ['default', 'json'] },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: 'https://s.jina.ai/',
        query: { q: '{query}' },
        headers: {
          'X-Engine': 'direct',
          'X-With-Favicons': '{fetch_favicons}',
          'X-Respond-With': '{read_full_content}',
          'X-Locale': '{preferred_language}',
          'X-Site': '{in_site_search}',
          'X-No-Cache': '{bypass_cached_content}',
          'X-Country': '{preferred_country}',
          'X-Location': '{preferred_location}',
          'X-Pagination': '{pagination}',
          'X-Boost-Hostnames': '{boost_hostnames}',
          'X-Bad-Hostnames': '{bad_hostnames}',
          'X-Only-Hostnames': '{only_hostnames}',
          Accept: '{response_format}',
        },
      },
    },

    // ─── Classification (zero-shot + trained-classifier inference) ──────
    {
      name: 'classifier.classify',
      class: 'mutation',
      description:
        'Classify text or images against a label set (zero-shot) or against a previously trained Jina classifier.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Jina classifier model identifier.' },
          classifier_id: {
            type: 'string',
            description: 'ID of a trained classifier. Required when invoking a custom classifier instead of a zero-shot model.',
          },
          input: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    image: { type: 'string' },
                  },
                },
              },
            ],
            description: 'Text or image-URL inputs. Strings without a scheme are treated as text; URLs are treated as image references.',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Zero-shot label set. Omit when invoking a trained classifier.',
          },
        },
        required: ['input'],
      },
      request: {
        method: 'POST',
        path: '/classify',
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Classifier training (creates / updates a trained classifier) ───
    // Maps the catalog auth-field bundle: model, access, num_iters, type,
    // and `training_data` (array of {input, label}).
    {
      name: 'classifier.train',
      class: 'mutation',
      description:
        'Train a Jina classifier on a labelled dataset. Returns a classifier id usable from classifier.classify.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          access: {
            type: 'string',
            enum: ['public', 'private'],
            description: 'Visibility of the trained model.',
          },
          num_iters: { type: 'integer', minimum: 1 },
          input_type: {
            type: 'string',
            enum: ['text', 'image'],
            description: 'Type of training inputs.',
          },
          training_data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                input: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['input', 'label'],
            },
          },
        },
        required: ['training_data'],
      },
      request: {
        method: 'POST',
        path: '/train',
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Embeddings ─────────────────────────────────────────────────────
    {
      name: 'embeddings.create',
      class: 'mutation',
      description: 'Generate dense embedding vectors with a Jina embeddings model (jina-embeddings-v3, v4, clip-v2, …).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    image: { type: 'string' },
                  },
                },
              },
            ],
          },
          task: {
            type: 'string',
            enum: ['retrieval.query', 'retrieval.passage', 'separation', 'classification', 'text-matching'],
          },
          dimensions: { type: 'integer', minimum: 1 },
          normalized: { type: 'boolean' },
          embedding_type: {
            type: 'string',
            enum: ['float', 'base64', 'binary', 'ubinary'],
          },
          late_chunking: { type: 'boolean' },
          truncate: { type: 'boolean' },
        },
        required: ['model', 'input'],
      },
      request: {
        method: 'POST',
        path: '/embeddings',
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Reranking ──────────────────────────────────────────────────────
    {
      name: 'reranker.rerank',
      class: 'mutation',
      description: 'Re-score a candidate document list against a query with a Jina reranker model.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          query: { type: 'string' },
          documents: {
            oneOf: [
              { type: 'array', items: { type: 'string' } },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { text: { type: 'string' } },
                  required: ['text'],
                },
              },
            ],
          },
          top_n: { type: 'integer', minimum: 1 },
          return_documents: { type: 'boolean' },
        },
        required: ['model', 'query', 'documents'],
      },
      request: {
        method: 'POST',
        path: '/rerank',
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── DeepSearch (chat-completions-shaped reasoning + search) ────────
    // DeepSearch lives on deepsearch.jina.ai and is OpenAI-chat-shaped.
    // We expose the full reasoning-effort / budget / hostname-filter
    // surface the catalog auth fields enumerated.
    {
      name: 'deepsearch.chat',
      class: 'mutation',
      description:
        'Run a DeepSearch reasoning + web-search query (chat-completions shape). Iteratively searches, reads, and reasons until it produces a cited answer.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          reasoning_effort: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Constrains effort spent reasoning before responding.',
          },
          budget_tokens: { type: 'integer', minimum: 1 },
          max_attempts: { type: 'integer', minimum: 1 },
          no_direct_answer: { type: 'boolean' },
          max_returned_urls: { type: 'integer', minimum: 0 },
          response_format: { type: 'object' },
          boost_hostnames: {
            type: 'array',
            items: { type: 'string' },
          },
          bad_hostnames: {
            type: 'array',
            items: { type: 'string' },
          },
          only_hostnames: {
            type: 'array',
            items: { type: 'string' },
          },
          stream: { type: 'boolean', const: false },
        },
        required: ['messages'],
      },
      request: {
        method: 'POST',
        path: 'https://deepsearch.jina.ai/v1/chat/completions',
        body: 'args',
      },
      cas: 'native-idempotency',
    },

    // ─── Model discovery ────────────────────────────────────────────────
    {
      name: 'models.list',
      class: 'read',
      description: 'List Jina embedding / classifier / reranker models the API key is authorized to use.',
      parameters: {
        type: 'object',
        properties: {
          family: {
            type: 'string',
            enum: ['embeddings', 'rerank', 'classify'],
          },
        },
      },
      request: {
        method: 'GET',
        path: '/{family}/models',
      },
    },
  ],
})
