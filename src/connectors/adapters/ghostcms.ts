import { declarativeRestConnector } from './declarative-rest.js'

export const ghostcmsConnector = declarativeRestConnector({
  kind: 'ghostcms',
  displayName: 'Ghost CMS',
  description:
    'Create or update Ghost members, posts, and look up users via the Ghost Admin API.',
  auth: {
    kind: 'api-key',
    hint: 'Ghost Admin API key in the form "<id>:<secret>"; the publication URL is supplied as connection metadata (baseUrl).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/ghost/api/admin/site/' },
  capabilities: [
    {
      name: 'members.create',
      class: 'mutation',
      description: 'Create a Ghost member.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          note: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/ghost/api/admin/members/',
        body: {
          members: [
            {
              email: '{email}',
              name: '{name}',
              note: '{note}',
              labels: '{labels}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'members.update',
      class: 'mutation',
      description: 'Update a Ghost member by id.',
      parameters: {
        type: 'object',
        properties: {
          memberId: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          note: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['memberId'],
      },
      request: {
        method: 'PUT',
        path: '/ghost/api/admin/members/{memberId}/',
        body: {
          members: [
            {
              email: '{email}',
              name: '{name}',
              note: '{note}',
              labels: '{labels}',
            },
          ],
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'members.find',
      class: 'read',
      description: 'Search Ghost members by email or NQL filter.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          filter: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/ghost/api/admin/members/',
        query: {
          filter: '{filter}',
          search: '{email}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'posts.create',
      class: 'mutation',
      description: 'Create a Ghost post.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'published', 'scheduled'] },
          publishedAt: { type: 'string' },
          html: { type: 'string' },
          customExcerpt: { type: 'string' },
          featured: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'status', 'html'],
      },
      request: {
        method: 'POST',
        path: '/ghost/api/admin/posts/',
        query: { source: 'html' },
        body: {
          posts: [
            {
              title: '{title}',
              slug: '{slug}',
              status: '{status}',
              published_at: '{publishedAt}',
              html: '{html}',
              custom_excerpt: '{customExcerpt}',
              featured: '{featured}',
              tags: '{tags}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'users.find',
      class: 'read',
      description: 'List or search Ghost staff users.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/ghost/api/admin/users/',
        query: {
          filter: '{filter}',
          limit: '{limit}',
        },
      },
    },
  ],
})
