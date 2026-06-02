import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Flipando AI connector.
 *
 * Flipando is a no-code platform for assembling LLM-backed "Apps" — small
 * prompt-and-tool pipelines a workspace owner has provisioned in the
 * Flipando UI. The external surface lets a caller list the workspace's
 * apps, run a configured app against an input payload, poll the resulting
 * async task, and (for the generator surface) ask Flipando to scaffold a
 * brand-new app from a high-level description.
 *
 * Auth is a tenant-issued API key delivered as a bearer token; there is no
 * OAuth flow. The category in the activepieces catalog is "workflow", which
 * the connector manifest does not enumerate, so the closest accurate UI
 * bucket is `other`.
 *
 * Consistency: `runApp`, `runAppGenerator`, and any path that triggers an
 * LLM call is non-deterministic, metered, and externally-effecting. CAS
 * posture is `none` (the caller owns dedupe) and `externalEffect: true`
 * so the orchestrator's dry-run policy refuses to execute these in
 * preview mode. `getTask` and `getAllApps` are pure reads.
 */
export const flipandoConnector = declarativeRestConnector({
  kind: 'flipando',
  displayName: 'Flipando AI',
  description:
    'Run configured Flipando AI apps over inputs, poll their async task results, list workspace apps, and scaffold new apps from a description.',
  auth: {
    kind: 'api-key',
    hint: 'Flipando workspace API key (Settings → API). Sent as a bearer token on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://www.flipando.ai/api/v2',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // Flipando does not document a dedicated health probe, and the catalog
  // does not surface one either. The cheapest authenticated GET is the
  // app listing, which doubles as a credential check.
  test: { method: 'GET', path: '/apps' },
  capabilities: [
    {
      name: 'apps.list',
      class: 'read',
      description:
        'List every Flipando app the API key has access to in the current workspace, including the inputs each app expects.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/apps' },
    },
    {
      name: 'apps.run',
      class: 'mutation',
      description:
        'Run a configured Flipando app against an input payload. Returns a task handle the caller polls with tasks.get. Each invocation is billed and side-effecting.',
      parameters: {
        type: 'object',
        properties: {
          application_id: {
            type: 'number',
            description: 'Numeric ID of the Flipando app to execute (from apps.list).',
          },
          inputs_data: {
            type: 'object',
            description:
              'Key-value pairs matching the app input schema. Keys must match the variable names declared on the app in the Flipando UI.',
          },
          file: {
            type: 'string',
            description:
              'Optional base64-encoded document payload for apps that accept file inputs (PDF, DOCX, image, etc.). Omit for apps with no file input.',
          },
          file_description: {
            type: 'string',
            description: 'Required when `file` is provided. Short caption describing the uploaded document.',
          },
        },
        required: ['application_id', 'inputs_data'],
      },
      request: {
        method: 'POST',
        path: '/apps/{application_id}/run',
        body: {
          inputs_data: '{inputs_data}',
          file: '{file}',
          file_description: '{file_description}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'apps.generate',
      class: 'mutation',
      description:
        'Scaffold a brand-new Flipando app from a high-level description. Creates a workspace-visible app the user can then refine in the UI. Billed and side-effecting.',
      parameters: {
        type: 'object',
        properties: {
          inputs_data: {
            type: 'object',
            description:
              'Key-value description of the app the caller wants Flipando to generate — typically { name, description, inputs, output_format }.',
          },
          is_new_app_private: {
            type: 'boolean',
            description:
              'When true, the generated app is created as private to the workspace. When false, it is shared with the public Flipando directory.',
          },
        },
        required: ['inputs_data', 'is_new_app_private'],
      },
      request: {
        method: 'POST',
        path: '/apps/generator',
        body: {
          inputs_data: '{inputs_data}',
          is_new_app_private: '{is_new_app_private}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'tasks.cancel',
      class: 'mutation',
      description:
        'Cancel an in-flight Flipando task (the async handle returned by apps.run or apps.generate). Reaches the task even after the worker has started; idempotent — cancelling an already-completed or already-cancelled task returns the terminal state.',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'Task ID returned by apps.run or apps.generate.',
          },
        },
        required: ['task_id'],
      },
      request: {
        method: 'POST',
        path: '/tasks/{task_id}/cancel',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tasks.get',
      class: 'read',
      description:
        'Poll a Flipando task by ID and return its status plus the final output once the underlying app run has finished.',
      parameters: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'Task ID returned by apps.run or apps.generate.',
          },
        },
        required: ['task_id'],
      },
      request: { method: 'GET', path: '/tasks/{task_id}' },
    },
  ],
})
