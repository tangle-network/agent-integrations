import { declarativeRestConnector } from './declarative-rest.js'

export const griptapeConnector = declarativeRestConnector({
  kind: 'griptape',
  displayName: 'Griptape Cloud',
  description:
    'Create and run AI agents and structures. Execute assistant runs, structure runs, and manage automated workflows with Griptape Cloud.',
  auth: { kind: 'api-key', hint: 'Griptape Cloud API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.griptape.ai/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'assistants.run.create',
      class: 'mutation',
      description: 'Create an assistant run with input and optional thread settings.',
      parameters: {
        type: 'object',
        properties: {
          assistantId: { type: 'string', description: 'ID of the assistant to run' },
          input: { type: 'string', description: 'Input to provide to the assistant' },
          createNewThread: { type: 'boolean', description: 'Create a new thread for this run' },
          threadId: {
            type: 'string',
            description: 'Optional thread ID to use for the run',
          },
        },
        required: ['assistantId', 'input'],
      },
      request: {
        method: 'POST',
        path: '/assistants/{assistantId}/runs',
        body: {
          input: '{input}',
          thread_id: '{threadId}',
          create_new_thread: '{createNewThread}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'assistants.run.get',
      class: 'read',
      description: 'Retrieve the status and results of an assistant run.',
      parameters: {
        type: 'object',
        properties: {
          assistantId: { type: 'string', description: 'ID of the assistant' },
          runId: { type: 'string', description: 'ID of the run to retrieve' },
        },
        required: ['assistantId', 'runId'],
      },
      request: {
        method: 'GET',
        path: '/assistants/{assistantId}/runs/{runId}',
      },
    },
    {
      name: 'structures.run.create',
      class: 'mutation',
      description: 'Create a structure run with input and input arguments.',
      parameters: {
        type: 'object',
        properties: {
          structureId: { type: 'string', description: 'ID of the structure to run' },
          input: { type: 'string', description: 'Input to provide to the structure' },
          inputArgs: { type: 'object', description: 'Input arguments for the structure run' },
        },
        required: ['structureId', 'input', 'inputArgs'],
      },
      request: {
        method: 'POST',
        path: '/structures/{structureId}/runs',
        body: {
          input: '{input}',
          input_args: '{inputArgs}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'structures.run.get',
      class: 'read',
      description: 'Retrieve the status and results of a structure run.',
      parameters: {
        type: 'object',
        properties: {
          structureId: { type: 'string', description: 'ID of the structure' },
          runId: { type: 'string', description: 'ID of the run to retrieve' },
        },
        required: ['structureId', 'runId'],
      },
      request: {
        method: 'GET',
        path: '/structures/{structureId}/runs/{runId}',
      },
    },
  ],
})
