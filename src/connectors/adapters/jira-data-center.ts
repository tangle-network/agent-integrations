import { declarativeRestConnector } from './declarative-rest.js'

export const jiraDataCenterConnector = declarativeRestConnector({
  kind: 'jira-data-center',
  displayName: 'Jira Data Center',
  description: 'Issue tracking and project management for Jira Data Center and Server.',
  auth: {
    kind: 'api-key',
    hint: 'Jira Data Center Personal Access Token (PAT). Provide the instance URL (e.g. https://jira.yourcompany.com) as connection metadata under instanceUrl.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  test: { method: 'GET', path: '/rest/api/2/myself' },
  capabilities: [
    {
      name: 'issues.create',
      class: 'mutation',
      description: 'Create a Jira issue with the supplied fields.',
      parameters: {
        type: 'object',
        properties: {
          fields: { type: 'object' },
          update: { type: 'object' },
        },
        required: ['fields'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/2/issue',
        body: { fields: '{fields}', update: '{update}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.search',
      class: 'read',
      description: 'Search issues with a JQL query.',
      parameters: {
        type: 'object',
        properties: {
          jql: { type: 'string' },
          startAt: { type: 'integer' },
          maxResults: { type: 'integer' },
          fields: { type: 'array', items: { type: 'string' } },
          expand: { type: 'string' },
        },
        required: ['jql'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/2/search',
        query: {
          jql: '{jql}',
          startAt: '{startAt}',
          maxResults: '{maxResults}',
          fields: '{fields}',
          expand: '{expand}',
        },
      },
    },
    {
      name: 'issues.get',
      class: 'read',
      description: 'Get a single Jira issue by key or id.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          fields: { type: 'string' },
          expand: { type: 'string' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/2/issue/{issueIdOrKey}',
        query: { fields: '{fields}', expand: '{expand}' },
      },
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Update fields on a Jira issue.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          fields: { type: 'object' },
          update: { type: 'object' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'PUT',
        path: '/rest/api/2/issue/{issueIdOrKey}',
        body: { fields: '{fields}', update: '{update}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'issues.assign',
      class: 'mutation',
      description: 'Assign a Jira issue to a user (by name on Data Center / Server).',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'PUT',
        path: '/rest/api/2/issue/{issueIdOrKey}/assignee',
        body: { name: '{name}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'issues.link',
      class: 'mutation',
      description: 'Create a link between two Jira issues.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          inwardIssue: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
          outwardIssue: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
          comment: { type: 'object' },
        },
        required: ['type', 'inwardIssue', 'outwardIssue'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/2/issueLink',
        body: {
          type: '{type}',
          inwardIssue: '{inwardIssue}',
          outwardIssue: '{outwardIssue}',
          comment: '{comment}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.addWatcher',
      class: 'mutation',
      description: 'Add a watcher (by username) to a Jira issue.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          username: { type: 'string' },
        },
        required: ['issueIdOrKey', 'username'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/2/issue/{issueIdOrKey}/watchers',
        body: '{username}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.addAttachment',
      class: 'mutation',
      description: 'Attach a file to a Jira issue. The attachment payload follows the multipart upload contract documented at /rest/api/2/issue/{issueIdOrKey}/attachments.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          attachment: {},
        },
        required: ['issueIdOrKey', 'attachment'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/2/issue/{issueIdOrKey}/attachments',
        headers: { 'X-Atlassian-Token': 'no-check' },
        body: { file: '{attachment}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'issues.getAttachment',
      class: 'read',
      description: 'Get metadata for a Jira issue attachment by id.',
      parameters: {
        type: 'object',
        properties: { attachmentId: { type: 'string' } },
        required: ['attachmentId'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/2/attachment/{attachmentId}',
      },
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments on a Jira issue.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          startAt: { type: 'integer' },
          maxResults: { type: 'integer' },
          orderBy: { type: 'string' },
          expand: { type: 'string' },
        },
        required: ['issueIdOrKey'],
      },
      request: {
        method: 'GET',
        path: '/rest/api/2/issue/{issueIdOrKey}/comment',
        query: {
          startAt: '{startAt}',
          maxResults: '{maxResults}',
          orderBy: '{orderBy}',
          expand: '{expand}',
        },
      },
    },
    {
      name: 'comments.add',
      class: 'mutation',
      description: 'Add a comment to a Jira issue.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['issueIdOrKey', 'body'],
      },
      request: {
        method: 'POST',
        path: '/rest/api/2/issue/{issueIdOrKey}/comment',
        body: { body: '{body}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'comments.update',
      class: 'mutation',
      description: 'Update a comment on a Jira issue.',
      parameters: {
        type: 'object',
        properties: {
          issueIdOrKey: { type: 'string' },
          commentId: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['issueIdOrKey', 'commentId', 'body'],
      },
      request: {
        method: 'PUT',
        path: '/rest/api/2/issue/{issueIdOrKey}/comment/{commentId}',
        body: { body: '{body}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'comments.delete',
      class: 'mutation',
      description: 'Delete a comment from a Jira issue.',
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
        path: '/rest/api/2/issue/{issueIdOrKey}/comment/{commentId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'users.find',
      class: 'read',
      description: 'Search Jira users by username, key, or query.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          key: { type: 'string' },
          startAt: { type: 'integer' },
          maxResults: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/rest/api/2/user/search',
        query: {
          username: '{username}',
          key: '{key}',
          startAt: '{startAt}',
          maxResults: '{maxResults}',
        },
      },
    },
  ],
})
