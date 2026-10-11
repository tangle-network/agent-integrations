import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Neon serverless Postgres connector (management plane).
 *
 * Authentication: Neon API key delivered as an `Authorization: Bearer` token
 * (Neon also accepts the same value in `X-Api-Key`; Bearer keeps the
 * credential placement uniform with the rest of the catalog). Keys are minted
 * at https://console.neon.tech → Account settings → API keys and can be
 * account- or project-scoped. Project-scoped keys are the right default for
 * agents: they confine every action below to one project. There is no OAuth
 * surface for third parties — the Hub's connection/policy/approval/audit
 * pipeline is the per-user access model.
 *
 * Endpoint surface covered (https://api.neon.tech/reference, REST/JSON at
 * https://api.neon.tech/v2): project lifecycle, branch lifecycle (the killer
 * feature for agents — instant copy-on-write branches make experimentation
 * safe and merging is a re-point of the primary), compute endpoint lifecycle,
 * and operation polling. Telemetry/billing/org-management routes are
 * intentionally omitted — they are account-level, not project data.
 *
 * The data plane (SQL) is deliberately NOT here. Neon computes speak the
 * Postgres wire protocol and each branch has its own connection string; that
 * surface is owned by the existing `postgres` connector (verified TLS,
 * bounded reads). Point a second DataSource at the branch's
 * `postgresql://…/db` string — per-branch credentials, no sharing, and the
 * Hub's per-connection policy gates it independently of the management key.
 */
