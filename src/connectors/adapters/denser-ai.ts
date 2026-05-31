import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Denser.ai connector.
 *
 * Denser.ai hosts retrieval-augmented chatbots over a tenant-supplied
 * document/website corpus. The external integration surface exposed by
 * the activepieces catalog is a single chat-query endpoint that accepts
 * a question, the target `chatbotId` from the Denser dashboard, and a
 * small set of optional generation knobs (model selection, system
 * prompt, citation inclusion) and returns the chatbot's synthesized
 * answer.
 *
 * Auth is a workspace API key delivered as a bearer token. There is no
 * OAuth flow — Denser does not document a 3-legged authorization grant.
 *
 * Consistency: chatbot responses are non-deterministic (LLM-backed) and
 * carry external billing-class effects (each call is a metered query
 * against the tenant's Denser plan). CAS posture is therefore `none` —
 * the caller owns dedupe — and `externalEffect: true` so the orchestrator
 * treats the call as side-effecting under dry-run policy.
 */
export const denserAiConnector = declarativeRestConnector({
  kind: 'denser-ai',
  displayName: 'Denser.ai',
  description:
    "Query Denser.ai chatbots against a tenant's document and website corpus and receive synthesized answers with optional citations.",
  auth: {
    kind: 'api-key',
    hint: 'Denser.ai API key (workspace dashboard → API keys). Sent as a bearer token on every chat request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://denser.ai/api',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // Denser does not publish a dedicated lightweight probe endpoint;
  // the chat endpoint itself bills the tenant, so we deliberately omit
  // a `test` route rather than ship a probe that consumes plan credits.
  capabilities: [
    {
      name: 'process.input.text',
      class: 'mutation',
      description:
        "Send a user question to a configured Denser.ai chatbot and receive a synthesized answer drawn from the chatbot's retrieval corpus. Optional knobs select the underlying model, override the system prompt, and toggle inline citations.",
      parameters: {
        type: 'object',
        properties: {
          chatbotId: {
            type: 'string',
            description:
              'Identifier of the target chatbot, copied from the Denser dashboard at https://denser.ai/u/chatbots.',
          },
          question: {
            type: 'string',
            description: 'The user question to be processed by the chatbot.',
          },
          prompt: {
            type: 'string',
            description:
              "Optional system prompt that overrides the chatbot's default instructions for this single call.",
          },
          model: {
            type: 'string',
            description:
              'Optional model identifier (for example gpt-3.5, gpt-4). When omitted, Denser uses the chatbot default.',
          },
          citation: {
            type: 'boolean',
            description:
              'When true, the response includes inline citations linking back to the source documents used to synthesize the answer.',
          },
        },
        required: ['chatbotId', 'question'],
      },
      request: {
        method: 'POST',
        path: '/chat/{chatbotId}',
        body: {
          question: '{question}',
          prompt: '{prompt}',
          model: '{model}',
          citation: '{citation}',
        },
      },
      // LLM-backed answer; non-idempotent at the model layer and Denser
      // does not honour a client-supplied idempotency key. Caller owns
      // dedupe.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
