import { declarativeRestConnector } from './declarative-rest.js'

export const memConnector = declarativeRestConnector({
  kind: 'mem',
  displayName: 'Mem',
  description: 'Capture and organize notes in Mem.ai — append raw content as mems and create or delete structured notes.',
  auth: { kind: 'api-key', hint: 'Mem.ai API key from the Mem integrations settings.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.mem.ai/v0',
  test: { method: 'GET', path: '/notes' },
  capabilities: [
    {
      name: 'mem.create',
      class: 'mutation',
      description:
        'Append raw content into the Mem inbox. Optional instructions and context guide how Mem processes the input.',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          instructions: { type: 'string' },
          context: { type: 'string' },
        },
        required: ['input'],
      },
      request: {
        method: 'POST',
        path: '/mems',
        body: { input: '{input}', instructions: '{instructions}', context: '{context}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description:
        'Create a Markdown note in Mem. The first line of content is treated as the title. Optional id assigns a UUID and add_to_collections attaches the note to collections.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          id: { type: 'string' },
          add_to_collections: { type: 'object' },
        },
        required: ['content'],
      },
      request: {
        method: 'POST',
        path: '/notes',
        body: {
          content: '{content}',
          id: '{id}',
          add_to_collections: '{add_to_collections}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'notes.delete',
      class: 'mutation',
      description: 'Delete a note from Mem by its ID.',
      parameters: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id'],
      },
      request: { method: 'DELETE', path: '/notes/{note_id}' },
      cas: 'native-idempotency',
    },
  ],
})
