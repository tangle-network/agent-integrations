import { declarativeRestConnector } from './declarative-rest.js'

// MailerCheck REST API is hosted at api.mailercheck.com. Authentication is a
// personal access token sent as a bearer header on every request. The
// activepieces piece (@activepieces/piece-mailercheck) exposes one action that
// verifies a single email address through the /single-verify endpoint.
export const mailercheckConnector = declarativeRestConnector({
  kind: 'mailercheck',
  displayName: 'Mailercheck',
  description:
    'MailerCheck is an easy-to-use email and campaign analysis tool. Anyone using an email service provider can keep their email lists clean and their campaigns deliverable.',
  auth: {
    kind: 'api-key',
    hint: 'MailerCheck personal access token from Account → API. Sent as a bearer token.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.mailercheck.com',
  defaultHeaders: {
    accept: 'application/json',
    'content-type': 'application/json',
  },
  test: { method: 'GET', path: '/api/credits' },
  capabilities: [
    {
      name: 'verify.an.email.address',
      class: 'mutation',
      description:
        'Verify the deliverability of an email address. Returns a status (valid, invalid, accept_all, disposable, role, unknown) and detailed checks.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'The email address to verify.',
            format: 'email',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/api/single-verify',
        body: { email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
  ],
})
