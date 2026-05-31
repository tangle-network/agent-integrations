import { declarativeRestConnector } from './declarative-rest.js'

/**
 * GuideLite (https://guidelite.ai) is a hosted assistant platform that lets
 * organizations build AI assistants and embed them in lead-capture and
 * workflow surfaces. The public REST surface is rooted at `/api/v1` and
 * authenticated with an API key presented as `Authorization: Bearer <key>` —
 * the same shape the Activepieces `piece-guidelite` connector uses.
 *
 * Capabilities mirror the upstream actions array verbatim:
 *   - sendAPrompt → assistant.sendPrompt
 *
 * The upstream `newLeadSubmission` trigger is a polling trigger; the
 * declarative-REST connector models it as a read capability so the agent can
 * poll for new lead submissions on its own schedule.
 *
 * The catalog category is "workflow", which is not a value in the connector
 * manifest's category union — `other` is the documented fallback for hosted
 * workflow platforms (matches AgentX and other Activepieces workflow pieces).
 */
export const guideliteConnector = declarativeRestConnector({
  kind: 'guidelite',
  displayName: 'GuideLite',
  description:
    'Send prompts to a GuideLite assistant, continue prior conversations, and poll for new lead submissions.',
  auth: { kind: 'api-key', hint: 'GuideLite API key (Workspace → Settings → API Keys).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.guidelite.ai/api/v1',
  test: { method: 'GET', path: '/assistants' },
  capabilities: [
    {
      name: 'assistant.sendPrompt',
      class: 'mutation',
      description:
        'Send an input message to a GuideLite assistant. If conversationId is omitted, a new conversation is created and returned in the response.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The input message to be processed by the assistant.',
          },
          conversationId: {
            type: 'string',
            description:
              'Conversation ID of a previous conversation to continue. Omit to start a new conversation.',
          },
          assistantId: {
            type: 'string',
            description:
              'Optional assistant ID when the workspace has multiple assistants. Defaults to the workspace default assistant.',
          },
        },
        required: ['message'],
      },
      request: {
        method: 'POST',
        path: '/assistants/prompts',
        body: {
          message: '{message}',
          conversationId: '{conversationId}',
          assistantId: '{assistantId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.get',
      class: 'read',
      description: 'Fetch the message history of an existing GuideLite conversation.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Exact conversation ID.' },
          limit: { type: 'integer', description: 'Maximum messages to return.' },
        },
        required: ['conversationId'],
      },
      request: {
        method: 'GET',
        path: '/conversations/{conversationId}',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'conversations.list.recent',
      class: 'read',
      description:
        'List recently active GuideLite conversations in the workspace, ordered by most recent activity.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description:
              'ISO-8601 timestamp; only return conversations updated after this point.',
          },
          assistantId: {
            type: 'string',
            description: 'Restrict the list to a single assistant.',
          },
          limit: { type: 'integer', description: 'Maximum conversations to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/conversations',
        query: {
          since: '{since}',
          assistantId: '{assistantId}',
          sort: 'updatedAt:desc',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'leads.list.recent',
      class: 'read',
      description:
        'List recently submitted leads — used by the newLeadSubmission polling trigger upstream.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description:
              'ISO-8601 timestamp; only return leads submitted after this point.',
          },
          assistantId: {
            type: 'string',
            description: 'Restrict the list to leads captured by a single assistant.',
          },
          limit: { type: 'integer', description: 'Maximum leads to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: {
          since: '{since}',
          assistantId: '{assistantId}',
          sort: 'createdAt:desc',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'assistants.list',
      class: 'read',
      description: 'List assistants configured in the GuideLite workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum assistants to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/assistants',
        query: { limit: '{limit}' },
      },
    },
  ],
})
