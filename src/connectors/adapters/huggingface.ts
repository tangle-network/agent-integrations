import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Hugging Face Hub + Inference Router connector.
 *
 * Authentication: api-key — a User Access Token (`hf_…`, surfaced to the
 * engine as `credentials.apiKey`) generated at
 * https://huggingface.co/settings/tokens. Tokens carry fine-grained scopes
 * (read-repos, write-repos, inference, etc.); we surface those in
 * `requiredScopes` so the hub guard can refuse a capability the connection's
 * token cannot perform without burning a 401 round-trip. There is no 3-legged
 * OAuth surface for the public Hub — workspace-level Hugging Face Enterprise
 * supports OIDC, but that's an org SSO bridge, not an API access flow, so
 * api-key is the only honest auth shape here.
 *
 * Endpoint surface covered:
 *   - Hub identity probe (`whoami-v2`).
 *   - Catalog reads: models / datasets / spaces list + detail.
 *   - Repo lifecycle: create + delete (write-repos scope).
 *   - Discussions: list + create on a model repo (discussion scope).
 *   - Inference: chat completions via the OpenAI-compatible router at
 *     router.huggingface.co/v1, which proxies serverless + dedicated
 *     endpoints behind one bearer-auth surface.
 *
 * Two base URLs are in play (Hub vs Inference Router); the declarative-rest
 * engine takes a single `baseUrl`, so capabilities that hit the router carry
 * an absolute `path` and override locally. We point the spec's `baseUrl` at
 * the Hub (the primary surface) and the router capability re-issues against
 * its own host via a full URL in the request path interpolated by the engine
 * — the engine's `new URL(path, base)` collapses to the absolute target.
 */

const HUB_BASE_URL = 'https://huggingface.co'
const INFERENCE_ROUTER_URL = 'https://router.huggingface.co/v1'

