import { declarativeRestConnector } from './declarative-rest.js'

// Canny REST API (https://developers.canny.io). All endpoints are POST and
// authenticate via the `apiKey` field in the JSON body. Read endpoints accept
// optional filters/paging in the same body. The adapter mirrors the
// activepieces piece-canny surface: post create / retrieve / list and vote
// create / delete. The hub's credential placement is delegated to the runtime
// (api-key auth); the executor forwards the resolved key into the body under
// `apiKey` per Canny's convention.

export const cannyConnector = declarativeRestConnector({
  kind: 'canny',
  displayName: 'Canny',
  description:
    'Manage Canny product feedback: create, retrieve, and list posts; create and delete votes.',
  auth: { kind: 'api-key', hint: 'Canny API key (Settings → API).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://canny.io/api/v1',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  test: { method: 'POST', path: '/boards/list' },
  capabilities: [
    {
      name: 'posts.create',
      class: 'mutation',
      description:
        'Create a post on behalf of a Canny user. Mirrors activepieces createPostAction.',
      parameters: {
        type: 'object',
        properties: {
          boardID: { type: 'string', description: 'Board the post belongs to.' },
          authorID: { type: 'string', description: 'Canny user ID of the post author.' },
          title: { type: 'string', description: 'Brief title for the post.' },
          details: { type: 'string', description: 'Longer body for the post.' },
          byID: {
            type: 'string',
            description: 'Admin creating the post on behalf of the author (optional).',
          },
          categoryID: { type: 'string', description: 'Category to assign (optional).' },
          ownerID: {
            type: 'string',
            description: 'User responsible for completing the work (optional).',
          },
          eta: { type: 'string', description: 'Estimated delivery date in MM/YYYY (optional).' },
          etaPublic: {
            type: 'boolean',
            description: 'Whether the ETA is visible to all users (optional).',
          },
          customFields: {
            type: 'object',
            description: 'Custom field map (keys ≤ 30 chars, values ≤ 200 chars).',
          },
          createdAt: {
            type: 'string',
            description: 'ISO-8601 creation date for migrated posts (optional).',
          },
          imageURLs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Image attachment URLs (optional).',
          },
        },
        required: ['boardID', 'authorID', 'title', 'details'],
      },
      request: {
        method: 'POST',
        path: '/posts/create',
        body: {
          boardID: '{boardID}',
          authorID: '{authorID}',
          title: '{title}',
          details: '{details}',
          byID: '{byID}',
          categoryID: '{categoryID}',
          ownerID: '{ownerID}',
          eta: '{eta}',
          etaPublic: '{etaPublic}',
          customFields: '{customFields}',
          createdAt: '{createdAt}',
          imageURLs: '{imageURLs}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'posts.retrieve',
      class: 'read',
      description:
        'Retrieve a single Canny post by ID, board+URL name, or board+title. Mirrors retrievePostAction.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Canny post ID (preferred lookup).' },
          boardID: {
            type: 'string',
            description: 'Required when looking up by urlName or title.',
          },
          urlName: { type: 'string', description: 'Slug used in the public post URL.' },
          title: { type: 'string', description: 'Exact post title.' },
        },
      },
      request: {
        method: 'POST',
        path: '/posts/retrieve',
        body: {
          id: '{id}',
          boardID: '{boardID}',
          urlName: '{urlName}',
          title: '{title}',
        },
      },
    },
    {
      name: 'posts.list',
      class: 'read',
      description:
        'List posts on a board with optional filters and pagination. Mirrors listPostsAction.',
      parameters: {
        type: 'object',
        properties: {
          boardID: { type: 'string', description: 'Board to list posts from.' },
          authorID: { type: 'string', description: 'Filter to posts by this author.' },
          companyID: { type: 'string', description: 'Filter to posts from voters at a company.' },
          tagIDs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter to posts with all of these tag IDs.',
          },
          status: {
            type: 'string',
            description: 'Filter by status (e.g. open, planned, in progress, complete, closed).',
          },
          sort: {
            type: 'string',
            description: 'Sort order: newest, oldest, relevance, score, statusChanged, trending.',
          },
          search: { type: 'string', description: 'Full-text query.' },
          limit: { type: 'integer', description: 'Page size (Canny max 100).' },
          skip: { type: 'integer', description: 'Pagination offset.' },
        },
      },
      request: {
        method: 'POST',
        path: '/posts/list',
        body: {
          boardID: '{boardID}',
          authorID: '{authorID}',
          companyID: '{companyID}',
          tagIDs: '{tagIDs}',
          status: '{status}',
          sort: '{sort}',
          search: '{search}',
          limit: '{limit}',
          skip: '{skip}',
        },
      },
    },
    {
      name: 'votes.create',
      class: 'mutation',
      description: 'Cast a vote on a post on behalf of a Canny user. Mirrors createVoteAction.',
      parameters: {
        type: 'object',
        properties: {
          postID: { type: 'string', description: 'Post being voted on.' },
          voterID: { type: 'string', description: 'Canny user ID casting the vote.' },
          byID: {
            type: 'string',
            description: 'Admin voting on behalf of the voter (optional).',
          },
          votedAt: {
            type: 'string',
            description: 'ISO-8601 vote timestamp for migrated votes (optional).',
          },
        },
        required: ['postID', 'voterID'],
      },
      request: {
        method: 'POST',
        path: '/votes/create',
        body: {
          postID: '{postID}',
          voterID: '{voterID}',
          byID: '{byID}',
          votedAt: '{votedAt}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'votes.delete',
      class: 'mutation',
      description: "Remove a user's vote from a Canny post. Mirrors deleteVoteAction.",
      parameters: {
        type: 'object',
        properties: {
          postID: { type: 'string', description: 'Post to remove the vote from.' },
          voterID: { type: 'string', description: 'Canny user ID whose vote should be removed.' },
        },
        required: ['postID', 'voterID'],
      },
      request: {
        method: 'POST',
        path: '/votes/delete',
        body: {
          postID: '{postID}',
          voterID: '{voterID}',
        },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
