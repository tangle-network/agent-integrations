import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Comfy.ICU adapter — hosted ComfyUI runner at https://comfy.icu/api/v1/.
 *
 * Auth: API key, forwarded as `Authorization: Bearer <token>` per Comfy.ICU's
 * REST docs. The catalog maps four actions and three triggers; only actions
 * are surfaced as capabilities here (triggers are out-of-band webhooks
 * configured by the user in the Comfy.ICU UI).
 *
 * Capability slugs mirror the upstream `id` fields verbatim so trace events
 * cross-reference the activepieces catalog one-to-one.
 */
export const comfyicuConnector = declarativeRestConnector({
  kind: 'comfyicu',
  displayName: 'Comfy.ICU',
  description: 'Submit ComfyUI workflow runs on Comfy.ICU and poll run status / output.',
  auth: { kind: 'api-key', hint: 'Comfy.ICU API key from account settings.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://comfy.icu/api/v1',
  capabilities: [
    {
      name: 'list.workflows',
      class: 'read',
      description: 'List the ComfyUI workflows visible to the account.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/workflows',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'get.run.status',
      class: 'read',
      description: 'Fetch the status of a specific workflow run.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string' },
          run_id: { type: 'string' },
        },
        required: ['workflow_id', 'run_id'],
      },
      request: {
        method: 'GET',
        path: '/workflows/{workflow_id}/runs/{run_id}',
      },
    },
    {
      name: 'get.run.output',
      class: 'read',
      description: 'Fetch the rendered output (images / files / JSON) of a completed workflow run.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string' },
          run_id: { type: 'string' },
        },
        required: ['workflow_id', 'run_id'],
      },
      request: {
        method: 'GET',
        path: '/workflows/{workflow_id}/runs/{run_id}/output',
      },
    },
    {
      name: 'submit.workflow.run',
      class: 'mutation',
      description:
        'Submit a workflow execution. `prompt` is the API workflow JSON copied from the Comfy.ICU History page; `webhook` is an optional callback URL.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'string' },
          prompt: { type: 'object' },
          webhook: { type: 'string' },
          files: { type: 'object' },
          accelerator: { type: 'string' },
        },
        required: ['workflow_id', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/workflows/{workflow_id}/runs',
        body: {
          prompt: '{prompt}',
          webhook: '{webhook}',
          files: '{files}',
          accelerator: '{accelerator}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
