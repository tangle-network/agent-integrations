import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft To Do connector via the Microsoft Graph v1.0 todo API.
 *
 * Auth: OAuth2 against the Microsoft identity platform. We request the
 * delegated Tasks scopes that cover read + write of the user's task lists
 * and tasks, plus offline_access for refresh.
 *
 * Capability surface mirrors the activepieces piece actions:
 *   - addAttachmentAction        → tasks.addAttachment
 *   - completeTaskAction         → tasks.complete       (PATCH status=completed)
 *   - createTask                 → tasks.create
 *   - createTaskListAction       → taskLists.create
 *   - deleteTaskAction           → tasks.delete
 *   - findTaskByTitleAction      → tasks.findByTitle    ($filter on title eq)
 *   - findTaskListByNameAction   → taskLists.findByName ($filter on displayName eq)
 *   - getTaskAction              → tasks.get
 *   - updateTaskAction           → tasks.update
 *   - updateTaskListAction       → taskLists.update
 *   - listTasksAction            → tasks.list
 *   - listTaskListsAction        → taskLists.list
 *
 * Graph models the resource tree as:
 *   /me/todo/lists                      → todoTaskList
 *   /me/todo/lists/{listId}/tasks       → todoTask
 *   /me/todo/lists/{listId}/tasks/{id}/attachments → taskFileAttachment
 *
 * Mutations of resources Graph generates server-side (create list, create task,
 * create attachment) are 'native-idempotency'. Mutations targeting an existing
 * resource (PATCH list, PATCH task, complete task, DELETE task) are
 * 'optimistic-read-verify' — Graph does not expose ETags on To Do entities,
 * so callers must read-then-write if they need to detect concurrent edits.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/todo-overview
 *   - https://learn.microsoft.com/graph/api/todo-list-lists
 *   - https://learn.microsoft.com/graph/api/todotasklist-post-tasks
 *   - https://learn.microsoft.com/graph/api/todotask-update
 *   - https://learn.microsoft.com/graph/api/todotask-post-attachments
 */
