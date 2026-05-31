import { declarativeRestConnector } from './declarative-rest.js'

// Kissflow Workflow REST API.
// Tenant base URL is per-account: https://{accountName}.kissflow.com — resolved
// from connection metadata at invocation time. Auth uses an access-key pair sent
// via the X-Access-Key-Id / X-Access-Key-Secret headers (api-key shape from the
// activepieces piece manifest).
export const kissflowConnector = declarativeRestConnector({
  kind: 'kissflow',
  displayName: 'Kissflow',
  description:
    'Download form-field attachments from a Kissflow process activity instance.',
  auth: {
    kind: 'api-key',
    hint: 'Kissflow access key id + secret (X-Access-Key-Id / X-Access-Key-Secret). Tenant account name and id are stored as connection metadata.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: {
    method: 'GET',
    path: '/process/2/{accountId}',
  },
  capabilities: [
    {
      name: 'download.attachment.from.form.field',
      class: 'read',
      description:
        'Download an attachment stored in a form field of a Kissflow process activity instance.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Kissflow account id.' },
          processId: { type: 'string', description: 'Kissflow process id.' },
          instanceId: { type: 'string', description: 'Process instance id.' },
          activityInstanceId: {
            type: 'string',
            description: 'Activity instance id within the process instance.',
          },
          fieldId: {
            type: 'string',
            description: 'Form field id that holds the attachment.',
          },
          attachmentId: {
            type: 'string',
            description: 'Attachment id within the form field.',
          },
        },
        required: [
          'accountId',
          'processId',
          'instanceId',
          'activityInstanceId',
          'fieldId',
          'attachmentId',
        ],
      },
      request: {
        method: 'GET',
        path: '/process/2/{accountId}/{processId}/{instanceId}/{activityInstanceId}/{fieldId}/{attachmentId}/download',
      },
    },
  ],
})
