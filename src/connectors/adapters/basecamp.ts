import { declarativeRestConnector } from './declarative-rest.js'

// Basecamp 3 REST API — https://github.com/basecamp/bc3-api
//
// OAuth2 endpoints from
//   https://github.com/basecamp/api/blob/master/sections/authentication.md
//   authorize: https://launchpad.37signals.com/authorization/new
//              (browser; must carry `type=web_server`, client_id, redirect_uri, state)
//   token:     https://launchpad.37signals.com/authorization/token
//              (server exchange; must POST `type=web_server`, client_id, client_secret, code,
//               redirect_uri)
// `type=web_server` is a Basecamp-specific OAuth flag the consumer has to
// append to both URLs at request time; we cannot bake it into the manifest
// because the standard OAuth2 helpers only know about response_type/grant_type.
//
// Basecamp issues one token that fronts every 37signals product the operator
// authorized (Basecamp 2, Basecamp 3, Launchpad). After exchange the consumer
// calls
//   GET https://launchpad.37signals.com/authorization.json
// to discover the user's accounts, picks the desired Basecamp 3 account
// (`product == "bc3"`), and pins
//   metadata.accountBaseUrl = `https://3.basecampapi.com/${accountId}`
// on the DataSource. All capability paths below join onto that host — same
// per-tenant base-URL seam Salesforce uses for `instanceUrl` and Jira uses
// for `cloudBaseUrl`.
//
// Basecamp 3 has no granular OAuth scopes — the launchpad authorization
// screen is an all-or-nothing grant for the chosen account, so `scopes: []`
// is the honest manifest (matches the `clickup` precedent in this repo).
//
// Idempotency: Basecamp does not honor a Idempotency-Key header. Creates
// are modelled as `native-idempotency` because Basecamp returns the same
// 201 + resource on replay only if the client deduplicates; that contract
// is enforced by the hub-side idempotency cache, not the server. Updates
// use If-Match against the resource's etag (declarative-rest sets
// `if-match` from `inv.expectedEtag`) — Basecamp emits etags on every
// individual resource fetch.
export const basecampConnector = declarativeRestConnector({
  kind: 'basecamp',
  displayName: 'Basecamp',
  description:
    'Read projects, message boards, to-do lists, to-dos, and campfire chats from a connected Basecamp 3 account; create message-board posts, to-dos, and campfire lines.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://launchpad.37signals.com/authorization/new',
    tokenUrl: 'https://launchpad.37signals.com/authorization/token',
    // Basecamp 3 OAuth is an all-or-nothing grant; the launchpad consent
    // screen does not surface named scopes. See clickup.ts for the same
    // pattern.
    scopes: [],
    clientIdEnv: 'BASECAMP_OAUTH_CLIENT_ID',
    clientSecretEnv: 'BASECAMP_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // Per-account routing. Consumer resolves `accountBaseUrl` from
  // launchpad's /authorization.json at connect time.
  baseUrl: { metadataKey: 'accountBaseUrl' },
  // Basecamp requires every request carry a real User-Agent that
  // identifies the integrator + a contact URL. This is a hard policy:
  // requests without a recognizable agent are rate-limited or blocked
  // outright. See https://github.com/basecamp/bc3-api#identifying-your-application
  defaultHeaders: {
    'user-agent': 'Tangle Hub (https://tangle.tools)',
  },
  // Cheap liveness probe — returns 200 + the authorized user's profile.
  test: { method: 'GET', path: 'my/profile.json' },
  capabilities: [
    {
      name: 'projects.list',
      class: 'read',
      description: 'List active projects visible to the authorized user. Paginates 15 per page; use `page` to walk.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by archived/trashed lifecycle. Defaults to active when omitted.',
            enum: ['archived', 'trashed'],
          },
          page: { type: 'integer', minimum: 1 },
        },
      },
      request: {
        method: 'GET',
        path: 'projects.json',
        query: { status: '{status}', page: '{page}' },
      },
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Read a single project, including the dock of tools (message board, todoset, campfire, schedule) attached to it.',
      parameters: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
      },
      request: { method: 'GET', path: 'projects/{projectId}.json' },
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a new project. Returns the project payload with its dock of default tools attached.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
      // Body matches Basecamp's verbatim field names; `args` is forwarded
      // as the JSON body. `projectId` etc. are path-only and not present
      // here, so this is safe.
      request: { method: 'POST', path: 'projects.json', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'message_board.messages.list',
      class: 'read',
      description: 'List messages on a project message board. `messageBoardId` is the id of the message_board tool from projects.get.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          messageBoardId: { type: 'string' },
        },
        required: ['projectId', 'messageBoardId'],
      },
      request: {
        method: 'GET',
        path: 'buckets/{projectId}/message_boards/{messageBoardId}/messages.json',
      },
    },
    {
      name: 'message_board.messages.get',
      class: 'read',
      description: 'Read a single message-board post by id.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          messageId: { type: 'string' },
        },
        required: ['projectId', 'messageId'],
      },
      request: {
        method: 'GET',
        path: 'buckets/{projectId}/messages/{messageId}.json',
      },
    },
    {
      name: 'message_board.messages.create',
      class: 'mutation',
      description:
        'Post a new active message to a project message board. `content` is HTML (Basecamp\'s rich-text format); `subject` is plain text. Published immediately (status="active").',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          messageBoardId: { type: 'string' },
          subject: { type: 'string' },
          content: { type: 'string', description: 'HTML body. Basecamp strips disallowed tags server-side.' },
        },
        required: ['projectId', 'messageBoardId', 'subject', 'content'],
      },
      // status hard-coded to "active" so the message is visible immediately.
      // To draft / categorize, callers should use the upstream
      // /buckets/{id}/message_boards/{id}/messages.json endpoint directly.
      request: {
        method: 'POST',
        path: 'buckets/{projectId}/message_boards/{messageBoardId}/messages.json',
        body: {
          subject: '{subject}',
          content: '{content}',
          status: 'active',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'todoset.get',
      class: 'read',
      description: 'Read the project\'s todoset (the container that holds all to-do lists). `todosetId` is the id of the todoset tool from projects.get.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todosetId: { type: 'string' },
        },
        required: ['projectId', 'todosetId'],
      },
      request: { method: 'GET', path: 'buckets/{projectId}/todosets/{todosetId}.json' },
    },
    {
      name: 'todolists.list',
      class: 'read',
      description: 'List to-do lists inside a todoset.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todosetId: { type: 'string' },
          status: { type: 'string', enum: ['archived', 'trashed'] },
        },
        required: ['projectId', 'todosetId'],
      },
      request: {
        method: 'GET',
        path: 'buckets/{projectId}/todosets/{todosetId}/todolists.json',
        query: { status: '{status}' },
      },
    },
    {
      name: 'todolists.create',
      class: 'mutation',
      description:
        'Create a new to-do list inside a todoset. `name` and `description` are both required body fields here; Basecamp accepts an empty `description` if the list has none.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todosetId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', description: 'Plain text; pass an empty string if none.' },
        },
        required: ['projectId', 'todosetId', 'name', 'description'],
      },
      request: {
        method: 'POST',
        path: 'buckets/{projectId}/todosets/{todosetId}/todolists.json',
        body: { name: '{name}', description: '{description}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'todos.list',
      class: 'read',
      description: 'List to-dos inside a single to-do list. Use `status=archived|trashed|completed` to slice.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todolistId: { type: 'string' },
          status: { type: 'string', enum: ['archived', 'trashed'] },
          completed: { type: 'boolean' },
        },
        required: ['projectId', 'todolistId'],
      },
      request: {
        method: 'GET',
        path: 'buckets/{projectId}/todolists/{todolistId}/todos.json',
        query: { status: '{status}', completed: '{completed}' },
      },
    },
    {
      name: 'todos.get',
      class: 'read',
      description: 'Read a single to-do by id, including assignees, due date, and completion state.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todoId: { type: 'string' },
        },
        required: ['projectId', 'todoId'],
      },
      request: { method: 'GET', path: 'buckets/{projectId}/todos/{todoId}.json' },
    },
    {
      name: 'todos.create',
      class: 'mutation',
      description:
        'Create a to-do inside a to-do list. Body fields follow Basecamp\'s wire format verbatim: `content` (required), `description` (HTML), `assignee_ids` / `notify_ids` / `completion_subscriber_ids` (arrays of person ids), `due_on` and `starts_on` (ISO YYYY-MM-DD). Path-only args (`projectId`, `todolistId`) are scrubbed by Basecamp server-side.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todolistId: { type: 'string' },
          content: { type: 'string' },
          description: { type: 'string' },
          assignee_ids: { type: 'array', items: { type: 'integer' } },
          notify_ids: { type: 'array', items: { type: 'integer' } },
          completion_subscriber_ids: { type: 'array', items: { type: 'integer' } },
          due_on: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
          starts_on: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
        },
        required: ['projectId', 'todolistId', 'content'],
      },
      // body: 'args' forwards every arg (minus the URL-interpolated path
      // params, which Basecamp ignores). Body field names match
      // Basecamp's wire format directly — no rename layer.
      request: {
        method: 'POST',
        path: 'buckets/{projectId}/todolists/{todolistId}/todos.json',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'todos.update',
      class: 'mutation',
      description:
        'Edit an existing to-do. Wire field names match Basecamp directly (`content`, `description`, `assignee_ids`, `notify_ids`, `due_on`, `starts_on`). Omitted fields are left untouched server-side.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todoId: { type: 'string' },
          content: { type: 'string' },
          description: { type: 'string' },
          assignee_ids: { type: 'array', items: { type: 'integer' } },
          notify_ids: { type: 'array', items: { type: 'integer' } },
          due_on: { type: 'string' },
          starts_on: { type: 'string' },
        },
        required: ['projectId', 'todoId'],
      },
      request: {
        method: 'PUT',
        path: 'buckets/{projectId}/todos/{todoId}.json',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'todos.complete',
      class: 'mutation',
      description: 'Mark a to-do completed. Idempotent on Basecamp\'s side — re-POSTing on an already-completed to-do is a no-op 204.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todoId: { type: 'string' },
        },
        required: ['projectId', 'todoId'],
      },
      request: {
        method: 'POST',
        path: 'buckets/{projectId}/todos/{todoId}/completion.json',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'todos.uncomplete',
      class: 'mutation',
      description: 'Reopen a previously completed to-do.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          todoId: { type: 'string' },
        },
        required: ['projectId', 'todoId'],
      },
      request: {
        method: 'DELETE',
        path: 'buckets/{projectId}/todos/{todoId}/completion.json',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments attached to a recording (to-do, message, document, upload — any commentable resource).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          recordingId: { type: 'string', description: 'Id of the parent recording (to-do, message, etc.).' },
        },
        required: ['projectId', 'recordingId'],
      },
      request: {
        method: 'GET',
        path: 'buckets/{projectId}/recordings/{recordingId}/comments.json',
      },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Post a comment on any commentable recording. `content` is HTML.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          recordingId: { type: 'string' },
          content: { type: 'string', description: 'HTML body.' },
        },
        required: ['projectId', 'recordingId', 'content'],
      },
      request: {
        method: 'POST',
        path: 'buckets/{projectId}/recordings/{recordingId}/comments.json',
        body: { content: '{content}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campfire.lines.list',
      class: 'read',
      description: 'List recent lines (messages) in a project\'s campfire (group chat). `campfireId` is the id of the chat tool from projects.get.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          campfireId: { type: 'string' },
        },
        required: ['projectId', 'campfireId'],
      },
      request: {
        method: 'GET',
        path: 'buckets/{projectId}/chats/{campfireId}/lines.json',
      },
    },
    {
      name: 'campfire.lines.create',
      class: 'mutation',
      description: 'Post a single line to a project\'s campfire chat. `content` is HTML.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          campfireId: { type: 'string' },
          content: { type: 'string', description: 'HTML body.' },
        },
        required: ['projectId', 'campfireId', 'content'],
      },
      request: {
        method: 'POST',
        path: 'buckets/{projectId}/chats/{campfireId}/lines.json',
        body: { content: '{content}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'people.list',
      class: 'read',
      description: 'List people on the account. Use this to resolve assignee ids for to-do creation.',
      parameters: {
        type: 'object',
        properties: { page: { type: 'integer', minimum: 1 } },
      },
      request: { method: 'GET', path: 'people.json', query: { page: '{page}' } },
    },
    {
      name: 'people.get',
      class: 'read',
      description: 'Read a single person on the account.',
      parameters: {
        type: 'object',
        properties: { personId: { type: 'string' } },
        required: ['personId'],
      },
      request: { method: 'GET', path: 'people/{personId}.json' },
    },
  ],
})
