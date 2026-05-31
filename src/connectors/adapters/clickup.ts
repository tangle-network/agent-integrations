import { declarativeRestConnector } from './declarative-rest.js'

// ClickUp REST v2 — https://clickup.com/api
// OAuth2 endpoints from https://clickup.com/api/developer-portal/authentication/#oauth-flow
//   authorize: https://app.clickup.com/api (browser; query string carries client_id, redirect_uri, state)
//   token:     https://api.clickup.com/api/v2/oauth/token (server exchange; POSTs client_id+client_secret+code)
// ClickUp's OAuth surface is "all-or-nothing" — there are no named scopes the
// app can request; the workspace authorization screen lists what the app will
// be able to read or change for the selected Workspace and the user toggles
// Workspace access per consent. We model that as an empty `scopes` array so
// the auth manifest is honest about what we ask for (nothing scope-named) and
// the action set documents the data the connector actually touches.
export const clickupConnector = declarativeRestConnector({
  kind: 'clickup',
  displayName: 'ClickUp',
  description:
    'Read and mutate ClickUp workspaces, spaces, folders, lists, tasks, comments, and time entries via the ClickUp REST v2 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.clickup.com/api',
    tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
    scopes: [],
    clientIdEnv: 'CLICKUP_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CLICKUP_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.clickup.com/api/v2',
  // GET /user — returns the authorized user; used as a cheap liveness probe.
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'user.get',
      class: 'read',
      description: 'Return the ClickUp user that authorized the connection.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/user' },
    },
    {
      name: 'teams.list',
      class: 'read',
      description:
        'List the Workspaces (ClickUp calls these "teams" on the wire) the authorized user belongs to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/team' },
    },
    {
      name: 'spaces.list',
      class: 'read',
      description: 'List Spaces inside a Workspace.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Workspace id.' },
          archived: { type: 'boolean' },
        },
        required: ['teamId'],
      },
      request: {
        method: 'GET',
        path: '/team/{teamId}/space',
        query: { archived: '{archived}' },
      },
    },
    {
      name: 'spaces.get',
      class: 'read',
      description: 'Read a single Space by id.',
      parameters: {
        type: 'object',
        properties: { spaceId: { type: 'string' } },
        required: ['spaceId'],
      },
      request: { method: 'GET', path: '/space/{spaceId}' },
    },
    {
      name: 'folders.list',
      class: 'read',
      description: 'List Folders inside a Space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['spaceId'],
      },
      request: {
        method: 'GET',
        path: '/space/{spaceId}/folder',
        query: { archived: '{archived}' },
      },
    },
    {
      name: 'lists.list',
      class: 'read',
      description: 'List Lists inside a Folder.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['folderId'],
      },
      request: {
        method: 'GET',
        path: '/folder/{folderId}/list',
        query: { archived: '{archived}' },
      },
    },
    {
      name: 'lists.folderless',
      class: 'read',
      description: 'List Lists that live directly under a Space (no Folder).',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['spaceId'],
      },
      request: {
        method: 'GET',
        path: '/space/{spaceId}/list',
        query: { archived: '{archived}' },
      },
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Read a single List by id.',
      parameters: {
        type: 'object',
        properties: { listId: { type: 'string' } },
        required: ['listId'],
      },
      request: { method: 'GET', path: '/list/{listId}' },
    },
    {
      name: 'tasks.list',
      class: 'read',
      description:
        'List tasks in a List with optional filters (status, assignee, date range, custom fields).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          archived: { type: 'boolean' },
          page: { type: 'integer', minimum: 0 },
          order_by: { type: 'string', enum: ['id', 'created', 'updated', 'due_date'] },
          reverse: { type: 'boolean' },
          subtasks: { type: 'boolean' },
          include_closed: { type: 'boolean' },
        },
        required: ['listId'],
      },
      request: {
        method: 'GET',
        path: '/list/{listId}/task',
        query: {
          archived: '{archived}',
          page: '{page}',
          order_by: '{order_by}',
          reverse: '{reverse}',
          subtasks: '{subtasks}',
          include_closed: '{include_closed}',
        },
      },
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Read a single task by id, with optional subtasks expansion.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          custom_task_ids: { type: 'boolean' },
          team_id: { type: 'string' },
          include_subtasks: { type: 'boolean' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'GET',
        path: '/task/{taskId}',
        query: {
          custom_task_ids: '{custom_task_ids}',
          team_id: '{team_id}',
          include_subtasks: '{include_subtasks}',
        },
      },
    },
    {
      name: 'tasks.search',
      class: 'read',
      description:
        'Search tasks across a Workspace with filtered views (assignees, statuses, tags, due window, etc.).',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          page: { type: 'integer', minimum: 0 },
          order_by: { type: 'string', enum: ['id', 'created', 'updated', 'due_date'] },
          reverse: { type: 'boolean' },
          include_closed: { type: 'boolean' },
        },
        required: ['teamId'],
      },
      request: {
        method: 'GET',
        path: '/team/{teamId}/task',
        query: {
          page: '{page}',
          order_by: '{order_by}',
          reverse: '{reverse}',
          include_closed: '{include_closed}',
        },
      },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task inside a List.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          task: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              assignees: { type: 'array', items: { type: 'integer' } },
              tags: { type: 'array', items: { type: 'string' } },
              status: { type: 'string' },
              priority: { type: 'integer', minimum: 1, maximum: 4 },
              due_date: { type: 'integer', description: 'Unix epoch ms.' },
              due_date_time: { type: 'boolean' },
              time_estimate: { type: 'integer', description: 'Milliseconds.' },
              start_date: { type: 'integer' },
              start_date_time: { type: 'boolean' },
              notify_all: { type: 'boolean' },
              parent: { type: 'string', description: 'Task id of the parent for a subtask.' },
              links_to: { type: 'string' },
              custom_fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, value: {} },
                  required: ['id', 'value'],
                },
              },
            },
            required: ['name'],
          },
        },
        required: ['listId', 'task'],
      },
      request: {
        method: 'POST',
        path: '/list/{listId}/task',
        body: '{task}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update fields on an existing task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string' },
              priority: { type: 'integer', minimum: 1, maximum: 4 },
              due_date: { type: 'integer' },
              due_date_time: { type: 'boolean' },
              time_estimate: { type: 'integer' },
              start_date: { type: 'integer' },
              start_date_time: { type: 'boolean' },
              assignees: {
                type: 'object',
                properties: {
                  add: { type: 'array', items: { type: 'integer' } },
                  rem: { type: 'array', items: { type: 'integer' } },
                },
              },
              archived: { type: 'boolean' },
            },
          },
        },
        required: ['taskId', 'patch'],
      },
      request: {
        method: 'PUT',
        path: '/task/{taskId}',
        body: '{patch}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.delete',
      class: 'mutation',
      description: 'Delete a task by id.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      request: { method: 'DELETE', path: '/task/{taskId}' },
      cas: 'none',
    },
    {
      name: 'tasks.setCustomField',
      class: 'mutation',
      description:
        'Set or replace a custom field value on a task. Body shape depends on field type — pass the documented `value` payload verbatim.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          fieldId: { type: 'string' },
          payload: {
            type: 'object',
            properties: { value: {}, value_options: { type: 'object' } },
            required: ['value'],
          },
        },
        required: ['taskId', 'fieldId', 'payload'],
      },
      request: {
        method: 'POST',
        path: '/task/{taskId}/field/{fieldId}',
        body: '{payload}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments on a task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          start: { type: 'integer', description: 'Pagination cursor — comment date in ms.' },
          start_id: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'GET',
        path: '/task/{taskId}/comment',
        query: { start: '{start}', start_id: '{start_id}' },
      },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Post a comment on a task.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          comment: {
            type: 'object',
            properties: {
              comment_text: { type: 'string' },
              assignee: { type: 'integer' },
              notify_all: { type: 'boolean' },
            },
            required: ['comment_text'],
          },
        },
        required: ['taskId', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/task/{taskId}/comment',
        body: '{comment}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'timeEntries.list',
      class: 'read',
      description: 'List time entries in a Workspace within an optional date window.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          start_date: { type: 'integer', description: 'Unix epoch ms.' },
          end_date: { type: 'integer', description: 'Unix epoch ms.' },
          assignee: { type: 'string', description: 'Comma-separated user ids.' },
          include_task_tags: { type: 'boolean' },
          include_location_names: { type: 'boolean' },
          space_id: { type: 'string' },
          folder_id: { type: 'string' },
          list_id: { type: 'string' },
          task_id: { type: 'string' },
        },
        required: ['teamId'],
      },
      request: {
        method: 'GET',
        path: '/team/{teamId}/time_entries',
        query: {
          start_date: '{start_date}',
          end_date: '{end_date}',
          assignee: '{assignee}',
          include_task_tags: '{include_task_tags}',
          include_location_names: '{include_location_names}',
          space_id: '{space_id}',
          folder_id: '{folder_id}',
          list_id: '{list_id}',
          task_id: '{task_id}',
        },
      },
    },
    {
      name: 'timeEntries.create',
      class: 'mutation',
      description: 'Create a tracked time entry in a Workspace.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          entry: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              tags: { type: 'array' },
              start: { type: 'integer', description: 'Unix epoch ms.' },
              billable: { type: 'boolean' },
              duration: { type: 'integer', description: 'Milliseconds.' },
              assignee: { type: 'integer' },
              tid: { type: 'string', description: 'Task id.' },
            },
            required: ['start', 'duration'],
          },
        },
        required: ['teamId', 'entry'],
      },
      request: {
        method: 'POST',
        path: '/team/{teamId}/time_entries',
        body: '{entry}',
      },
      cas: 'native-idempotency',
    },
  ],
})
