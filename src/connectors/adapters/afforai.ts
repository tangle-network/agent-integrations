import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Afforai connector.
 *
 * Afforai is a research assistant that lets users build chatbots over a
 * private corpus of uploaded documents. The external integration surface
 * is intentionally narrow: a single ask-the-chatbot endpoint that accepts
 * a sessionID (the chatbot the user has provisioned in the Afforai UI),
 * a chat-history array, and the next user turn, and returns the
 * assistant response synthesized over the bot's document set.
 *
 * Auth is a tenant-issued API key delivered as a bearer token. There is
 * no OAuth surface — Afforai does not expose a 3-legged flow.
 *
 * Consistency: chatbot responses are non-deterministic (LLM-backed) and
 * carry external billing-class effects (each call is a metered query
 * against the tenant's plan). CAS posture is therefore `none` — the
 * caller owns dedupe — and `externalEffect: true` so the orchestrator's
 * dry-run policy treats this as a side-effecting call.
 */
export const afforaiConnector = declarativeRestConnector({
  kind: 'afforai',
  displayName: 'Afforai',
  description:
    'Ask Afforai chatbots questions over a private document corpus and receive synthesized answers with optional web-augmented retrieval.',
  auth: {
    kind: 'api-key',
    hint: 'Afforai API key (workspace settings → API). Sent as a bearer token on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://app.afforai.com/api/external',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // Afforai does not document a dedicated probe endpoint; the chatbot
  // endpoint itself is the smallest authenticated call we can issue, so
  // we omit `test` rather than ship a probe that bills the tenant.
  capabilities: [
    {
      name: 'ask.chatbot',
      class: 'mutation',
      description:
        'Send a user message to a configured Afforai chatbot and receive a synthesized answer drawn from the chatbot’s document set. Optionally enable deep-search and Google-augmented retrieval.',
      parameters: {
        type: 'object',
        properties: {
          sessionID: {
            type: 'string',
            description:
              'Chatbot ID copied from the Afforai workspace (Actions → Settings on the chatbot card).',
          },
          history: {
            type: 'array',
            description:
              'Prior conversation turns. Each entry is { role: "user" | "assistant", content: string }. Pass [] for a fresh session.',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          role: {
            type: 'string',
            enum: ['user', 'assistant'],
            description: 'Role of the new message being sent. Almost always "user".',
          },
          content: {
            type: 'string',
            description: 'Body of the new message to send to the chatbot.',
          },
          powerful: {
            type: 'boolean',
            description:
              'When true, Afforai performs a deeper retrieval pass over the chatbot’s document set at the cost of higher per-call billing and latency.',
          },
          google: {
            type: 'boolean',
            description:
              'When true, the chatbot is allowed to consult Google search results in addition to the uploaded documents.',
          },
        },
        required: ['sessionID', 'history', 'role', 'content', 'powerful', 'google'],
      },
      request: {
        method: 'POST',
        path: '/chatbot',
        body: 'args',
      },
      // LLM-backed answer; non-idempotent at the model layer and Afforai
      // does not honour a client-supplied idempotency key. Caller owns
      // dedupe.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
