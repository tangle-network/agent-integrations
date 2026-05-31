import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Copy.ai connector.
 *
 * Copy.ai exposes a Workflows API: tenants design a workflow in the Copy.ai
 * UI (a chain of prompt + retrieval steps that produces marketing copy or
 * other structured text output), then external callers trigger that
 * workflow with a JSON input payload, poll the run for status, and read
 * the final outputs.
 *
 * Catalog action surface (Activepieces piece-copy-ai 0.1.3):
 *   - run.workflow              -> runWorkflowAction
 *   - get.workflow.run.status   -> getWorkflowRunStatusAction
 *   - get.workflow.run.outputs  -> getWorkflowRunOutputsAction
 * The catalog also declares a workflowRunCompletedTrigger which the
 * vendor implements as polling, not webhooks; surfacing it here would
 * require a poll-driver capability that this declarative-REST shape does
 * not model, so triggers are intentionally not exposed and the runtime
 * must compose status polling on top of the read capabilities below.
 *
 * Auth: tenant-issued API key, sent via the `x-copy-ai-api-key` header on
 * every request (Copy.ai does not accept Bearer placement).
 *
 * Consistency:
 *   - run.workflow is LLM-backed, non-deterministic, and bills the tenant
 *     on every invocation. CAS = `none`, externalEffect = true so the
 *     orchestrator's dry-run policy treats it as side-effecting and
 *     callers own dedupe (workflowRunId is server-issued so we cannot
 *     supply a client idempotency key).
 *   - status/outputs reads are advisory snapshots of an in-flight run.
 */
export const copyAiConnector = declarativeRestConnector({
  kind: 'copy-ai',
  displayName: 'Copy.ai',
  description:
    'Run Copy.ai workflows from agents and read back run status and outputs. Workflows are configured in the Copy.ai UI and triggered here by workflowId with a JSON input payload.',
  auth: {
    kind: 'api-key',
    hint: 'Copy.ai workspace API key (Workspace Settings → API). Sent in the x-copy-ai-api-key header on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.copy.ai/api',
  credentialPlacement: { kind: 'header', header: 'x-copy-ai-api-key' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // Copy.ai does not document a cheap auth-probe endpoint; issuing a
  // workflow run as a health check would bill the tenant, so test is
  // intentionally omitted.
  capabilities: [
    {
      name: 'workflow.run',
      class: 'mutation',
      description:
        'Trigger a Copy.ai workflow by ID with a JSON inputs object. Returns the workflowRunId that subsequent status and outputs reads use to track the asynchronous run.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description:
              'Copy.ai workflow ID copied from the workflow editor URL or the Workflows list.',
          },
          startVariables: {
            type: 'object',
            description:
              'Inputs payload for the workflow. Keys must match the input variable names declared in the Copy.ai workflow editor.',
          },
          metadata: {
            type: 'object',
            description:
              'Optional caller-supplied metadata attached to the run record; surfaces back in status and outputs reads.',
          },
        },
        required: ['workflowId', 'startVariables'],
      },
      request: {
        method: 'POST',
        path: '/workflow/{workflowId}/run',
        body: {
          startVariables: '{startVariables}',
          metadata: '{metadata}',
        },
      },
      // LLM-backed run; vendor issues the run ID server-side, so caller
      // cannot supply an idempotency key. Treat as non-idempotent and
      // side-effecting.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'workflow.run.status',
      class: 'read',
      description:
        'Read the current status of a Copy.ai workflow run (queued, running, completed, failed) by workflowRunId.',
      parameters: {
        type: 'object',
        properties: {
          workflowRunId: {
            type: 'string',
            description:
              'workflowRunId returned by workflow.run; identifies the run whose status is being polled.',
          },
        },
        required: ['workflowRunId'],
      },
      request: {
        method: 'GET',
        path: '/workflow/run/{workflowRunId}',
      },
    },
    {
      name: 'workflow.run.outputs',
      class: 'read',
      description:
        'Read the final outputs of a completed Copy.ai workflow run. Returns the workflow output variables keyed by name; callers should first confirm status is completed via workflow.run.status.',
      parameters: {
        type: 'object',
        properties: {
          workflowRunId: {
            type: 'string',
            description:
              'workflowRunId returned by workflow.run; identifies the completed run whose outputs are being read.',
          },
        },
        required: ['workflowRunId'],
      },
      request: {
        method: 'GET',
        path: '/workflow/run/{workflowRunId}/outputs',
      },
    },
  ],
})