export const neonConnector = declarativeRestConnector({
  kind: 'neon',
  displayName: 'Neon',
  description:
    'Manage Neon serverless Postgres: projects, instant copy-on-write branches (create, restore, set primary), compute endpoints, and operation history. SQL data access runs through the postgres connector against a branch connection string.',
  auth: {
    kind: 'api-key',
    hint: 'Neon API key from https://console.neon.tech → Account settings → API keys. Prefer a project-scoped key so the connection is confined to one project.',
  },
  category: 'database',
  // Neon's management mutations are asynchronous — create/delete return an
  // operation to poll, and applied state lags the 201. Advisory is the honest
  // default: a caller that must know the outcome polls `operations.*` (the
  // same reasoning as the qdrant connector's last-writer-wins collections).
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.neon.tech',
  credentialPlacement: { kind: 'bearer' },
  // GET /users/me is the canonical cheap authenticated probe — it validates
  // the key without touching any project state.
  test: { method: 'GET', path: '/v2/users/me' },
  capabilities: [
    // ─── Projects ──────────────────────────────────────────────────────
    {
      name: 'projects.list',
      class: 'read',
      description:
        'List projects visible to the API key. Paginated by limit/cursor; optional search filters by name/id.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          cursor: { type: 'string' },
          search: { type: 'string', description: 'Filter by project name or id.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/projects',
        query: { limit: '{limit}', cursor: '{cursor}', search: '{search}' },
        maxResponseBytes: 8 * 1024 * 1024,
      },
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Fetch one project by id (settings, default branch, compute endpoints, history retention).',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
      },
      request: { method: 'GET', path: '/v2/projects/{project_id}' },
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description:
        'Create a project (and its default branch + read-write endpoint). The response includes connection URIs — store the branch password securely, it is shown once.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name (unique within the org).' },
          org_id: { type: 'string', description: 'Target org for the project. Defaults to the key’s own org.' },
          region_id: { type: 'string', description: 'Region for the default endpoint, e.g. aws-us-east-2.' },
          history_retention_seconds: {
            type: 'integer',
            description: 'How long point-in-history restore windows are retained.',
          },
          default_endpoint_autosuspend_hours: { type: 'integer' },
          budget: { type: 'object', description: 'Spend cap for the project (e.g. { max_consumption_per_hour_eu }).' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v2/projects',
        maxResponseBytes: 2 * 1024 * 1024,
        body: {
          project: {
            name: '{name}',
            region_id: '{region_id}',
            history_retention_seconds: '{history_retention_seconds}',
            default_endpoint_autosuspend_hours: '{default_endpoint_autosuspend_hours}',
            budget: '{budget}',
          },
          org_id: '{org_id}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'projects.update',
      class: 'mutation',
      description: 'Update project settings (name, history retention, default endpoint autosuspend, budget).',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          name: { type: 'string' },
          history_retention_seconds: { type: 'integer' },
          default_endpoint_autosuspend_hours: { type: 'integer' },
          budget: { type: 'object' },
        },
        required: ['project_id'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/projects/{project_id}',
        body: {
          project: {
            name: '{name}',
            history_retention_seconds: '{history_retention_seconds}',
            default_endpoint_autosuspend_hours: '{default_endpoint_autosuspend_hours}',
            budget: '{budget}',
          },
        },
      },
      // Re-applying the same PATCH converges to the same project state.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'projects.delete',
      class: 'mutation',
      description: 'Delete a project and every branch/endpoint/data in it. Irreversible.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' } },
        required: ['project_id'],
      },
      request: { method: 'DELETE', path: '/v2/projects/{project_id}' },
      // Replay against a deleted project returns 404 — no double effect.
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // ─── Branches (the agent surface) ─────────────────────────────────
    {
      name: 'branches.list',
      class: 'read',
      description: 'List branches of a project with parent, creation time, and primary flag.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          cursor: { type: 'string' },
        },
        required: ['project_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/projects/{project_id}/branches',
        query: { limit: '{limit}', cursor: '{cursor}' },
        maxResponseBytes: 8 * 1024 * 1024,
      },
    },
    {
      name: 'branches.get',
      class: 'read',
      description: 'Fetch one branch by id (parent, lsn, logical size, primary flag, created_at).',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, branch_id: { type: 'string' } },
        required: ['project_id', 'branch_id'],
      },
      request: { method: 'GET', path: '/v2/projects/{project_id}/branches/{branch_id}' },
    },
    {
      name: 'branches.create',
      class: 'mutation',
      description:
        'Create an instant copy-on-write branch. Pass parent_id to branch from a branch or parent_lsn to fork at a point in history; both default to the project primary. Use branches to experiment safely — an agent can mutate a branch, then branches.restore or set_primary to adopt or discard the result.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          name: { type: 'string', description: 'Branch name; unique within the project.' },
          parent_id: { type: 'string', description: 'Parent branch id. Defaults to the primary branch.' },
          parent_lsn: { type: 'string', description: 'Fork at this log sequence number instead of head.' },
          preserve_non_primary_source_branch: { type: 'boolean' },
          branch_logical_size_limit: { type: 'integer' },
        },
        required: ['project_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/projects/{project_id}/branches',
        maxResponseBytes: 2 * 1024 * 1024,
        body: {
          branch: {
            name: '{name}',
            parent_id: '{parent_id}',
            parent_lsn: '{parent_lsn}',
            preserve_non_primary_source_branch: '{preserve_non_primary_source_branch}',
            branch_logical_size_limit: '{branch_logical_size_limit}',
          },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'branches.delete',
      class: 'mutation',
      description: 'Delete a branch and its compute endpoints. The primary branch cannot be deleted while non-primary branches exist.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, branch_id: { type: 'string' } },
        required: ['project_id', 'branch_id'],
      },
      request: { method: 'DELETE', path: '/v2/projects/{project_id}/branches/{branch_id}' },
      // Replay against a deleted branch returns 404 — no double effect.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'branches.restore',
      class: 'mutation',
      description:
        'Overwrite the branch data from a source branch (source_branch_id) or a point-in-time within the branch’s own history (source_timestamp, ISO-8601). Optionally preserve the pre-restore state under preserve_under_name.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          branch_id: { type: 'string' },
          source_branch_id: { type: 'string', description: 'Restore from this branch’s current state.' },
          source_timestamp: { type: 'string', description: 'ISO-8601 timestamp to restore this branch to.' },
          preserve_under_name: { type: 'string', description: 'Save the overwritten state as a new branch of this name.' },
        },
        required: ['project_id', 'branch_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/projects/{project_id}/branches/{branch_id}/restore',
        body: {
          source_branch_id: '{source_branch_id}',
          source_timestamp: '{source_timestamp}',
          preserve_under_name: '{preserve_under_name}',
        },
      },
      // Restoring from the same source twice converges to the same data.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'branches.set_primary',
      class: 'mutation',
      description:
        'Promote a branch to primary — this is Neon’s merge story: experiment on a branch, then set_primary to make it the project’s default write target. The old primary is demoted, not deleted.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, branch_id: { type: 'string' } },
        required: ['project_id', 'branch_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/projects/{project_id}/branches/{branch_id}/set_as_primary',
        body: {},
      },
      // Re-promoting an already-primary branch has no additional effect.
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // ─── Compute endpoints ────────────────────────────────────────────
    {
      name: 'endpoints.list',
      class: 'read',
      description: 'List compute endpoints of a project (host, branch, type, suspend timeout, autoscaling bounds).',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 }, cursor: { type: 'string' } },
        required: ['project_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/projects/{project_id}/endpoints',
        query: { limit: '{limit}', cursor: '{cursor}' },
        maxResponseBytes: 8 * 1024 * 1024,
      },
    },
    {
      name: 'endpoints.get',
      class: 'read',
      description: 'Fetch one compute endpoint by id. The host field builds the branch’s postgres connection string.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, endpoint_id: { type: 'string' } },
        required: ['project_id', 'endpoint_id'],
      },
      request: { method: 'GET', path: '/v2/projects/{project_id}/endpoints/{endpoint_id}' },
    },
    {
      name: 'endpoints.create',
      class: 'mutation',
      description:
        'Add a compute endpoint for a branch (read_write for the branch head, read_only replicas). Set autoscaling_limit_min_cu/max_cu and suspend_timeout_seconds to size it.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          branch_id: { type: 'string' },
          type: { type: 'string', enum: ['read_write', 'read_only'] },
          autoscaling_limit_min_cu: { type: 'number' },
          autoscaling_limit_max_cu: { type: 'number' },
          suspend_timeout_seconds: { type: 'integer' },
          pooler_enabled: { type: 'boolean' },
          pooler_mode: { type: 'string', enum: ['transaction', 'session', 'direct'] },
        },
        required: ['project_id', 'branch_id', 'type'],
      },
      request: {
        method: 'POST',
        path: '/v2/projects/{project_id}/endpoints',
        body: {
          endpoint: {
            branch_id: '{branch_id}',
            type: '{type}',
            autoscaling_limit_min_cu: '{autoscaling_limit_min_cu}',
            autoscaling_limit_max_cu: '{autoscaling_limit_max_cu}',
            suspend_timeout_seconds: '{suspend_timeout_seconds}',
            pooler_enabled: '{pooler_enabled}',
            pooler_mode: '{pooler_mode}',
          },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'endpoints.update',
      class: 'mutation',
      description: 'Update compute endpoint settings (autoscaling bounds, suspend timeout, pooler).',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          endpoint_id: { type: 'string' },
          autoscaling_limit_min_cu: { type: 'number' },
          autoscaling_limit_max_cu: { type: 'number' },
          suspend_timeout_seconds: { type: 'integer' },
          pooler_enabled: { type: 'boolean' },
          pooler_mode: { type: 'string', enum: ['transaction', 'session', 'direct'] },
        },
        required: ['project_id', 'endpoint_id'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/projects/{project_id}/endpoints/{endpoint_id}',
        body: {
          endpoint: {
            autoscaling_limit_min_cu: '{autoscaling_limit_min_cu}',
            autoscaling_limit_max_cu: '{autoscaling_limit_max_cu}',
            suspend_timeout_seconds: '{suspend_timeout_seconds}',
            pooler_enabled: '{pooler_enabled}',
            pooler_mode: '{pooler_mode}',
          },
        },
      },
      // Re-applying the same PATCH converges to the same endpoint state.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'endpoints.delete',
      class: 'mutation',
      description: 'Delete a compute endpoint. A branch with no endpoint holds its data but is unreachable over SQL until one is added.',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, endpoint_id: { type: 'string' } },
        required: ['project_id', 'endpoint_id'],
      },
      request: { method: 'DELETE', path: '/v2/projects/{project_id}/endpoints/{endpoint_id}' },
      // Replay against a deleted endpoint returns 404 — no double effect.
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // ─── Operations ───────────────────────────────────────────────────
    {
      name: 'operations.list',
      class: 'read',
      description:
        'List management operations of a project (create_branch, start_compute, …) with status — poll after a create to know when the branch is ready.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          cursor: { type: 'string' },
        },
        required: ['project_id'],
      },
      request: {
        method: 'GET',
        path: '/v2/projects/{project_id}/operations',
        query: { limit: '{limit}', cursor: '{cursor}' },
        maxResponseBytes: 8 * 1024 * 1024,
      },
    },
    {
      name: 'operations.get',
      class: 'read',
      description: 'Fetch one operation by id (status, error, timings).',
      parameters: {
        type: 'object',
        properties: { project_id: { type: 'string' }, operation_id: { type: 'string' } },
        required: ['project_id', 'operation_id'],
      },
      request: { method: 'GET', path: '/v2/projects/{project_id}/operations/{operation_id}' },
    },
  ],
})
