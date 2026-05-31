import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Dashworks connector.
 *
 * Dashworks is an enterprise answer engine that lets workspace users build
 * "Bots" backed by federated search over connected SaaS sources (Notion,
 * Slack, Confluence, Drive, etc.). The public Bots API exposes a single
 * synthesize-an-answer endpoint that targets a specific bot by ID and
 * returns a grounded response with optional inline source citations.
 *
 * Auth is a tenant-issued API key delivered as a bearer token; there is no
 * documented OAuth surface for the Bots API.
 *
 * Consistency: answers are LLM-synthesized over a non-deterministic
 * retrieval pass and each call is a metered query against the tenant's
 * Dashworks plan. CAS posture is therefore `none` — the caller owns
 * dedupe — and `externalEffect: true` so the orchestrator's dry-run
 * policy treats this as a side-effecting call.
 */
export const dashworksConnector = declarativeRestConnector({
  kind: 'dashworks',
  displayName: 'Dashworks',
  description:
    'Query a Dashworks Bot for a federated-search answer grounded in the workspace’s connected knowledge sources, with optional inline source citations.',
  auth: {
    kind: 'api-key',
    hint: 'Dashworks API key (Settings → API Keys). Sent as a bearer token on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.dashworks.ai/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // Dashworks does not document a dedicated probe endpoint; the answer
  // endpoint itself is the smallest authenticated call we can issue and
  // it bills the tenant, so we omit `test` rather than ship a probe.
  capabilities: [
    {
      name: 'generate.answer',
      class: 'mutation',
      description:
        'Ask a configured Dashworks Bot a question and receive a synthesized answer drawn from the bot’s connected sources. When inlineSources is true (default) the answer text contains inline markdown citations.',
      parameters: {
        type: 'object',
        properties: {
          botId: {
            type: 'string',
            description:
              'Bot ID copied from Dashworks → Bots → (select bot) → settings. Identifies which knowledge-source bundle the question is routed to.',
          },
          message: {
            type: 'string',
            description: 'The question or prompt to send to the bot.',
          },
          inlineSources: {
            type: 'boolean',
            description:
              'When true (default), sources are cited inline in markdown formatting within the answer text. When false, the answer omits inline citations.',
          },
        },
        required: ['botId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/answer',
        body: {
          bot_id: '{botId}',
          message: '{message}',
          inline_sources: '{inlineSources}',
        },
      },
      // LLM-synthesized answer; non-idempotent at the model layer and
      // Dashworks does not honour a client-supplied idempotency key.
      // Caller owns dedupe.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
