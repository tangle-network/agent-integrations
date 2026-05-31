import { declarativeRestConnector } from './declarative-rest.js'

export const captainDataConnector = declarativeRestConnector({
  kind: 'captain-data',
  displayName: 'Captain Data',
  description: 'Launch Captain Data workflows and fetch job results via the public API.',
  auth: { kind: 'api-key', hint: 'Captain Data API key (x-api-key header) tied to a project.' },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.captaindata.com/v3',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/workspaces' },
  capabilities: [
    {
      name: 'launchWorkflow',
      class: 'mutation',
      description: 'Launch a Captain Data workflow with the provided inputs and steps.',
      parameters: {
        type: 'object',
        properties: {
          job: { type: 'string', description: 'Workflow (job) UUID to launch.' },
          jobName: { type: 'string', description: 'Optional run label surfaced in the Captain Data UI.' },
          inputs: {
            type: 'object',
            description: 'Workflow inputs keyed by input name.',
            additionalProperties: true,
          },
          steps: {
            type: 'object',
            description: 'Per-step configuration keyed by step id.',
            additionalProperties: true,
          },
          delay: { type: 'number', description: 'Delay in seconds before execution begins.' },
        },
        required: ['job', 'inputs'],
      },
      request: {
        method: 'POST',
        path: '/workflows/{job}/run',
        body: {
          name: '{jobName}',
          inputs: '{inputs}',
          steps: '{steps}',
          delay: '{delay}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'getJobResults',
      class: 'read',
      description: 'Fetch the results of a previously launched Captain Data workflow run.',
      parameters: {
        type: 'object',
        properties: {
          job: { type: 'string', description: 'Workflow (job) UUID the run belongs to.' },
          runId: { type: 'string', description: 'Run UUID returned by launchWorkflow.' },
        },
        required: ['job', 'runId'],
      },
      request: {
        method: 'GET',
        path: '/workflows/{job}/runs/{runId}/results',
      },
    },
  ],
})
