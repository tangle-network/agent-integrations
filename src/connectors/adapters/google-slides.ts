import { declarativeRestConnector } from './declarative-rest.js'

export const googleSlidesConnector = declarativeRestConnector({
  kind: 'google-slides',
  displayName: 'Google Slides',
  description: 'Create presentations, refresh charts, and read Google Slides presentations.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/presentations'],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://slides.googleapis.com/v1',
  test: { method: 'GET', path: '/presentations' },
  capabilities: [
    {
      name: 'presentation.get',
      class: 'read',
      description: 'Get a Google Slides presentation by ID.',
      parameters: {
        type: 'object',
        properties: { presentationId: { type: 'string' } },
        required: ['presentationId'],
      },
      request: { method: 'GET', path: '/presentations/{presentationId}' },
      requiredScopes: ['https://www.googleapis.com/auth/presentations'],
    },
    {
      name: 'presentation.create',
      class: 'mutation',
      description: 'Create a new Google Slides presentation.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/presentations',
        body: { title: '{title}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/presentations'],
    },
    {
      name: 'charts.refresh',
      class: 'mutation',
      description: 'Refresh Sheets charts embedded in a presentation.',
      parameters: {
        type: 'object',
        properties: { presentationId: { type: 'string' }, objectIds: { type: 'array', items: { type: 'string' } } },
        required: ['presentationId'],
      },
      request: {
        method: 'POST',
        path: '/presentations/{presentationId}:batchUpdate',
        body: { requests: [{ refreshSheetsChart: { objectId: '{objectIds}' } }] },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['https://www.googleapis.com/auth/presentations'],
    },
    {
      name: 'presentation.update',
      class: 'mutation',
      description:
        'Apply a batch of Slides API edit requests (insertText, deleteObject, updateShapeProperties, etc.) to an existing presentation. Pass `requests` as an array of Slides batchUpdate Request objects; the API applies them atomically (POST /presentations/{presentationId}:batchUpdate).',
      parameters: {
        type: 'object',
        properties: {
          presentationId: { type: 'string', description: 'Presentation resource ID.' },
          requests: {
            type: 'array',
            description: 'Array of Slides batchUpdate Request objects, e.g. [{ insertText: { objectId, text } }].',
            items: { type: 'object' },
          },
          writeControl: {
            type: 'object',
            description: 'Optional WriteControl object with required_revision_id for optimistic locking.',
          },
        },
        required: ['presentationId', 'requests'],
      },
      request: {
        method: 'POST',
        path: '/presentations/{presentationId}:batchUpdate',
        body: { requests: '{requests}', writeControl: '{writeControl}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/presentations'],
    },
    {
      name: 'slides.duplicate',
      class: 'mutation',
      description:
        'Duplicate an existing slide within a presentation. Issues a Slides batchUpdate with a `duplicateObject` request keyed by the slide\'s objectId (POST /presentations/{presentationId}:batchUpdate).',
      parameters: {
        type: 'object',
        properties: {
          presentationId: { type: 'string', description: 'Presentation resource ID.' },
          objectId: { type: 'string', description: 'Object ID of the slide to duplicate (slides are page-level objects).' },
          objectIds: {
            type: 'object',
            description:
              'Optional map of source-objectId -> desired-objectId for the duplicated children, letting callers pin stable IDs.',
          },
        },
        required: ['presentationId', 'objectId'],
      },
      request: {
        method: 'POST',
        path: '/presentations/{presentationId}:batchUpdate',
        body: {
          requests: [
            {
              duplicateObject: {
                objectId: '{objectId}',
                objectIds: '{objectIds}',
              },
            },
          ],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/presentations'],
    },
  ],
})
