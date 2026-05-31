import { declarativeRestConnector } from './declarative-rest.js'

/**
 * AirOps public API: workflows ("apps") are invoked sync or async by their
 * app UUID; async runs return an execution UUID that can be polled via the
 * executions endpoint. The API key is provisioned per workspace and presented
 * as a Bearer token.
 *
 * Reference: https://app.airops.com/public_api
 */
export const airOpsConnector = declarativeRestConnector({
  kind: 'air-ops',
  displayName: 'AirOps',
  description: 'Trigger AirOps workflows (sync or async) and read execution results.',
  auth: {
    kind: 'api-key',
    hint: 'AirOps API key — Workspace Settings → API Keys in your AirOps account.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.airops.com/public_api',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  capabilities: [
    {
      name: 'run.workflow',
      class: 'mutation',
      description: 'Execute an AirOps workflow synchronously and return the result.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'The AirOps workflow (app) UUID to execute.',
          },
          inputs: {
            type: 'object',
            description: 'Input values for the workflow.',
          },
          inputs_schema: {
            type: 'object',
            description: 'Schema defining the workflow inputs (advanced).',
          },
          definition: {
            type: 'object',
            description: 'Custom workflow definition steps (advanced).',
          },
        },
        required: ['app'],
      },
      request: {
        method: 'POST',
        path: '/airops_apps/{app}/execute',
        body: {
          inputs: '{inputs}',
          inputs_schema: '{inputs_schema}',
          definition: '{definition}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'run.workflow.async',
      class: 'mutation',
      description: 'Queue an AirOps workflow for asynchronous execution and return the execution UUID.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'The AirOps workflow (app) UUID to execute.',
          },
          inputs: {
            type: 'object',
            description: 'Input values for the workflow.',
          },
          inputs_schema: {
            type: 'object',
            description: 'Schema defining the workflow inputs (advanced).',
          },
          definition: {
            type: 'object',
            description: 'Custom workflow definition steps (advanced).',
          },
        },
        required: ['app'],
      },
      request: {
        method: 'POST',
        path: '/airops_apps/{app}/async_execute',
        body: {
          inputs: '{inputs}',
          inputs_schema: '{inputs_schema}',
          definition: '{definition}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'get.execution',
      class: 'read',
      description: 'Retrieve a previously queued AirOps workflow execution by its UUID.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'The AirOps workflow (app) UUID.',
          },
          execution_uuid: {
            type: 'string',
            description: 'The UUID of the execution to retrieve.',
          },
        },
        required: ['app', 'execution_uuid'],
      },
      request: {
        method: 'GET',
        path: '/airops_apps/{app}/executions/{execution_uuid}',
      },
    },
  ],
})
