import { declarativeRestConnector } from './declarative-rest.js'

// PhantomBuster — Launch PhantomBuster Phantoms (automation agents) that scrape and extract data from sites like LinkedIn, then retrieve their output and results.
// Auth: api-key. Base: https://api.phantombuster.com/api/v2. Docs: https://hub.phantombuster.com/reference/post_agents-launch
export const phantombusterConnector = declarativeRestConnector({
  kind: 'phantombuster',
  displayName: 'PhantomBuster',
  description: 'Launch PhantomBuster Phantoms (automation agents) that scrape and extract data from sites like LinkedIn, then retrieve their output and results.',
  auth: {
    kind: 'api-key',
    hint: 'API key from your PhantomBuster dashboard (Workspace settings -> API key). Sent in the X-Phantombuster-Key header.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.phantombuster.com/api/v2',
  credentialPlacement: { kind: 'header', header: 'X-Phantombuster-Key' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/agents/fetch-all' },
  capabilities: [
    {
      name: 'agents.fetch_all',
      class: 'read',
      description: 'List all Phantoms (agents) in the current organization.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/agents/fetch-all' },
    },
    {
      name: 'agents.fetch',
      class: 'read',
      description: 'Fetch the configuration and metadata of a single Phantom by its agent id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Id of the agent (Phantom) to fetch.' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/agents/fetch', query: { id: '{id}' } },
    },
    {
      name: 'agents.launch',
      class: 'mutation',
      description: 'Launch a Phantom (agent), optionally passing arguments, and start a new run (container).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id of the agent (Phantom) to launch.' },
          argument: {
            type: 'object',
            description: 'JSON object of arguments overriding the Phantom\'s saved configuration for this run.',
          },
          bonusArgument: {
            type: 'object',
            description: 'Additional one-off arguments merged for this launch only.',
          },
          saveArgument: {
            type: 'boolean',
            description: 'Persist the provided argument as the Phantom\'s default configuration.',
          },
          manualLaunch: { type: 'boolean', description: 'Mark the launch as manual.' },
        },
        required: ['id'],
      },
      request: {
        method: 'POST',
        path: '/agents/launch',
        body: {
          id: '{id}',
          argument: '{argument}',
          bonusArgument: '{bonusArgument}',
          saveArgument: '{saveArgument}',
          manualLaunch: '{manualLaunch}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'agents.fetch_output',
      class: 'read',
      description: 'Retrieve the console output and most recent container status of a Phantom\'s run by agent id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id of the agent to fetch output from.' },
          fromOutputPos: {
            type: 'number',
            description: 'Position from which to start returning output.',
          },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/agents/fetch-output',
        query: { id: '{id}', fromOutputPos: '{fromOutputPos}' },
      },
    },
    {
      name: 'containers.fetch_output',
      class: 'read',
      description: 'Retrieve the console output of a specific Phantom run (container) by its container id.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Id of the container (run) to fetch output from.',
          },
        },
        required: ['id'],
      },
      request: { method: 'GET', path: '/containers/fetch-output', query: { id: '{id}' } },
    },
  ],
})
