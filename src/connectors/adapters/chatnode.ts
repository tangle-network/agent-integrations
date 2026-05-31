import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ChatNode connector.
 *
 * ChatNode is a hosted no-code AI chatbot builder. Workspace owners train
 * a bot against documents/URLs/FAQs, then expose it as a chat widget or a
 * REST endpoint that takes a user message and returns a generated reply
 * against the trained corpus.
 *
 * The public REST API is bearer-authenticated against
 * `https://www.chatnode.ai/api/v2`. The API key is workspace-scoped and
 * minted from the ChatNode dashboard. Each call also requires a `botId`
 * identifying which trained bot to query; the activepieces piece exposes
 * `botId` as an authField — we keep it as an explicit per-call parameter
 * here so a single credential can address multiple bots in the same
 * workspace without re-binding the connection.
 *
 * The activepieces `chatnode` piece ships exactly one action,
 * `askChatbotAction`, which we model as `chatbot.ask`. It is a write-class
 * action on the activepieces side because each call mutates the chat
 * session transcript on the ChatNode side (the answer is persisted under
 * the `chatSessionId`). There are no read actions and no triggers in the
 * upstream piece.
 */
export const chatnodeConnector = declarativeRestConnector({
  kind: 'chatnode',
  displayName: 'ChatNode',
  description:
    'Ask a trained ChatNode AI chatbot a question and receive a generated reply grounded in its workspace knowledge base.',
  auth: {
    kind: 'api-key',
    hint: 'ChatNode workspace API key. Generate one from the ChatNode dashboard → Settings → API.',
  },
  // ChatNode is a generic AI chatbot Q&A surface, not a CRM/support
  // ticketing system — `other` is the most honest UI bucket.
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.chatnode.ai/api/v2',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
  },
  capabilities: [
    {
      name: 'chatbot.ask',
      class: 'mutation',
      description:
        'Send a user message to a trained ChatNode bot and receive a generated reply. Pass `chatSessionId` to continue an existing conversation; omit it to start a new session (ChatNode mints a fresh id server-side).',
      parameters: {
        type: 'object',
        properties: {
          botId: {
            type: 'string',
            description:
              'Target bot id. Find it in the ChatNode dashboard under the bot URL (…/bots/{botId}).',
          },
          message: {
            type: 'string',
            description: 'The user message to send to the bot.',
          },
          chatSessionId: {
            type: 'string',
            description:
              'Optional chat session id to keep a single conversation across calls. Find it in the chat URL after `/chats/`. If omitted, ChatNode generates a new session id and returns it on the response.',
          },
        },
        required: ['botId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/bots/{botId}/ask',
        body: {
          message: '{message}',
          chatSessionId: '{chatSessionId}',
        },
      },
      // Each ask appends to the session transcript and produces a
      // non-deterministic LLM reply; replay yields a different answer and
      // a new transcript row. Caller-owned dedupe only.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
