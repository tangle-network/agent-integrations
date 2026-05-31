import { declarativeRestConnector } from './declarative-rest.js'

/**
 * AgentX (https://www.agentx.so) is a hosted multi-agent platform that
 * exposes conversation, message, and agent-search endpoints. The public REST
 * surface is rooted at `/api/v1` and authenticated with a personal API key
 * presented as `Authorization: Bearer <key>` (the same shape Activepieces
 * uses for its piece-agentx connector).
 *
 * Capabilities mirror the upstream actions array verbatim:
 *   - createConversationWithSingleAgent  → conversations.createWithSingleAgent
 *   - sendMessageToExistingConversation  → conversations.sendMessage
 *   - findMessage                        → messages.find
 *   - searchAgents                       → agents.search
 *   - findConversation                   → conversations.find
 *
 * Triggers (newAgent, newConversation) are surfaced upstream as Activepieces
 * polling triggers; the declarative-REST connector models them as read
 * capabilities so the agent can poll on its own schedule.
 */
export const agentxConnector = declarativeRestConnector({
  kind: 'agentx',
  displayName: 'AgentX',
  description:
    'Send messages to AgentX conversations, search agents, and inspect conversation/message history.',
  auth: { kind: 'api-key', hint: 'AgentX API key (Settings → API Keys).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.agentx.so/api/v1',
  test: { method: 'GET', path: '/agents' },
  capabilities: [
    {
      name: 'conversations.createWithSingleAgent',
      class: 'mutation',
      description:
        'Create a new conversation with a single agent and send the first message.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The agent that will own the conversation.' },
          message: { type: 'string', description: 'First message sent to the agent.' },
          agentMode: {
            type: 'string',
            description: 'How the agent should respond (e.g. chat, autonomous).',
          },
          context: {
            type: 'integer',
            description: 'Number of previous messages to include as memory context (0 = max).',
          },
          conversationName: {
            type: 'string',
            description: 'Optional human-readable conversation title.',
          },
        },
        required: ['agentId', 'message', 'agentMode'],
      },
      request: {
        method: 'POST',
        path: '/conversations',
        body: {
          agentId: '{agentId}',
          message: '{message}',
          agentMode: '{agentMode}',
          context: '{context}',
          name: '{conversationName}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.sendMessage',
      class: 'mutation',
      description: 'Send a message to an existing AgentX conversation.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Target conversation ID.' },
          message: { type: 'string', description: 'Message body to send.' },
          agentMode: {
            type: 'string',
            description: 'How the agent should respond on this turn.',
          },
          context: {
            type: 'integer',
            description: 'Number of previous messages to include as memory context.',
          },
        },
        required: ['conversationId', 'message', 'agentMode'],
      },
      request: {
        method: 'POST',
        path: '/conversations/{conversationId}/messages',
        body: {
          message: '{message}',
          agentMode: '{agentMode}',
          context: '{context}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.find',
      class: 'read',
      description:
        'Search messages by conversation, free-text search term, or exact message ID.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: {
            type: 'string',
            description: 'Restrict the search to a single conversation.',
          },
          searchTerm: {
            type: 'string',
            description: 'Text to search for in message content. Omit if searching by ID.',
          },
          messageId: {
            type: 'string',
            description: 'Exact message ID lookup (overrides searchTerm).',
          },
          limit: { type: 'integer', description: 'Maximum messages to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/messages',
        query: {
          conversationId: '{conversationId}',
          q: '{searchTerm}',
          id: '{messageId}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'agents.search',
      class: 'read',
      description: 'Search the workspace agent registry by name or exact agent ID.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Partial name match against the agent display name.',
          },
          agentId: { type: 'string', description: 'Exact agent ID.' },
          limit: { type: 'integer', description: 'Maximum agents to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/agents',
        query: { name: '{name}', id: '{agentId}', limit: '{limit}' },
      },
    },
    {
      name: 'conversations.find',
      class: 'read',
      description:
        'Find conversations by exact ID, name/title, or conversation type.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Exact conversation ID.' },
          conversationName: {
            type: 'string',
            description: 'Name, title, or ID-substring match.',
          },
          type: {
            type: 'string',
            description: 'Conversation type filter (e.g. single-agent, multi-agent).',
          },
          limit: { type: 'integer', description: 'Maximum conversations to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/conversations',
        query: {
          id: '{conversationId}',
          name: '{conversationName}',
          type: '{type}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'agents.list.recent',
      class: 'read',
      description:
        'List recently created agents — used by the newAgent polling trigger upstream.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return agents created after this point.',
          },
          limit: { type: 'integer', description: 'Maximum agents to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/agents',
        query: { since: '{since}', sort: 'createdAt:desc', limit: '{limit}' },
      },
    },
    {
      name: 'conversations.list.recent',
      class: 'read',
      description:
        'List recently created conversations — used by the newConversation polling trigger upstream.',
      parameters: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return conversations created after this point.',
          },
          limit: { type: 'integer', description: 'Maximum conversations to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/conversations',
        query: { since: '{since}', sort: 'createdAt:desc', limit: '{limit}' },
      },
    },
  ],
})
