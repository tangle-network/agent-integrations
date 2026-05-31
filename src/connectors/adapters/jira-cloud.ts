import { declarativeRestConnector } from './declarative-rest.js'

const issueIdOrKey = {
  type: 'object',
  properties: { issueIdOrKey: { type: 'string', description: 'Numeric issue ID or project key (e.g. PROJ-123).' } },
  required: ['issueIdOrKey'],
}

export const jiraCloudConnector = declarativeRestConnector({
  kind: 'jira-cloud',
  displayName: 'Jira Cloud',
  description: 'Issue tracking and project management on Jira Cloud — create, update, comment on, transition, and search issues via the REST API v3.',
  auth: {
    kind: 'api-key',
    hint: 'Jira Cloud API token (https://id.atlassian.com/manage-profile/security/api-tokens). The instance URL (e.g. https://example.atlassian.net) is supplied per data source as metadata.instanceUrl.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  test: { method: 'GET', path: '/rest/api/3/myself' },
  capabilities: [
    {
      name: 'issues.create',
      class: 'mutation',
      description: 'Create an issue. Caller provides the full v3 create-issue envelope (fields, transition, update, properties).',
      parameters: {
        type: 'object',
        properties: {
          fields: { type: 'object', description: 'Issue fields — must include project, summary, and issuetype.' },
          update: { type: 'object' },
          transition: { type: 'object' },
          properties: { type: 'array' },
          historyMetadata: { type: 'object' },
        },
        required: ['fields'],
      },
      request: { method: 'POST', path: '/rest/api/3/issue', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.search',
      class: 'read',
      description: 'Search issues with JQL. Returns the v3 search envelope with pagination tokens.',
      parameters: {
        type: 'object',
        properties: {
          jql: { type: 'string', description: 'JQL query (see https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/).' },
          startAt: { type: 'integer', minimum: 0 },
          maxResults: { type: 'integer', minimum: 1, maximum: 100 },
          fields: { type: 'string', description: 'Comma-delimited field IDs (e.g. "summary,status,assignee") or "*all".' },
          expand: { type: 'string' },
          validateQuery: { type: 'string', enum: ['strict', 'warn', 'none', 'true', 'false'] },
        },
        required: ['jql'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/3/search',
        query: {
          jql: '{jql}',
          startAt: '{startAt}',
          maxResults: '{maxResults}',
          fields: '{fields}',
          expand: '{expand}',
          validateQuery: '{validateQuery}',
        },
      },
    },
    {
      name: 'issues.get',
      class: 'read',
      description: 'Get a single issue by ID or key, optionally expanding rendered fields, names, schemas, transitions, etc.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          fields: { type: 'string' },
          expand: { type: 'string', description: 'Comma-delimited expand list — e.g. "renderedFields,names,schema,transitions".' },
          properties: { type: 'string' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/3/issue/{issueIdOrKey}',
        query: { fields: '{fields}', expand: '{expand}', properties: '{properties}' },
      },
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Edit an issue — partial update of the fields or update envelope.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          fields: { type: 'object' },
          update: { type: 'object' },
          properties: { type: 'array' },
          historyMetadata: { type: 'object' },
          notifyUsers: { type: 'boolean' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'PUT',
        path: '/rest/api/3/issue/{issueIdOrKey}',
        query: { notifyUsers: '{notifyUsers}' },
        body: { fields: '{fields}', update: '{update}', properties: '{properties}', historyMetadata: '{historyMetadata}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'issues.assign',
      class: 'mutation',
      description: 'Assign an issue to an accountId, "-1" (default assignee), or null (unassigned).',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          accountId: { type: ['string', 'null'] },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'PUT',
        path: '/rest/api/3/issue/{issueIdOrKey}/assignee',
        body: { accountId: '{accountId}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'issues.transition',
      class: 'mutation',
      description: 'Move an issue through a workflow transition. Look up valid transition IDs via /rest/api/3/issue/{key}/transitions.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          transition: { type: 'object', description: 'Object with at least { id: string }.' },
          fields: { type: 'object' },
          update: { type: 'object' },
          historyMetadata: { type: 'object' },
        },
        required: ['issueIdOrKey', 'transition'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/3/issue/{issueIdOrKey}/transitions',
        body: { transition: '{transition}', fields: '{fields}', update: '{update}', historyMetadata: '{historyMetadata}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.link',
      class: 'mutation',
      description: 'Create an issue link between two issues (e.g. "blocks", "is blocked by").',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'object', description: 'Link type — { name: string } or { id: string }.' },
          inwardIssue: { type: 'object', description: '{ key: string } | { id: string }.' },
          outwardIssue: { type: 'object', description: '{ key: string } | { id: string }.' },
          comment: { type: 'object' },
        },
        required: ['type', 'inwardIssue', 'outwardIssue'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/3/issueLink',
        body: { type: '{type}', inwardIssue: '{inwardIssue}', outwardIssue: '{outwardIssue}', comment: '{comment}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.watchers.add',
      class: 'mutation',
      description: 'Add a watcher to an issue. Body is the watcher accountId as a raw JSON string.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          accountId: { type: 'string' },
        },
        required: ['issueIdOrKey', 'accountId'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/3/issue/{issueIdOrKey}/watchers',
        body: '{accountId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments on an issue (paginated).',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          startAt: { type: 'integer', minimum: 0 },
          maxResults: { type: 'integer', minimum: 1, maximum: 100 },
          orderBy: { type: 'string', enum: ['created', '-created', '+created'] },
          expand: { type: 'string' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/3/issue/{issueIdOrKey}/comment',
        query: { startAt: '{startAt}', maxResults: '{maxResults}', orderBy: '{orderBy}', expand: '{expand}' },
      },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Add a comment to an issue. Body field accepts the Atlassian Document Format envelope.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          body: { type: ['object', 'string'], description: 'ADF document or plain string (wiki text via "expand=renderedBody" in subsequent fetch).' },
          visibility: { type: 'object' },
          properties: { type: 'array' },
        },
        required: ['issueIdOrKey', 'body'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/3/issue/{issueIdOrKey}/comment',
        body: { body: '{body}', visibility: '{visibility}', properties: '{properties}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'comments.update',
      class: 'mutation',
      description: 'Edit an existing comment by its ID.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          commentId: { type: 'string' },
          body: { type: ['object', 'string'] },
          visibility: { type: 'object' },
          properties: { type: 'array' },
        },
        required: ['issueIdOrKey', 'commentId', 'body'],
      },
      request: {
        method: 'PUT',
        path: '/rest/api/3/issue/{issueIdOrKey}/comment/{commentId}',
        body: { body: '{body}', visibility: '{visibility}', properties: '{properties}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'comments.delete',
      class: 'mutation',
      description: 'Remove a comment from an issue.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          commentId: { type: 'string' },
        },
        required: ['issueIdOrKey', 'commentId'],
      },
      request: {
        method: 'DELETE',
        path: '/rest/api/3/issue/{issueIdOrKey}/comment/{commentId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'attachments.get',
      class: 'read',
      description: 'Fetch attachment metadata by attachment ID.',
      parameters: {
        type: 'object',
        properties: { attachmentId: { type: 'string' } },
        required: ['attachmentId'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/3/attachment/{attachmentId}',
      },
    },
    {
      name: 'users.find',
      class: 'read',
      description: 'Look up users by query string (email, display name fragment, etc.).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          accountId: { type: 'string' },
          startAt: { type: 'integer', minimum: 0 },
          maxResults: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
      request: {
        method: 'GET',
        path: '/rest/api/3/user/search',
        query: {
          query: '{query}',
          accountId: '{accountId}',
          startAt: '{startAt}',
          maxResults: '{maxResults}',
        },
      },
    },
  ],
})

export { issueIdOrKey as JIRA_CLOUD_ISSUE_ID_OR_KEY_SCHEMA }
