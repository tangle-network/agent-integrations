import { declarativeRestConnector } from './declarative-rest.js'

export const heartbeatConnector = declarativeRestConnector({
  kind: 'heartbeat',
  displayName: 'Heartbeat',
  description: 'Monitoring and alerting made easy. Create and manage users in your Heartbeat community.',
  auth: { kind: 'api-key', hint: 'Heartbeat API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.heartbeat.com/api',
  test: { method: 'GET', path: '/users' },
  capabilities: [
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a new user in Heartbeat community.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The user name' },
          email: { type: 'string', description: 'The user email' },
          role_id: { type: 'string', description: 'The role the user should have' },
          group_ids: { type: 'array', items: { type: 'string' }, description: 'A list of the ids of the groups that the user should belong to' },
          profile_picture: { type: 'string', description: 'A Data URI scheme in the JPG, GIF, or PNG format. Ensure you use the proper content type (image/jpeg, image/png, image/gif) that matches the image data being provided' },
          bio: { type: 'string', description: 'The user bio' },
          status: { type: 'string', description: 'The user status' },
          linkedin: { type: 'string', description: 'A link to the user LinkedIn profile' },
          twitter: { type: 'string', description: 'A link to the user Twitter profile' },
          instagram: { type: 'string', description: 'A link to the user Instagram profile' },
          create_introduction_thread: { type: 'boolean', description: 'If true and a value for bio is provided, an introduction thread for the user will be created in the channel designated for introductions in your community settings' },
        },
        required: ['name', 'email', 'role_id'],
      },
      request: {
        method: 'POST',
        path: '/users',
        body: {
          name: '{name}',
          email: '{email}',
          role_id: '{role_id}',
          group_ids: '{group_ids}',
          profile_picture: '{profile_picture}',
          bio: '{bio}',
          status: '{status}',
          linkedin: '{linkedin}',
          twitter: '{twitter}',
          instagram: '{instagram}',
          create_introduction_thread: '{create_introduction_thread}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'threads.create',
      class: 'mutation',
      description: 'Create a new thread in a Heartbeat channel.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'The id of the channel where the thread will be created.' },
          title: { type: 'string', description: 'The title of the thread.' },
          body: { type: 'string', description: 'The body of the thread.' },
          sender_user_id: { type: 'string', description: 'The id of the user who will be recorded as the author of the thread.' },
        },
        required: ['channel_id', 'title', 'body', 'sender_user_id'],
      },
      request: {
        method: 'POST',
        path: '/threads',
        body: {
          channel_id: '{channel_id}',
          title: '{title}',
          body: '{body}',
          sender_user_id: '{sender_user_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.create',
      class: 'mutation',
      description: 'Post a message to an existing Heartbeat thread.',
      parameters: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'The id of the thread to post the message to.' },
          body: { type: 'string', description: 'The body of the message.' },
          sender_user_id: { type: 'string', description: 'The id of the user who will be recorded as the author of the message.' },
        },
        required: ['thread_id', 'body', 'sender_user_id'],
      },
      request: {
        method: 'POST',
        path: '/messages',
        body: {
          thread_id: '{thread_id}',
          body: '{body}',
          sender_user_id: '{sender_user_id}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
