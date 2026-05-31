import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Beamer connector.
 *
 * Beamer is an in-app announcement / changelog / feedback-board product. The
 * public REST API is at `https://api.getbeamer.com/v0` and is authenticated by
 * sending the workspace API key in the `Beamer-Api-Key` request header. Keys
 * are minted from the Beamer dashboard → Settings → REST API.
 *
 * The activepieces `beamer` piece exposes four `actions` and zero `triggers`:
 *   - createComment           → POST   /feature-requests/{id}/comments
 *   - createNewFeatureRequest → POST   /feature-requests
 *   - createBeamerPost        → POST   /posts
 *   - createVote              → POST   /feature-requests/{id}/votes
 *
 * Each maps 1:1 to a `mutation` capability below. Read-side capabilities are
 * added on top because they are the obvious companions for any LLM agent
 * (pulling the existing post / feature-request list before deciding what to
 * mutate). Webhooks / SSE triggers are not modeled — they belong in a
 * subscription adapter, not the declarative-REST request/response seam.
 */
export const beamerConnector = declarativeRestConnector({
  kind: 'beamer',
  displayName: 'Beamer',
  description:
    'Publish announcement posts, raise and vote on feature requests, and comment on feedback in a Beamer workspace.',
  auth: {
    kind: 'api-key',
    hint: 'Beamer workspace REST API key. Generate one from Beamer dashboard → Settings → REST API.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.getbeamer.com/v0',
  credentialPlacement: { kind: 'header', header: 'Beamer-Api-Key' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  test: { method: 'GET', path: '/posts', query: { maxResults: 1 } },
  capabilities: [
    {
      name: 'posts.query',
      class: 'read',
      description: 'List announcement posts in the workspace, newest first.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: { type: 'integer', description: 'Max number of posts (Beamer caps at 100).' },
          cursor: { type: 'string', description: 'Pagination cursor returned by a previous call.' },
          filter: { type: 'string', description: 'Optional category / status filter expression.' },
        },
      },
      request: {
        method: 'GET',
        path: '/posts',
        query: { maxResults: '{maxResults}', cursor: '{cursor}', filter: '{filter}' },
      },
    },
    {
      name: 'posts.get',
      class: 'read',
      description: 'Read a single announcement post by id.',
      parameters: {
        type: 'object',
        properties: { postId: { type: 'string' } },
        required: ['postId'],
      },
      request: { method: 'GET', path: '/posts/{postId}' },
    },
    {
      name: 'featureRequests.query',
      class: 'read',
      description: 'List feature requests on the workspace feedback board.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: { type: 'integer' },
          cursor: { type: 'string' },
          status: { type: 'string', description: 'Filter by status id (open, planned, in-progress, done, …).' },
        },
      },
      request: {
        method: 'GET',
        path: '/feature-requests',
        query: { maxResults: '{maxResults}', cursor: '{cursor}', status: '{status}' },
      },
    },
    {
      name: 'featureRequests.get',
      class: 'read',
      description: 'Read a single feature request by id.',
      parameters: {
        type: 'object',
        properties: { featureRequestId: { type: 'string' } },
        required: ['featureRequestId'],
      },
      request: { method: 'GET', path: '/feature-requests/{featureRequestId}' },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description:
        'Post a comment on a feature request. Activepieces action: createComment. Either userId or userEmail identifies the author.',
      parameters: {
        type: 'object',
        properties: {
          featureRequestId: {
            type: 'string',
            description: 'Id of the feature request to comment on.',
          },
          text: { type: 'string', description: 'Comment body.' },
          userId: { type: 'string', description: 'Beamer user id of the author.' },
          userEmail: { type: 'string', description: 'Email of the author if userId is not known.' },
          userFirstname: { type: 'string', description: 'Optional display first name.' },
        },
        required: ['featureRequestId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/feature-requests/{featureRequestId}/comments',
        body: {
          text: '{text}',
          userId: '{userId}',
          userEmail: '{userEmail}',
          userFirstname: '{userFirstname}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'featureRequests.create',
      class: 'mutation',
      description:
        'Create a new feature request on the Beamer feedback board. Activepieces action: createNewFeatureRequest.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Feature-request title.' },
          content: { type: 'string', description: 'Long-form description / body.' },
          category: { type: 'string', description: 'Category id for the request.' },
          status: { type: 'string', description: 'Status id (open, planned, …).' },
          requestedby: { type: 'string', description: 'Email of the user requesting the feature.' },
          userFirstname: { type: 'string' },
        },
        required: ['title', 'content', 'requestedby'],
      },
      request: {
        method: 'POST',
        path: '/feature-requests',
        body: {
          title: '{title}',
          content: '{content}',
          category: '{category}',
          status: '{status}',
          requestedby: '{requestedby}',
          userFirstname: '{userFirstname}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'posts.create',
      class: 'mutation',
      description: 'Publish an announcement post in the Beamer workspace. Activepieces action: createBeamerPost.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'Post body — plain text or markdown depending on md flag.' },
          md: { type: 'boolean', description: 'true if content is markdown, false if plain text.' },
          category: { type: 'string' },
          visible: { type: 'string', description: 'public | private | scheduled' },
          showInWidget: { type: 'boolean' },
          showInStandalone: { type: 'boolean' },
          enableFeedback: { type: 'boolean' },
          enableReactions: { type: 'boolean' },
          enableSocialShare: { type: 'boolean' },
          autoOpen: { type: 'boolean' },
          sendPushNotification: { type: 'boolean' },
        },
        required: ['title', 'content', 'category', 'visible'],
      },
      request: {
        method: 'POST',
        path: '/posts',
        body: {
          title: '{title}',
          content: '{content}',
          md: '{md}',
          category: '{category}',
          visible: '{visible}',
          showInWidget: '{showInWidget}',
          showInStandalone: '{showInStandalone}',
          enableFeedback: '{enableFeedback}',
          enableReactions: '{enableReactions}',
          enableSocialShare: '{enableSocialShare}',
          autoOpen: '{autoOpen}',
          sendPushNotification: '{sendPushNotification}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'votes.create',
      class: 'mutation',
      description:
        'Cast a vote on a feature request. Activepieces action: createVote. Vote attribution requires userId or userEmail.',
      parameters: {
        type: 'object',
        properties: {
          featureRequestId: { type: 'string', description: 'Id of the feature request being voted on.' },
          userId: { type: 'string' },
          userEmail: { type: 'string' },
          userFirstname: { type: 'string' },
        },
        required: ['featureRequestId'],
      },
      request: {
        method: 'POST',
        path: '/feature-requests/{featureRequestId}/votes',
        body: {
          userId: '{userId}',
          userEmail: '{userEmail}',
          userFirstname: '{userFirstname}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
