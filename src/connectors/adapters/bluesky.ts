import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Bluesky / AT Protocol adapter.
 *
 * The piece authenticates by calling `com.atproto.server.createSession` with an
 * identifier (handle or email) and an app password. The returned access JWT is
 * then used as a bearer token against the same PDS host for the remaining
 * `app.bsky.*` XRPC endpoints. The connector framework treats the resolved
 * bearer token as the api-key credential and surfaces the PDS host through the
 * baseUrl + per-action XRPC paths.
 *
 * Default PDS host: https://bsky.social
 */
export const blueskyConnector = declarativeRestConnector({
  kind: 'bluesky',
  displayName: 'Bluesky',
  description:
    'Read and write to the AT Protocol network (Bluesky and self-hosted PDS instances): create / like / repost posts, search timeline + author feeds, and resolve thread context.',
  auth: {
    kind: 'api-key',
    hint: 'Bluesky identifier (handle or email) and app password exchanged for an access JWT via com.atproto.server.createSession on the configured PDS host (default https://bsky.social).',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://bsky.social/xrpc',
  test: { method: 'GET', path: '/com.atproto.server.getSession' },
  capabilities: [
    {
      name: 'create.post',
      class: 'mutation',
      description:
        'Create a new post (app.bsky.feed.post record) under the authenticated repo.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          text: { type: 'string' },
          createdAt: { type: 'string' },
          langs: { type: 'array', items: { type: 'string' } },
          reply: { type: 'object' },
          embed: { type: 'object' },
          facets: { type: 'array', items: { type: 'object' } },
        },
        required: ['repo', 'text'],
      },
      request: {
        method: 'POST',
        path: '/com.atproto.repo.createRecord',
        body: {
          repo: '{repo}',
          collection: 'app.bsky.feed.post',
          record: {
            $type: 'app.bsky.feed.post',
            text: '{text}',
            createdAt: '{createdAt}',
            langs: '{langs}',
            reply: '{reply}',
            embed: '{embed}',
            facets: '{facets}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'like.post',
      class: 'mutation',
      description:
        'Like a post by creating an app.bsky.feed.like record pointing at the target post (subject = { uri, cid }).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          subject: {
            type: 'object',
            properties: {
              uri: { type: 'string' },
              cid: { type: 'string' },
            },
            required: ['uri', 'cid'],
          },
          createdAt: { type: 'string' },
        },
        required: ['repo', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/com.atproto.repo.createRecord',
        body: {
          repo: '{repo}',
          collection: 'app.bsky.feed.like',
          record: {
            $type: 'app.bsky.feed.like',
            subject: '{subject}',
            createdAt: '{createdAt}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'repost.post',
      class: 'mutation',
      description:
        'Repost a post by creating an app.bsky.feed.repost record pointing at the target post (subject = { uri, cid }).',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          subject: {
            type: 'object',
            properties: {
              uri: { type: 'string' },
              cid: { type: 'string' },
            },
            required: ['uri', 'cid'],
          },
          createdAt: { type: 'string' },
        },
        required: ['repo', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/com.atproto.repo.createRecord',
        body: {
          repo: '{repo}',
          collection: 'app.bsky.feed.repost',
          record: {
            $type: 'app.bsky.feed.repost',
            subject: '{subject}',
            createdAt: '{createdAt}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'find.post',
      class: 'read',
      description:
        'Search the public Bluesky post index (app.bsky.feed.searchPosts) by query, with optional author / language / sort / pagination filters.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          author: { type: 'string' },
          lang: { type: 'string' },
          sort: { type: 'string' },
          since: { type: 'string' },
          until: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['q'],
      },
      request: {
        method: 'GET',
        path: '/app.bsky.feed.searchPosts',
        query: {
          q: '{q}',
          author: '{author}',
          lang: '{lang}',
          sort: '{sort}',
          since: '{since}',
          until: '{until}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'find.thread',
      class: 'read',
      description:
        'Resolve full thread context for a post URI (app.bsky.feed.getPostThread), including ancestor / descendant replies up to the requested depth.',
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          depth: { type: 'integer' },
          parentHeight: { type: 'integer' },
        },
        required: ['uri'],
      },
      request: {
        method: 'GET',
        path: '/app.bsky.feed.getPostThread',
        query: {
          uri: '{uri}',
          depth: '{depth}',
          parentHeight: '{parentHeight}',
        },
      },
    },
    {
      name: 'author.feed',
      class: 'read',
      description:
        'Read an author\'s feed (app.bsky.feed.getAuthorFeed) — backs the "new posts by author" trigger. Use filter to control replies/reposts inclusion.',
      parameters: {
        type: 'object',
        properties: {
          actor: { type: 'string' },
          filter: { type: 'string' },
          includePins: { type: 'boolean' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['actor'],
      },
      request: {
        method: 'GET',
        path: '/app.bsky.feed.getAuthorFeed',
        query: {
          actor: '{actor}',
          filter: '{filter}',
          includePins: '{includePins}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'timeline.read',
      class: 'read',
      description:
        'Read the authenticated user\'s home timeline (app.bsky.feed.getTimeline) — backs the "new timeline posts" trigger.',
      parameters: {
        type: 'object',
        properties: {
          algorithm: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/app.bsky.feed.getTimeline',
        query: {
          algorithm: '{algorithm}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'followers.list',
      class: 'read',
      description:
        'List followers of an actor (app.bsky.graph.getFollowers) — backs the "new follower on account" trigger via polling + cursor diff.',
      parameters: {
        type: 'object',
        properties: {
          actor: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['actor'],
      },
      request: {
        method: 'GET',
        path: '/app.bsky.graph.getFollowers',
        query: {
          actor: '{actor}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      // AT Protocol record delete: repo + collection + rkey identify a single
      // record in the authenticated user's repo. Callers extract the rkey from
      // the post AT URI (at://did:.../app.bsky.feed.post/{rkey}).
      name: 'post.delete',
      class: 'mutation',
      description: 'Delete a post by URI.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          rkey: { type: 'string', description: 'Record key extracted from the post AT URI.' },
        },
        required: ['repo', 'rkey'],
      },
      request: {
        method: 'POST',
        path: '/com.atproto.repo.deleteRecord',
        body: {
          repo: '{repo}',
          collection: 'app.bsky.feed.post',
          rkey: '{rkey}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      // Follow = createRecord under app.bsky.graph.follow with subject = DID.
      name: 'follow.user',
      class: 'mutation',
      description: 'Follow a Bluesky account.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          subject: { type: 'string', description: 'DID of the actor to follow.' },
          createdAt: { type: 'string' },
        },
        required: ['repo', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/com.atproto.repo.createRecord',
        body: {
          repo: '{repo}',
          collection: 'app.bsky.graph.follow',
          record: {
            $type: 'app.bsky.graph.follow',
            subject: '{subject}',
            createdAt: '{createdAt}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      // Unfollow = deleteRecord on the follow record's rkey. Callers resolve
      // rkey from the follow's AT URI returned by createRecord or listRecords.
      name: 'unfollow.user',
      class: 'mutation',
      description: 'Unfollow a Bluesky account.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          rkey: { type: 'string', description: 'Record key of the follow record to delete.' },
        },
        required: ['repo', 'rkey'],
      },
      request: {
        method: 'POST',
        path: '/com.atproto.repo.deleteRecord',
        body: {
          repo: '{repo}',
          collection: 'app.bsky.graph.follow',
          rkey: '{rkey}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      // Mute is a server-side block list operation (not a record under the
      // user's repo) — single-arg `actor` accepts a handle or DID.
      name: 'mute.user',
      class: 'mutation',
      description: 'Mute an account.',
      parameters: {
        type: 'object',
        properties: {
          actor: { type: 'string', description: 'Handle or DID of the actor to mute.' },
        },
        required: ['actor'],
      },
      request: {
        method: 'POST',
        path: '/app.bsky.graph.muteActor',
        body: { actor: '{actor}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
