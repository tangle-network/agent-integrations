import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Chatling connector.
 *
 * Chatling lets tenants build AI chatbots trained on their own data
 * (documents, URLs, custom Q&A). The integration surface exposes two
 * write actions — sending a message to a configured chatbot and
 * provisioning a new chatbot — and two event-shaped triggers that the
 * SDK surfaces as read capabilities the orchestrator can poll
 * (new-conversation, new-contact). Webhook-style push isn't part of
 * the declarative-REST contract, so we model the trigger surface as
 * authoritative reads.
 *
 * Auth is a tenant-issued API key delivered as a bearer token. There
 * is no OAuth flow — Chatling does not expose a 3-legged client.
 *
 * Consistency: send.message is non-deterministic (LLM-backed) and
 * carries metered billing, so CAS is `none` and `externalEffect: true`.
 * create.chatbot is a provisioning call against the tenant's account;
 * Chatling does not honour a client-supplied idempotency key, so the
 * caller owns dedupe. The read-shaped triggers are authoritative —
 * Chatling is the source of truth for its conversation log.
 */
export const chatlingConnector = declarativeRestConnector({
  kind: 'chatling',
  displayName: 'Chatling',
  description:
    'Send messages to Chatling chatbots, provision new chatbots, and poll conversation and contact streams from a Chatling workspace.',
  auth: {
    kind: 'api-key',
    hint: 'Chatling API key (Workspace Settings → API Keys). Sent as a bearer token on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chatling.ai/v2',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  capabilities: [
    {
      name: 'send.message',
      class: 'mutation',
      description:
        'Send a user message to a configured Chatling chatbot and receive the assistant response synthesized over the chatbot’s trained corpus. Each call is a metered query against the tenant plan.',
      parameters: {
        type: 'object',
        properties: {
          chatbot_id: {
            type: 'string',
            description: 'ID of the chatbot to send the message to (workspace → chatbot → settings).',
          },
          message: {
            type: 'string',
            description: 'The user message to send to the chatbot.',
          },
          session_id: {
            type: 'string',
            description:
              'Conversation session ID. Pass the same value across turns to maintain context; omit or rotate for a fresh conversation.',
          },
          temperature: {
            type: 'number',
            description: 'Controls response randomness (0 = focused, 1 = creative). Defaults to the chatbot configuration when omitted.',
          },
          instructions: {
            type: 'string',
            description: 'Optional per-call instructions that augment the chatbot’s base system prompt for this turn only.',
          },
        },
        required: ['chatbot_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/chatbots/{chatbot_id}/chat',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'create.chatbot',
      class: 'mutation',
      description:
        'Provision a new Chatling chatbot in the authenticated workspace. Returns the new chatbot ID, which the caller should persist before sending messages.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Human-readable name for the new chatbot.',
          },
          message: {
            type: 'string',
            description: 'Initial welcome message the chatbot greets users with.',
          },
          temperature: {
            type: 'number',
            description: 'Default response temperature (0 = focused, 1 = creative). Optional; defaults to 0.',
          },
          instructions: {
            type: 'object',
            description:
              'Additional instructions object tailoring the chatbot’s behaviour (system prompt, persona, refusal policy).',
          },
        },
        required: ['name', 'message'],
      },
      request: {
        method: 'POST',
        path: '/chatbots',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'conversations.list',
      class: 'read',
      description:
        'List recent conversations for a Chatling chatbot. Backs the activepieces "new conversation" trigger — callers poll this endpoint and diff against the last observed conversation ID.',
      parameters: {
        type: 'object',
        properties: {
          chatbot_id: {
            type: 'string',
            description: 'ID of the chatbot whose conversations to list.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of conversations to return (server-capped).',
          },
          cursor: {
            type: 'string',
            description: 'Opaque pagination cursor returned by a prior response.',
          },
        },
        required: ['chatbot_id'],
      },
      request: {
        method: 'GET',
        path: '/chatbots/{chatbot_id}/conversations',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'contacts.list',
      class: 'read',
      description:
        'List recent contacts captured by a Chatling chatbot (users who left an email or identifier in chat). Backs the activepieces "new contact" trigger.',
      parameters: {
        type: 'object',
        properties: {
          chatbot_id: {
            type: 'string',
            description: 'ID of the chatbot whose contacts to list.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of contacts to return (server-capped).',
          },
          cursor: {
            type: 'string',
            description: 'Opaque pagination cursor returned by a prior response.',
          },
        },
        required: ['chatbot_id'],
      },
      request: {
        method: 'GET',
        path: '/chatbots/{chatbot_id}/contacts',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
    },
  ],
})
