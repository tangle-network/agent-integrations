import { declarativeRestConnector } from './declarative-rest.js'

export const contextualAiConnector = declarativeRestConnector({
  kind: 'contextual-ai',
  displayName: 'Contextual AI',
  description: 'Integrate with Contextual AI to automate document processing and AI workflows.',
  auth: { kind: 'api-key', hint: 'Your Contextual AI API key.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.contextual.ai/v1',
  test: { method: 'GET', path: '/agents' },
  capabilities: [
    {
      name: 'query.agent',
      class: 'read',
      description: 'Query an agent with a message.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The ID of the agent to query' },
          message: { type: 'string', description: 'The message to send to the agent' },
          conversationId: { type: 'string', description: 'Optional conversation ID to continue an existing conversation' },
          includeRetrievalContent: { type: 'boolean', description: 'Include the text of retrieved contents in the response' },
        },
        required: ['agentId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/agents/{agentId}/query',
        body: {
          message: '{message}',
          conversationId: '{conversationId}',
          includeRetrievalContent: '{includeRetrievalContent}',
        },
      },
    },
    {
      name: 'generate',
      class: 'mutation',
      description: 'Generate a response using Contextual AI models.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The text prompt to generate a response for' },
          model: { type: 'string', description: 'The version of Contextual AI to use' },
          maxTokens: { type: 'integer', description: 'Maximum number of tokens to generate (default: 1024)' },
          temperature: { type: 'number', description: 'Sampling temperature (0.0 to 1.0)' },
          topP: { type: 'number', description: 'Nucleus sampling parameter (0.0 to 1.0)' },
          systemPrompt: { type: 'string', description: 'Optional system prompt for the model' },
          knowledge: { type: 'object', description: 'Optional knowledge sources to ground the generation' },
          avoidCommentary: { type: 'boolean', description: 'Avoid providing additional conversational commentary not grounded in context' },
        },
        required: ['prompt', 'model'],
      },
      request: {
        method: 'POST',
        path: '/generate',
        body: {
          prompt: '{prompt}',
          model: '{model}',
          maxTokens: '{maxTokens}',
          temperature: '{temperature}',
          topP: '{topP}',
          systemPrompt: '{systemPrompt}',
          knowledge: '{knowledge}',
          avoidCommentary: '{avoidCommentary}',
        },
      },
    },
    {
      name: 'ingest.document',
      class: 'mutation',
      description: 'Upload a document to a datastore for ingestion.',
      parameters: {
        type: 'object',
        properties: {
          datastoreId: { type: 'string', description: 'The ID of the datastore to upload to' },
          file: { type: 'string', description: 'The document file to upload (PDF, HTML, DOC, DOCX, PPT, PPTX)' },
          customMetadata: { type: 'object', description: 'Optional custom metadata as key-value pairs' },
          configuration: { type: 'string', description: 'Optional configuration override in JSON format' },
        },
        required: ['datastoreId', 'file'],
      },
      request: {
        method: 'POST',
        path: '/datastores/{datastoreId}/documents',
        body: {
          file: '{file}',
          customMetadata: '{customMetadata}',
          configuration: '{configuration}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'parse.file',
      class: 'mutation',
      description: 'Parse a document file with configurable parsing modes.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'The document file to parse' },
          parseMode: { type: 'string', description: 'Parsing mode - basic for simple text, standard for complex documents' },
          pageRange: { type: 'string', description: 'Optional page range to parse (e.g., 1-10)' },
          enableDocumentHierarchy: { type: 'boolean', description: 'Add table of contents with document structure' },
          enableSplitTables: { type: 'boolean', description: 'Split large tables into multiple tables with headers' },
          maxSplitTableCells: { type: 'integer', description: 'Threshold for splitting large tables' },
          figureCaptionMode: { type: 'string', description: 'How thorough figure captions should be' },
        },
        required: ['file', 'parseMode'],
      },
      request: {
        method: 'POST',
        path: '/parse',
        body: {
          file: '{file}',
          parseMode: '{parseMode}',
          pageRange: '{pageRange}',
          enableDocumentHierarchy: '{enableDocumentHierarchy}',
          enableSplitTables: '{enableSplitTables}',
          maxSplitTableCells: '{maxSplitTableCells}',
          figureCaptionMode: '{figureCaptionMode}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'create.agent',
      class: 'mutation',
      description: 'Create a new agent with optional configuration.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new agent' },
          description: { type: 'string', description: 'Optional description of the agent' },
          systemPrompt: { type: 'string', description: 'Optional system prompt for the agent' },
          filterPrompt: { type: 'string', description: 'Optional prompt for filtering retrieved chunks' },
          datastoreIds: { type: 'array', items: { type: 'string' }, description: 'Datastores to associate with the agent' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/agents',
        body: {
          name: '{name}',
          description: '{description}',
          systemPrompt: '{systemPrompt}',
          filterPrompt: '{filterPrompt}',
          datastoreIds: '{datastoreIds}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invite.users',
      class: 'mutation',
      description: 'Invite users to a tenant.',
      parameters: {
        type: 'object',
        properties: {
          tenantShortName: { type: 'string', description: 'The short name of the tenant/workspace' },
          users: { type: 'array', items: { type: 'object' }, description: 'List of users to invite' },
          email: { type: 'string', description: 'Email address of the user to invite' },
        },
        required: ['tenantShortName', 'users'],
      },
      request: {
        method: 'POST',
        path: '/tenants/{tenantShortName}/invitations',
        body: {
          users: '{users}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'create.datastore',
      class: 'mutation',
      description: 'Create a new datastore for document storage and retrieval.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new datastore' },
          description: { type: 'string', description: 'Optional description of the datastore' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/datastores',
        body: {
          name: '{name}',
          description: '{description}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
