import { declarativeRestConnector } from './declarative-rest.js'

// Linear exposes a single GraphQL endpoint at https://api.linear.app/graphql.
// We model each high-level capability as a POST to /graphql with a fixed query
// string and a templated `variables` payload, so the declarative-REST runtime
// can dispatch them without a GraphQL-specific client. Callers pass GraphQL
// variables as a single `variables` argument that the declarative-REST renderer
// substitutes verbatim into the request body — this matches Linear's documented
// variable shapes (IssueCreateInput, IssueFilter, etc.) without us having to
// re-flatten them into REST-style query params.
//
// Auth + scope catalogue: https://developers.linear.app/docs/oauth/authentication
// API reference (variable input types): https://developers.linear.app/docs/graphql/working-with-the-graphql-api
const ISSUE_FRAGMENT = `
  id
  identifier
  title
  description
  state { id name type }
  priority
  assignee { id name email }
  team { id key name }
  createdAt
  updatedAt
  url
`

const COMMENT_FRAGMENT = `
  id
  body
  user { id name email }
  issue { id identifier }
  createdAt
  updatedAt
  url
`

const PROJECT_FRAGMENT = `
  id
  name
  description
  state
  progress
  startDate
  targetDate
  url
`

const TEAM_FRAGMENT = `
  id
  key
  name
  description
`

const VIEWER_QUERY = `query Viewer { viewer { id name email organization { id name urlKey } } }`

const ISSUE_GET_QUERY = `query IssueGet($id: String!) { issue(id: $id) {${ISSUE_FRAGMENT}} }`

const ISSUES_SEARCH_QUERY = `
  query IssuesSearch($filter: IssueFilter, $first: Int, $after: String, $orderBy: PaginationOrderBy) {
    issues(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
      nodes {${ISSUE_FRAGMENT}}
      pageInfo { hasNextPage endCursor }
    }
  }
`

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {${ISSUE_FRAGMENT}}
    }
  }
`

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {${ISSUE_FRAGMENT}}
    }
  }
`

const ISSUE_DELETE_MUTATION = `
  mutation IssueDelete($id: String!) {
    issueDelete(id: $id) { success }
  }
`

const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {${COMMENT_FRAGMENT}}
    }
  }
`

const COMMENTS_LIST_QUERY = `
  query CommentsList($filter: CommentFilter, $first: Int, $after: String) {
    comments(filter: $filter, first: $first, after: $after) {
      nodes {${COMMENT_FRAGMENT}}
      pageInfo { hasNextPage endCursor }
    }
  }
`

const PROJECTS_LIST_QUERY = `
  query ProjectsList($filter: ProjectFilter, $first: Int, $after: String) {
    projects(filter: $filter, first: $first, after: $after) {
      nodes {${PROJECT_FRAGMENT}}
      pageInfo { hasNextPage endCursor }
    }
  }
`

const PROJECT_CREATE_MUTATION = `
  mutation ProjectCreate($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project {${PROJECT_FRAGMENT}}
    }
  }
`

const TEAMS_LIST_QUERY = `
  query TeamsList($first: Int, $after: String) {
    teams(first: $first, after: $after) {
      nodes {${TEAM_FRAGMENT}}
      pageInfo { hasNextPage endCursor }
    }
  }
