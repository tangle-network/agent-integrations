import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Aidbase connector.
 *
 * Aidbase is an AI-powered customer-support platform (chatbot, ticketing,
 * FAQ/knowledge-base). The public REST API is bearer-authenticated against
 * `https://api.aidbase.ai/v1` with a workspace API key minted from the
 * Aidbase dashboard.
 *
 * Surface covered: knowledge-source ingestion (add video / website / FAQ
 * item), FAQ container creation, chatbot reply generation, and training
 * job kickoff. All six declared capabilities map 1:1 to the activepieces
 * `actions` array for the `aidbase` piece.
 *
 * Webhook-shaped triggers (email.received, ticket.created, …) are not
 * modeled here because they are server-push, not client-pull — they belong
 * in a webhook-subscription adapter and would not be invokable through the
 * declarative-REST `executeRead` / `executeMutation` seam.
 */
export const aidbaseConnector = declarativeRestConnector({
  kind: 'aidbase',
  displayName: 'Aidbase',
  description:
    'Ingest knowledge sources, manage FAQs, generate chatbot replies, and trigger training jobs in an Aidbase support workspace.',
  auth: {
    kind: 'api-key',
    hint: 'Aidbase workspace API key. Generate one from the Aidbase dashboard → Settings → API.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.aidbase.ai/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
  },
  // GET /me is the standard cheap authenticated probe — returns the workspace
  // the API key is scoped to. If it 401s, the key is invalid or revoked.
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'knowledge.add_video',
      class: 'mutation',
      description:
        'Add a YouTube video as a knowledge source. The transcript is fetched and indexed asynchronously; the response carries the source id, not a ready-state.',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'Public YouTube URL of the video to ingest.',
          },
          categories: {
            type: 'array',
            description: 'Optional category names. Unknown names are created.',
            items: { type: 'string' },
          },
        },
        required: ['video_url'],
      },
      request: {
        method: 'POST',
        path: '/knowledge/videos',
        body: { video_url: '{video_url}', categories: '{categories}' },
      },
      // Aidbase does not honour an idempotency key on knowledge ingestion —
      // replay creates a duplicate source. Caller-owned dedupe only.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'knowledge.add_website',
      class: 'mutation',
      description:
        'Crawl and index a website as a knowledge source. The crawl runs asynchronously; poll the returned source id for completion.',
      parameters: {
        type: 'object',
        properties: {
          website_url: {
            type: 'string',
            description: 'Root URL to crawl (e.g. https://www.example.com).',
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['website_url'],
      },
      request: {
        method: 'POST',
        path: '/knowledge/websites',
        body: { website_url: '{website_url}', categories: '{categories}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'knowledge.add_faq_item',
      class: 'mutation',
      description:
        'Append a Q/A pair to an existing FAQ knowledge base. Returns the created item id.',
      parameters: {
        type: 'object',
        properties: {
          faq_id: {
            type: 'string',
            description: 'Target FAQ container id (from knowledge.create_faq).',
          },
          question: { type: 'string' },
          answer: { type: 'string' },
          source_url: {
            type: 'string',
            description: 'Optional URL pointing to the source of the information.',
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['faq_id', 'question', 'answer'],
      },
      request: {
        method: 'POST',
        path: '/knowledge/faqs/{faq_id}/items',
        body: {
          question: '{question}',
          answer: '{answer}',
          source_url: '{source_url}',
          categories: '{categories}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'knowledge.create_faq',
      class: 'mutation',
      description: 'Create a new FAQ knowledge-base container. Items are added with knowledge.add_faq_item.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          categories: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/knowledge/faqs',
        body: {
          title: '{title}',
          description: '{description}',
          categories: '{categories}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'chatbot.create_reply',
      class: 'mutation',
      description:
        'Send a user message to the Aidbase chatbot and receive a generated reply. Pass session_id to continue an existing conversation; omit it to start a new one.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The user message to send to the chatbot.',
          },
          session_id: {
            type: 'string',
            description: 'Optional session id to maintain conversation context across calls.',
          },
        },
        required: ['message'],
      },
      request: {
        method: 'POST',
        path: '/chatbot/replies',
        body: { message: '{message}', session_id: '{session_id}' },
      },
      // Generation is non-deterministic; replay yields a different reply.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'training.start',
      class: 'mutation',
      description:
        'Kick off a training run that re-indexes the workspace knowledge base. Returns a training job id the caller can poll for completion.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'POST',
        path: '/training/jobs',
        body: {},
      },
      // Aidbase coalesces concurrent training requests into a single job, so
      // replay returns the same in-progress job id. Treat as idempotent.
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
