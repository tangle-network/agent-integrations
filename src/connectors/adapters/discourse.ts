import { declarativeRestConnector } from './declarative-rest.js'

const topicIdParameter = {
  topicId: { type: 'integer', description: 'Discourse topic id.' },
}

const postIdParameter = {
  postId: { type: 'integer', description: 'Discourse post id.' },
}

export const discourseConnector = declarativeRestConnector({
  kind: 'discourse',
  displayName: 'Discourse',
  description: 'Manage Discourse categories, topics, posts, groups, notifications, search, and moderation.',
  auth: {
    kind: 'api-key',
    hint: 'JSON containing apiKey and apiUsername. Use a dedicated, narrowly scoped Discourse API key.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  requirePublicHttpsBaseUrl: true,
  credentialPlacement: {
    kind: 'structured-headers',
    fields: { apiKey: 'Api-Key', apiUsername: 'Api-Username' },
  },
  test: { method: 'GET', path: '/notifications.json' },
  capabilities: [
    {
      name: 'categories.list',
      class: 'read',
      description: 'List visible categories and optional subcategories.',
      parameters: {
        type: 'object',
        properties: { includeSubcategories: { type: 'boolean' } },
      },
      request: {
        method: 'GET',
        path: '/categories.json',
        query: { include_subcategories: '{includeSubcategories}' },
      },
    },
    {
      name: 'categories.create',
      class: 'mutation',
      description: 'Create a category with provider-native settings and permissions.',
      parameters: {
        type: 'object',
        properties: { category: { type: 'object', description: 'Category definition containing at least name.' } },
        required: ['category'],
      },
      request: { method: 'POST', path: '/categories.json', body: '{category}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'categories.update',
      class: 'mutation',
      description: 'Update a category.',
      parameters: {
        type: 'object',
        properties: {
          categoryId: { type: 'integer' },
          category: { type: 'object', description: 'Provider-native category patch.' },
        },
        required: ['categoryId', 'category'],
      },
      request: { method: 'PUT', path: '/categories/{categoryId}.json', body: '{category}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'topics.latest',
      class: 'read',
      description: 'List latest topics.',
      parameters: {
        type: 'object',
        properties: {
          order: { type: 'string', enum: ['default', 'created', 'activity', 'views', 'posts', 'category', 'likes', 'op_likes', 'posters'] },
          ascending: { type: 'boolean' },
          perPage: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/latest.json',
        query: { order: '{order}', ascending: '{ascending}', per_page: '{perPage}' },
      },
    },
    {
      name: 'topics.get',
      class: 'read',
      description: 'Read a topic and its post stream.',
      parameters: {
        type: 'object',
        properties: topicIdParameter,
        required: ['topicId'],
      },
      request: { method: 'GET', path: '/t/{topicId}.json' },
    },
    {
      name: 'topics.create',
      class: 'mutation',
      description: 'Create a topic.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          raw: { type: 'string', description: 'Raw Markdown post body.' },
          categoryId: { type: 'integer' },
          externalId: { type: 'string' },
          embedUrl: { type: 'string', format: 'uri' },
          autoTrack: { type: 'boolean' },
        },
        required: ['title', 'raw'],
      },
      request: {
        method: 'POST',
        path: '/posts.json',
        body: {
          title: '{title}',
          raw: '{raw}',
          category: '{categoryId}',
          external_id: '{externalId}',
          embed_url: '{embedUrl}',
          auto_track: '{autoTrack}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'topics.update',
      class: 'mutation',
      description: 'Update a topic title or category.',
      parameters: {
        type: 'object',
        properties: {
          ...topicIdParameter,
          title: { type: 'string' },
          categoryId: { type: 'integer' },
        },
        required: ['topicId'],
      },
      request: {
        method: 'PUT',
        path: '/t/-/{topicId}.json',
        body: { title: '{title}', category_id: '{categoryId}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'topics.set-status',
      class: 'mutation',
      description: 'Close, pin, archive, or hide a topic, or reverse that status.',
      parameters: {
        type: 'object',
        properties: {
          ...topicIdParameter,
          status: { type: 'string', enum: ['closed', 'pinned', 'pinned_globally', 'archived', 'visible'] },
          enabled: { type: 'boolean' },
          until: { type: 'string', description: 'Required by Discourse for temporary pinning.' },
        },
        required: ['topicId', 'status', 'enabled'],
      },
      request: {
        method: 'PUT',
        path: '/t/{topicId}/status.json',
        body: { status: '{status}', enabled: '{enabled}', until: '{until}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'topics.delete',
      class: 'mutation',
      description: 'Delete a topic.',
      parameters: {
        type: 'object',
        properties: topicIdParameter,
        required: ['topicId'],
      },
      request: { method: 'DELETE', path: '/t/{topicId}.json' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'posts.get',
      class: 'read',
      description: 'Read one post.',
      parameters: {
        type: 'object',
        properties: postIdParameter,
        required: ['postId'],
      },
      request: { method: 'GET', path: '/posts/{postId}.json' },
    },
    {
      name: 'posts.create',
      class: 'mutation',
      description: 'Reply to a topic.',
      parameters: {
        type: 'object',
        properties: {
          ...topicIdParameter,
          raw: { type: 'string', description: 'Raw Markdown post body.' },
          replyToPostNumber: { type: 'integer' },
        },
        required: ['topicId', 'raw'],
      },
      request: {
        method: 'POST',
        path: '/posts.json',
        body: { topic_id: '{topicId}', raw: '{raw}', reply_to_post_number: '{replyToPostNumber}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'posts.update',
      class: 'mutation',
      description: 'Edit a post with an optional reason.',
      parameters: {
        type: 'object',
        properties: {
          ...postIdParameter,
          raw: { type: 'string' },
          editReason: { type: 'string' },
          bypassBump: { type: 'boolean' },
        },
        required: ['postId', 'raw'],
      },
      request: {
        method: 'PUT',
        path: '/posts/{postId}.json',
        body: {
          post: { raw: '{raw}', edit_reason: '{editReason}' },
          bypass_bump: '{bypassBump}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'posts.delete',
      class: 'mutation',
      description: 'Delete a post.',
      parameters: {
        type: 'object',
        properties: postIdParameter,
        required: ['postId'],
      },
      request: { method: 'DELETE', path: '/posts/{postId}.json' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'search.query',
      class: 'read',
      description: 'Search topics, posts, users, and categories using Discourse search syntax.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['query'],
      },
      request: { method: 'GET', path: '/search.json', query: { q: '{query}', page: '{page}' } },
    },
    {
      name: 'tags.list',
      class: 'read',
      description: 'List tags.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/tags.json' },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read a public user profile.',
      parameters: {
        type: 'object',
        properties: { username: { type: 'string' } },
        required: ['username'],
      },
      request: { method: 'GET', path: '/u/{username}.json' },
    },
    {
      name: 'groups.list',
      class: 'read',
      description: 'List groups.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/groups.json' },
    },
    {
      name: 'groups.get',
      class: 'read',
      description: 'Read a group by name.',
      parameters: {
        type: 'object',
        properties: { groupName: { type: 'string' } },
        required: ['groupName'],
      },
      request: { method: 'GET', path: '/groups/{groupName}.json' },
    },
    {
      name: 'groups.members.list',
      class: 'read',
      description: 'List members of a group.',
      parameters: {
        type: 'object',
        properties: { groupName: { type: 'string' } },
        required: ['groupName'],
      },
      request: { method: 'GET', path: '/groups/{groupName}/members.json' },
    },
    {
      name: 'groups.members.add',
      class: 'mutation',
      description: 'Add comma-separated usernames to a group.',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'integer' }, usernames: { type: 'string' } },
        required: ['groupId', 'usernames'],
      },
      request: { method: 'PUT', path: '/groups/{groupId}/members.json', body: { usernames: '{usernames}' } },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'groups.members.remove',
      class: 'mutation',
      description: 'Remove comma-separated usernames from a group.',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'integer' }, usernames: { type: 'string' } },
        required: ['groupId', 'usernames'],
      },
      request: { method: 'DELETE', path: '/groups/{groupId}/members.json', body: { usernames: '{usernames}' } },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'notifications.list',
      class: 'read',
      description: 'List notifications for the API username.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1 },
          recent: { type: 'boolean' },
          unread: { type: 'boolean' },
        },
      },
      request: {
        method: 'GET',
        path: '/notifications.json',
        query: { limit: '{limit}', recent: '{recent}', unread: '{unread}' },
      },
    },
    {
      name: 'notifications.mark-read',
      class: 'mutation',
      description: 'Mark one notification, or all notifications, as read.',
      parameters: {
        type: 'object',
        properties: { notificationId: { type: 'integer' } },
      },
      request: {
        method: 'PUT',
        path: '/notifications/mark-read.json',
        body: { id: '{notificationId}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'moderation.users.suspend',
      class: 'mutation',
      description: 'Suspend a user until a date with an auditable reason.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'integer' },
          suspendUntil: { type: 'string', format: 'date' },
          reason: { type: 'string' },
          message: { type: 'string' },
          postAction: { type: 'string' },
        },
        required: ['userId', 'suspendUntil', 'reason'],
      },
      request: {
        method: 'PUT',
        path: '/admin/users/{userId}/suspend.json',
        body: {
          suspend_until: '{suspendUntil}',
          reason: '{reason}',
          message: '{message}',
          post_action: '{postAction}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
