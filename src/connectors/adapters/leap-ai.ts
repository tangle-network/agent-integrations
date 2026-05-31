import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Leap AI (Workflows) connector.
 *
 * Leap AI exposes a hosted workflow runtime — a tenant defines a workflow
 * in the Leap dashboard (an arbitrary chain of model + tool steps) and
 * invokes it externally via a workflow ID. The integration surface is
 * therefore two endpoints: kick off a workflow run with an input object,
 * and fetch the status / output of a prior run by run ID.
 *
 * Auth is a tenant-issued API key delivered as a bearer token. There is
 * no OAuth surface.
 *
 * Consistency: workflows are non-deterministic (LLM- and tool-backed) and
 * each run carries external billing-class effects. Runs are async — the
 * caller polls the get-run endpoint until the run reports terminal state.
 * CAS posture for `run.workflow` is `none` (the caller owns the
 * idempotency key by supplying / persisting the resulting run ID).
 */
export const leapAiConnector = declarativeRestConnector({
  kind: 'leap-ai',
  displayName: 'Leap AI',
  description:
    'Trigger Leap AI hosted workflows and fetch their completion state. Workflows execute asynchronously and may invoke any chain of model + tool steps the tenant has configured.',
  auth: {
    kind: 'api-key',
    hint: 'Leap AI API key (Workflows → Settings → API). Sent as a bearer token on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.workflows.leapai.com/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // No documented unauthenticated probe; the run-status endpoint requires
  // a real workflow_run_id, so we omit `test` rather than ship a probe
  // that 404s for every healthy tenant.
  capabilities: [
    {
      name: 'workflows.run',
      class: 'mutation',
      description:
        'Kick off a run of a Leap AI workflow. The call returns immediately with a workflow run ID; the run itself proceeds asynchronously and must be polled via workflows.getRun until it reports a terminal state. An optional webhook URL can be supplied to receive a push notification on completion.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: {
            type: 'string',
            description:
              'ID of the Leap workflow to invoke. Copied from the workflow detail page in the Leap dashboard.',
          },
          webhook_url: {
            type: 'string',
            description:
              'Optional HTTPS URL Leap will POST to with the run’s final output when the workflow reaches a terminal state.',
          },
          input: {
            type: 'object',
            description:
              'Input variables bound into the workflow’s global scope. Shape is workflow-specific and defined by the workflow’s declared inputs.',
            additionalProperties: true,
          },
        },
        required: ['workflow_id', 'input'],
      },
      request: {
        method: 'POST',
        path: '/runs',
        body: {
          workflow_id: '{workflow_id}',
          webhook_url: '{webhook_url}',
          input: '{input}',
        },
      },
      // Leap does not honour a client-supplied idempotency key on the
      // workflow-run endpoint; the workflow_run_id that comes back is the
      // server-assigned dedupe handle. Callers persist that ID.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'workflows.getRun',
      class: 'read',
      description:
        'Fetch the current state of a previously-kicked-off Leap workflow run. Returns the run status, any intermediate step output, and — once the run reaches a terminal state — the workflow’s final output payload.',
      parameters: {
        type: 'object',
        properties: {
          workflow_run_id: {
            type: 'string',
            description:
              'Workflow run ID returned by a prior workflows.run call (or surfaced in the Leap dashboard).',
          },
        },
        required: ['workflow_run_id'],
      },
      request: {
        method: 'GET',
        path: '/runs/{workflow_run_id}',
      },
    },
  ],
})