export const huggingfaceConnector = declarativeRestConnector({
  kind: 'huggingface',
  displayName: 'Hugging Face',
  description:
    'Browse the Hugging Face Hub (models, datasets, spaces), manage repos and discussions, and run OpenAI-compatible chat completions through the Inference Router.',
  auth: {
    kind: 'api-key',
    hint: 'Hugging Face User Access Token (starts with hf_…). Create one at https://huggingface.co/settings/tokens. The token must carry at least the read-repos scope for catalog reads, write-repos for repo mutations, discussion for discussion writes, and inference-api for chat completions.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: HUB_BASE_URL,
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/api/whoami-v2' },
  capabilities: [
    {
      name: 'auth.whoami',
      class: 'read',
      description:
        'Resolve the calling token to its Hub user / org identity, including the token name and granted scopes. Cheap probe used to validate a freshly-connected token before declaring a connection healthy.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/whoami-v2' },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'models.list',
      class: 'read',
      description:
        'Search and page the model catalog. Supports the Hub`s standard query knobs: free-text search, author/owner filter, library/task filter, and ordering.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Free-text search across model card and repo id.' },
          author: { type: 'string', description: 'Restrict to a user or org namespace.' },
          filter: {
            type: 'string',
            description: 'Hub filter tag, e.g. `text-generation`, `pytorch`, `dataset:wikitext`.',
          },
          sort: { type: 'string', description: 'Sort key: `downloads`, `likes`, `lastModified`, `createdAt`.' },
          direction: { type: 'string', enum: ['-1', '1'], description: '-1 descending, 1 ascending.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          full: { type: 'boolean', description: 'Include full siblings + cardData payload per row.' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/models',
        query: {
          search: '{search}',
          author: '{author}',
          filter: '{filter}',
          sort: '{sort}',
          direction: '{direction}',
          limit: '{limit}',
          full: '{full}',
        },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'models.get',
      class: 'read',
      description:
        'Fetch the full repo record for one model — including siblings (files), cardData (parsed README front-matter), tags, license, and gated-access state.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Fully-qualified id, e.g. `mistralai/Mistral-7B-Instruct-v0.3`.' },
          revision: { type: 'string', description: 'Optional git ref (branch, tag, or sha). Defaults to main.' },
        },
        required: ['repo_id'],
      },
      request: {
        method: 'GET',
        path: '/api/models/{repo_id}',
        query: { revision: '{revision}' },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'datasets.list',
      class: 'read',
      description: 'Search and page the dataset catalog with the same query knobs as the model catalog.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          author: { type: 'string' },
          filter: { type: 'string' },
          sort: { type: 'string' },
          direction: { type: 'string', enum: ['-1', '1'] },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          full: { type: 'boolean' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/datasets',
        query: {
          search: '{search}',
          author: '{author}',
          filter: '{filter}',
          sort: '{sort}',
          direction: '{direction}',
          limit: '{limit}',
          full: '{full}',
        },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'datasets.get',
      class: 'read',
      description: 'Fetch the full repo record for one dataset.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string', description: 'Fully-qualified id, e.g. `wikitext` or `squad`.' },
          revision: { type: 'string' },
        },
        required: ['repo_id'],
      },
      request: {
        method: 'GET',
        path: '/api/datasets/{repo_id}',
        query: { revision: '{revision}' },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'spaces.list',
      class: 'read',
      description: 'Search and page Hugging Face Spaces (community-hosted demo apps).',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          author: { type: 'string' },
          filter: { type: 'string' },
          sort: { type: 'string' },
          direction: { type: 'string', enum: ['-1', '1'] },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/spaces',
        query: {
          search: '{search}',
          author: '{author}',
          filter: '{filter}',
          sort: '{sort}',
          direction: '{direction}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'spaces.get',
      class: 'read',
      description: 'Fetch the full repo record for one Space, including its runtime status and hardware tier.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string' },
          revision: { type: 'string' },
        },
        required: ['repo_id'],
      },
      request: {
        method: 'GET',
        path: '/api/spaces/{repo_id}',
        query: { revision: '{revision}' },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'repos.create',
      class: 'mutation',
      description:
        'Create a new repo under the authenticated namespace. The Hub treats repo creation as idempotent on (type, name) — a duplicate POST returns 409 surfaced by the engine as a conflict result rather than a thrown error.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['model', 'dataset', 'space'] },
          name: { type: 'string', description: 'Repo slug (without owner prefix).' },
          organization: {
            type: 'string',
            description: 'Owner namespace. Omit to create under the authenticated user.',
          },
          private: { type: 'boolean', description: 'Create as private. Defaults to public.' },
          sdk: {
            type: 'string',
            enum: ['gradio', 'streamlit', 'docker', 'static'],
            description: 'Only meaningful for type=space.',
          },
        },
        required: ['type', 'name'],
      },
      request: {
        method: 'POST',
        path: '/api/repos/create',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write-repos'],
    },
    {
      name: 'repos.delete',
      class: 'mutation',
      description:
        'Delete a repo under the authenticated namespace. The Hub accepts repeated DELETEs of an already-deleted repo as 404 — caller-side dedupe is recommended.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['model', 'dataset', 'space'] },
          name: { type: 'string' },
          organization: { type: 'string' },
        },
        required: ['type', 'name'],
      },
      request: {
        method: 'DELETE',
        path: '/api/repos/delete',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write-repos'],
    },
    {
      name: 'discussions.list',
      class: 'read',
      description:
        'List discussions and pull requests on a model repo. Returns paged threads with status, author, and last-updated metadata.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string' },
          status: { type: 'string', enum: ['open', 'closed', 'all'] },
          type: { type: 'string', enum: ['discussion', 'pull-request', 'all'] },
          p: { type: 'integer', minimum: 0, description: 'Zero-indexed page.' },
        },
        required: ['repo_id'],
      },
      request: {
        method: 'GET',
        path: '/api/models/{repo_id}/discussions',
        query: { status: '{status}', type: '{type}', p: '{p}' },
      },
      requiredScopes: ['read-repos'],
    },
    {
      name: 'discussions.create',
      class: 'mutation',
      description:
        'Open a new discussion thread on a model repo with an initial comment. The Hub does not honour an idempotency key here; replays create duplicate threads.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string', description: 'Markdown body of the opening comment.' },
          pull_request: {
            type: 'boolean',
            description: 'If true, open as a pull request (requires the matching branch).',
          },
        },
        required: ['repo_id', 'title', 'description'],
      },
      request: {
        method: 'POST',
        path: '/api/models/{repo_id}/discussions',
        body: {
          title: '{title}',
          description: '{description}',
          pullRequest: '{pull_request}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['discussion'],
    },
    {
      name: 'discussions.comment',
      class: 'mutation',
      description:
        'Append a comment to an existing discussion or pull request thread. Replays produce duplicate comments — caller-owned dedupe.',
      parameters: {
        type: 'object',
        properties: {
          repo_id: { type: 'string' },
          discussion_num: { type: 'integer', minimum: 1 },
          comment: { type: 'string', description: 'Markdown body.' },
        },
        required: ['repo_id', 'discussion_num', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/api/models/{repo_id}/discussions/{discussion_num}/comment',
        body: { comment: '{comment}' },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['discussion'],
    },
    {
      name: 'inference.chat_completions',
      class: 'mutation',
      description:
        'Run a chat completion against the Hugging Face Inference Router, which exposes an OpenAI-compatible /v1/chat/completions surface and routes the request to the appropriate serverless or dedicated endpoint. Generation is non-idempotent — replay yields a new sample.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description:
              'Routed model id, e.g. `meta-llama/Llama-3.1-70B-Instruct` or `<owner>/<model>:<provider>` to pin a backend.',
          },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                content: {},
                name: { type: 'string' },
                tool_call_id: { type: 'string' },
              },
              required: ['role'],
            },
          },
          max_tokens: { type: 'integer', minimum: 1 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          stream: { type: 'boolean' },
          stop: { type: 'array', items: { type: 'string' } },
          tools: { type: 'array', items: { type: 'object' } },
          tool_choice: {},
          response_format: { type: 'object' },
          seed: { type: 'integer' },
        },
        required: ['model', 'messages'],
      },
      request: {
        method: 'POST',
        // Absolute URL so the declarative-rest engine's `new URL(path, base)`
        // resolves to the Inference Router host rather than the Hub host.
        path: `${INFERENCE_ROUTER_URL}/chat/completions`,
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['inference-api'],
    },
    {
      name: 'inference.models.list',
      class: 'read',
      description:
        'Enumerate models reachable through the Inference Router for the calling token (serverless + dedicated). Useful before chat_completions to validate model availability.',
      parameters: { type: 'object', properties: {} },
      request: {
        method: 'GET',
        path: `${INFERENCE_ROUTER_URL}/models`,
      },
      requiredScopes: ['inference-api'],
    },
  ],
})
