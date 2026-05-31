import { declarativeRestConnector } from './declarative-rest.js'

export const dustConnector = declarativeRestConnector({
  kind: 'dust',
  displayName: 'Dust',
  description:
    'Run Dust assistant conversations, attach fragments and files, and manage data-source documents in a Dust workspace.',
  auth: {
    kind: 'api-key',
    hint: 'Dust API key (sk-…); the workspace id is supplied per-request via the workspaceId input.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://dust.tt/api/v1',
  test: { method: 'GET', path: '/w/{workspaceId}/data_sources' },
  capabilities: [
    {
      name: 'conversations.create',
      class: 'mutation',
      description:
        'Create a new Dust assistant conversation, optionally seeding it with a first user message and a title.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          visibility: { type: 'string' },
          message: {
            type: 'object',
            description:
              'Optional first message — Dust expects { content, mentions, context } where context describes the user identity.',
          },
          contentFragment: {
            type: 'object',
            description:
              'Optional content fragment seeded into the conversation (text + content type + name).',
          },
        },
        required: ['workspaceId'],
      },
      request: {
        method: 'POST',
        path: '/w/{workspaceId}/assistant/conversations',
        body: {
          title: '{title}',
          visibility: '{visibility}',
          message: '{message}',
          contentFragment: '{contentFragment}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.reply',
      class: 'mutation',
      description:
        'Append a user message to an existing Dust conversation, triggering the assistant to reply.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          conversationId: { type: 'string' },
          content: { type: 'string' },
          mentions: {
            type: 'array',
            description:
              'Assistant mentions — each entry like { configurationId } selects which Dust assistant should answer.',
            items: {
              type: 'object',
              properties: { configurationId: { type: 'string' } },
              required: ['configurationId'],
            },
          },
          context: {
            type: 'object',
            description:
              'Caller identity / locale context Dust attaches to the message (username, timezone, profilePictureUrl, etc).',
          },
        },
        required: ['workspaceId', 'conversationId', 'content', 'mentions'],
      },
      request: {
        method: 'POST',
        path: '/w/{workspaceId}/assistant/conversations/{conversationId}/messages',
        body: {
          content: '{content}',
          mentions: '{mentions}',
          context: '{context}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.get',
      class: 'read',
      description: 'Fetch a Dust conversation, including its message tree and any attached fragments.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          conversationId: { type: 'string' },
        },
        required: ['workspaceId', 'conversationId'],
      },
      request: {
        method: 'GET',
        path: '/w/{workspaceId}/assistant/conversations/{conversationId}',
      },
    },
    {
      name: 'conversations.addFragment',
      class: 'mutation',
      description:
        'Attach a content fragment (inline text or a previously uploaded file) to an existing Dust conversation. fileId, when supplied, takes precedence over the inline fragment payload.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          conversationId: { type: 'string' },
          title: { type: 'string' },
          fragmentName: { type: 'string' },
          fileId: {
            type: 'string',
            description:
              'ID of a file previously created with files.upload — supplying it skips the inline content path.',
          },
          contentType: { type: 'string' },
          content: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['workspaceId', 'conversationId', 'title'],
      },
      request: {
        method: 'POST',
        path: '/w/{workspaceId}/assistant/conversations/{conversationId}/content_fragments',
        body: {
          title: '{title}',
          name: '{fragmentName}',
          fileId: '{fileId}',
          contentType: '{contentType}',
          content: '{content}',
          url: '{url}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'files.upload',
      class: 'mutation',
      description:
        'Register a file with Dust so it can be referenced from a content fragment by fileId. The caller supplies the descriptor (name, contentType, size, useCase); the returned id is passed to conversations.addFragment.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          fileName: { type: 'string' },
          contentType: { type: 'string' },
          fileSize: { type: 'integer' },
          useCase: {
            type: 'string',
            description:
              'Why the file is being uploaded — typical values include "conversation" or "tool_output".',
          },
        },
        required: ['workspaceId', 'fileName', 'contentType', 'fileSize', 'useCase'],
      },
      request: {
        method: 'POST',
        path: '/w/{workspaceId}/files',
        body: {
          fileName: '{fileName}',
          contentType: '{contentType}',
          fileSize: '{fileSize}',
          useCase: '{useCase}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.upsert',
      class: 'mutation',
      description:
        'Insert or replace a document in a Dust data source. documentId is caller-supplied so repeated calls with the same id replace prior content (idempotent by document key).',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          datasource: {
            type: 'string',
            description: 'Data-source name (slug) within the workspace.',
          },
          documentId: { type: 'string' },
          content: { type: 'string' },
          sourceUrl: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tag strings indexed alongside the document for retrieval filtering.',
          },
        },
        required: ['workspaceId', 'datasource', 'documentId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/w/{workspaceId}/data_sources/{datasource}/documents/{documentId}',
        body: {
          text: '{content}',
          source_url: '{sourceUrl}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
