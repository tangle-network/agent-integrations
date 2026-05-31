import { declarativeRestConnector } from './declarative-rest.js'

// Matrix uses a per-account homeserver base URL plus a long-lived access token.
// The homeserver is captured at connect time as source metadata.homeserver
// (e.g. https://matrix.org), and the access token rides as a bearer credential.
// All endpoints below are Matrix client-server API v3.
export const matrixConnector = declarativeRestConnector({
  kind: 'matrix',
  displayName: 'Matrix',
  description: 'Send messages and read room state on a Matrix homeserver.',
  auth: { kind: 'api-key', hint: 'Matrix access token (Element: Settings -> Help & About -> Advanced).' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'homeserver' },
  test: { method: 'GET', path: '/_matrix/client/v3/account/whoami' },
  capabilities: [
    {
      name: 'account.whoami',
      class: 'read',
      description: 'Return the Matrix user id the access token belongs to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/_matrix/client/v3/account/whoami' },
    },
    {
      name: 'rooms.resolveAlias',
      class: 'read',
      description: 'Resolve a Matrix room alias (e.g. #room:server.tld) to its canonical room id.',
      parameters: {
        type: 'object',
        properties: { roomAlias: { type: 'string', description: 'Room alias including the leading #.' } },
        required: ['roomAlias'],
      },
      request: { method: 'GET', path: '/_matrix/client/v3/directory/room/{roomAlias}' },
    },
    {
      name: 'rooms.joined',
      class: 'read',
      description: 'List the room ids the authenticated user is currently joined to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/_matrix/client/v3/joined_rooms' },
    },
    {
      name: 'rooms.members',
      class: 'read',
      description: 'List the members of a Matrix room.',
      parameters: {
        type: 'object',
        properties: { roomId: { type: 'string' } },
        required: ['roomId'],
      },
      request: { method: 'GET', path: '/_matrix/client/v3/rooms/{roomId}/members' },
    },
    {
      name: 'rooms.state',
      class: 'read',
      description: 'Read the full state of a Matrix room.',
      parameters: {
        type: 'object',
        properties: { roomId: { type: 'string' } },
        required: ['roomId'],
      },
      request: { method: 'GET', path: '/_matrix/client/v3/rooms/{roomId}/state' },
    },
    {
      name: 'send.message',
      class: 'mutation',
      description:
        'Send a message event into a Matrix room. txnId MUST be a client-generated transaction id; ' +
        'reusing the same txnId for the same room is a no-op on the homeserver.',
      parameters: {
        type: 'object',
        properties: {
          roomId: { type: 'string', description: 'Matrix room id (already resolved from any alias).' },
          txnId: { type: 'string', description: 'Client-side dedupe key; pass the idempotency token.' },
          body: { type: 'string', description: 'Message body (plain text).' },
          msgtype: { type: 'string', description: 'Matrix msgtype, defaults to m.text.' },
          format: { type: 'string', description: 'Optional org.matrix.custom.html when sending formatted_body.' },
          formatted_body: { type: 'string', description: 'Optional HTML body when format=org.matrix.custom.html.' },
        },
        required: ['roomId', 'txnId', 'body'],
      },
      request: {
        method: 'PUT',
        path: '/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}',
        body: {
          msgtype: '{msgtype}',
          body: '{body}',
          format: '{format}',
          formatted_body: '{formatted_body}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rooms.join',
      class: 'mutation',
      description: 'Join a room by id or alias.',
      parameters: {
        type: 'object',
        properties: { roomIdOrAlias: { type: 'string' } },
        required: ['roomIdOrAlias'],
      },
      request: { method: 'POST', path: '/_matrix/client/v3/join/{roomIdOrAlias}' },
      cas: 'native-idempotency',
    },
    {
      name: 'rooms.leave',
      class: 'mutation',
      description: 'Leave a Matrix room.',
      parameters: {
        type: 'object',
        properties: { roomId: { type: 'string' } },
        required: ['roomId'],
      },
      request: { method: 'POST', path: '/_matrix/client/v3/rooms/{roomId}/leave' },
      cas: 'native-idempotency',
    },
  ],
})
