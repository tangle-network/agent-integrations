import { declarativeRestConnector } from './declarative-rest.js'

export const pushbulletConnector = declarativeRestConnector({
  kind: 'pushbullet',
  displayName: 'Pushbullet',
  description: 'Send cross-device notifications via Pushbullet.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.pushbullet.com/oauth2/authorize',
    tokenUrl: 'https://api.pushbullet.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'PUSHBULLET_OAUTH_CLIENT_ID',
    clientSecretEnv: 'PUSHBULLET_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.pushbullet.com/v1',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'notifications.sendLink',
      class: 'mutation',
      description: 'Send a link notification.',
      parameters: {
        type: 'object',
        properties: {
          deviceIden: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['title', 'body', 'url'],
      },
      request: {
        method: 'POST',
        path: '/pushes',
        body: {
          type: 'link',
          device_iden: '{deviceIden}',
          title: '{title}',
          body: '{body}',
          url: '{url}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'notifications.sendNote',
      class: 'mutation',
      description: 'Send a note notification.',
      parameters: {
        type: 'object',
        properties: {
          deviceIden: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['title', 'body'],
      },
      request: {
        method: 'POST',
        path: '/pushes',
        body: {
          type: 'note',
          device_iden: '{deviceIden}',
          title: '{title}',
          body: '{body}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