`

export const linearConnector = declarativeRestConnector({
  kind: 'linear',
  displayName: 'Linear',
  description: 'Query, create, and update Linear issues, comments, projects, and teams via the Linear GraphQL API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: ['read', 'write', 'issues:create', 'comments:create'],
    clientIdEnv: 'LINEAR_OAUTH_CLIENT_ID',
    clientSecretEnv: 'LINEAR_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.linear.app',
  test: {
    method: 'POST',
    path: '/graphql',
    body: { query: VIEWER_QUERY },
  },
  capabilities: [
    {
      name: 'viewer.get',
      class: 'read',
      description: 'Return the authenticated Linear user and their organization.',
      parameters: { type: 'object', properties: {} },
      request: {
        method: 'POST',
        path: '/graphql',
        body: { query: VIEWER_QUERY },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'issues.get',
      class: 'read',
      description: 'Read a single Linear issue by id or identifier (e.g. ENG-123). Pass `{ variables: { id: "ENG-1" } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: ISSUE_GET_QUERY,
          variables: '{variables}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'issues.search',
      class: 'read',
      description: 'Search Linear issues with a GraphQL IssueFilter; supports cursor pagination. Pass `{ variables: { filter, first, after, orderBy } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              filter: { type: 'object' },
              first: { type: 'integer', minimum: 1, maximum: 250 },
              after: { type: 'string' },
              orderBy: { type: 'string', enum: ['createdAt', 'updatedAt'] },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: ISSUES_SEARCH_QUERY,
          variables: '{variables}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'issues.create',
      class: 'mutation',
      description: 'Create a Linear issue. Pass `{ variables: { input: IssueCreateInput } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              input: {
                type: 'object',
                properties: {
                  teamId: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  priority: { type: 'integer', minimum: 0, maximum: 4 },
                  assigneeId: { type: 'string' },
                  stateId: { type: 'string' },
                  projectId: { type: 'string' },
                  labelIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['teamId', 'title'],
              },
            },
            required: ['input'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: ISSUE_CREATE_MUTATION,
          variables: '{variables}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['issues:create'],
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description: 'Update fields on an existing Linear issue. Pass `{ variables: { id, input: IssueUpdateInput } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              input: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  priority: { type: 'integer', minimum: 0, maximum: 4 },
                  assigneeId: { type: 'string' },
                  stateId: { type: 'string' },
                  projectId: { type: 'string' },
                  labelIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            required: ['id', 'input'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: ISSUE_UPDATE_MUTATION,
          variables: '{variables}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'issues.delete',
      class: 'mutation',
      description: 'Archive (delete) a Linear issue. Pass `{ variables: { id } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: ISSUE_DELETE_MUTATION,
          variables: '{variables}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Add a comment to a Linear issue. Pass `{ variables: { input: CommentCreateInput } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              input: {
                type: 'object',
                properties: {
                  issueId: { type: 'string' },
                  body: { type: 'string' },
                  parentId: { type: 'string' },
                },
                required: ['issueId', 'body'],
              },
            },
            required: ['input'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: COMMENT_CREATE_MUTATION,
          variables: '{variables}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['comments:create'],
    },
    {
      name: 'comments.list',
      class: 'read',
      description: 'List comments matching a Linear CommentFilter; cursor paginated. Pass `{ variables: { filter, first, after } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              filter: { type: 'object' },
              first: { type: 'integer', minimum: 1, maximum: 250 },
              after: { type: 'string' },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: COMMENTS_LIST_QUERY,
          variables: '{variables}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List Linear projects matching an optional ProjectFilter. Pass `{ variables: { filter, first, after } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              filter: { type: 'object' },
              first: { type: 'integer', minimum: 1, maximum: 250 },
              after: { type: 'string' },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: PROJECTS_LIST_QUERY,
          variables: '{variables}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a Linear project. Pass `{ variables: { input: ProjectCreateInput } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              input: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  teamIds: { type: 'array', items: { type: 'string' } },
                  startDate: { type: 'string' },
                  targetDate: { type: 'string' },
                  leadId: { type: 'string' },
                },
                required: ['name', 'teamIds'],
              },
            },
            required: ['input'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: PROJECT_CREATE_MUTATION,
          variables: '{variables}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List Linear teams visible to the authenticated user. Pass `{ variables: { first, after } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              first: { type: 'integer', minimum: 1, maximum: 250 },
              after: { type: 'string' },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: TEAMS_LIST_QUERY,
          variables: '{variables}',
        },
      },
      requiredScopes: ['read'],
    },
  ],
})