export const microsoftTodoConnector = declarativeRestConnector({
  kind: 'microsoft-todo',
  displayName: 'Microsoft To Do',
  description:
    'Manage Microsoft To Do task lists and tasks via the Microsoft Graph todo API — list/create/update/complete/delete tasks, manage task lists, attach files.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Tasks.ReadWrite', 'User.Read'],
    clientIdEnv: 'MICROSOFT_TODO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_TODO_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  defaultHeaders: {
    Accept: 'application/json',
  },
  test: { method: 'GET', path: '/me/todo/lists', query: { $top: '1' } },
  capabilities: [
    {
      name: 'taskLists.list',
      class: 'read',
      description: 'List the signed-in user\'s To Do task lists. Use $top to page, $filter to narrow by displayName.',
      parameters: {
        type: 'object',
        properties: {
          $top: { type: 'integer' },
          $filter: { type: 'string' },
          $select: { type: 'string' },
          $skip: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/todo/lists',
        query: { $top: '{$top}', $filter: '{$filter}', $select: '{$select}', $skip: '{$skip}' },
      },
    },
    {
      name: 'taskLists.findByName',
      class: 'read',
      description: 'Find a task list by exact displayName via a Graph $filter eq query.',
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
        },
        required: ['displayName'],
      },
      request: {
        method: 'GET',
        path: '/me/todo/lists',
        query: { $filter: "displayName eq '{displayName}'" },
      },
    },
    {
      name: 'taskLists.create',
      class: 'mutation',
      description: 'Create a new To Do task list owned by the signed-in user.',
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
        },
        required: ['displayName'],
      },
      request: {
        method: 'POST',
        path: '/me/todo/lists',
        headers: { 'Content-Type': 'application/json' },
        body: { displayName: '{displayName}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'taskLists.update',
      class: 'mutation',
      description: 'Rename or otherwise update an existing task list. listId pins the target.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          displayName: { type: 'string' },
        },
        required: ['listId', 'displayName'],
      },
      request: {
        method: 'PATCH',
        path: '/me/todo/lists/{listId}',
        headers: { 'Content-Type': 'application/json' },
        body: { displayName: '{displayName}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.list',
      class: 'read',
      description: 'List tasks in a To Do task list. listId is the Graph todoTaskList id.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          $top: { type: 'integer' },
          $filter: { type: 'string' },
          $select: { type: 'string' },
          $orderby: { type: 'string' },
          $skip: { type: 'integer' },
        },
        required: ['listId'],
      },
      request: {
        method: 'GET',
        path: '/me/todo/lists/{listId}/tasks',
        query: {
          $top: '{$top}',
          $filter: '{$filter}',
          $select: '{$select}',
          $orderby: '{$orderby}',
          $skip: '{$skip}',
        },
      },
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Get a single task by id from a specific task list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          taskId: { type: 'string' },
        },
        required: ['listId', 'taskId'],
      },
      request: {
        method: 'GET',
        path: '/me/todo/lists/{listId}/tasks/{taskId}',
      },
    },
    {
      name: 'tasks.findByTitle',
      class: 'read',
      description: 'Find tasks in a list whose title exactly matches via a Graph $filter eq query.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          title: { type: 'string' },
          $top: { type: 'integer' },
        },
        required: ['listId', 'title'],
      },
      request: {
        method: 'GET',
        path: '/me/todo/lists/{listId}/tasks',
        query: { $filter: "title eq '{title}'", $top: '{$top}' },
      },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description:
        'Create a new task in a task list. body is JSON in todoTask shape (e.g. {"title":"…","body":{"content":"…","contentType":"text"},"dueDateTime":{"dateTime":"2026-06-01T17:00:00","timeZone":"UTC"},"importance":"normal"}).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          task: { type: 'object' },
        },
        required: ['listId', 'task'],
      },
      request: {
        method: 'POST',
        path: '/me/todo/lists/{listId}/tasks',
        headers: { 'Content-Type': 'application/json' },
        body: '{task}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description:
        'Update an existing task. Pass only the fields to change in patch (Graph PATCH semantics).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          taskId: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['listId', 'taskId', 'patch'],
      },
      request: {
        method: 'PATCH',
        path: '/me/todo/lists/{listId}/tasks/{taskId}',
        headers: { 'Content-Type': 'application/json' },
        body: '{patch}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.complete',
      class: 'mutation',
      description:
        'Mark a task as completed by PATCHing status=completed. Graph also sets completedDateTime server-side when status transitions to completed.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          taskId: { type: 'string' },
        },
        required: ['listId', 'taskId'],
      },
      request: {
        method: 'PATCH',
        path: '/me/todo/lists/{listId}/tasks/{taskId}',
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'completed' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.delete',
      class: 'mutation',
      description: 'Delete a task from a task list. Irreversible.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          taskId: { type: 'string' },
        },
        required: ['listId', 'taskId'],
      },
      request: {
        method: 'DELETE',
        path: '/me/todo/lists/{listId}/tasks/{taskId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.addAttachment',
      class: 'mutation',
      description:
        'Attach a small file (< 3MB) to a task via the taskFileAttachment endpoint. contentBytes must be base64-encoded.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          taskId: { type: 'string' },
          name: { type: 'string' },
          contentType: { type: 'string' },
          contentBytes: { type: 'string' },
        },
        required: ['listId', 'taskId', 'name', 'contentBytes'],
      },
      request: {
        method: 'POST',
        path: '/me/todo/lists/{listId}/tasks/{taskId}/attachments',
        headers: { 'Content-Type': 'application/json' },
        body: {
          '@odata.type': '#microsoft.graph.taskFileAttachment',
          name: '{name}',
          contentType: '{contentType}',
          contentBytes: '{contentBytes}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
