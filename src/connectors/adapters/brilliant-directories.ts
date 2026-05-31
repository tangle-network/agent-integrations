import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Brilliant Directories adapter — per-tenant REST API hosted on each
 * customer's directory instance (e.g. https://example.com/api). The base
 * URL is supplied at connect time via `source.metadata.siteUrl`; the API
 * key is the `X-Api-Key` header generated from the admin panel at
 * https://ww2.managemydirectory.com/admin/apiSettings.
 *
 * Actions mirror the activepieces catalog entry for `brilliant-directories`,
 * which exposes a single write action: createNewUser.
 */
export const brilliantDirectoriesConnector = declarativeRestConnector({
  kind: 'brilliant-directories',
  displayName: 'Brilliant Directories',
  description: 'Create users on a Brilliant Directories website instance.',
  auth: {
    kind: 'api-key',
    hint: 'Brilliant Directories API key from admin → API Settings; site_url passed as metadata.siteUrl.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'siteUrl' },
  credentialPlacement: { kind: 'header', header: 'X-Api-Key' },
  defaultHeaders: { accept: 'application/json' },
  capabilities: [
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a new user on the Brilliant Directories site instance.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
          subscription_id: { type: 'string' },
          meta: { type: 'object' },
        },
        required: ['email', 'password', 'subscription_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/user/create',
        body: {
          email: '{email}',
          password: '{password}',
          subscription_id: '{subscription_id}',
          meta: '{meta}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
