import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Aminos (Aminos One) adapter — self-hosted/per-tenant SaaS panel.
 *
 * Base URL is per-tenant and supplied via connection metadata under the
 * `baseUrl` key (matches the catalog `base_url` auth field). The API key is
 * the `access_token` field; default credential placement is the
 * Authorization header.
 *
 * Catalog action surface: a single `createUser` mutation that provisions an
 * Aminos One end-user under the connecting account's plan.
 */
export const aminosConnector = declarativeRestConnector({
  kind: 'aminos',
  displayName: 'Aminos One',
  description: 'Provision end-users on an Aminos One panel.',
  auth: {
    kind: 'api-key',
    hint: 'Aminos One API access token from the panel; the panel base URL is supplied via connection metadata.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/api/health' },
  capabilities: [
    {
      name: 'users.create',
      class: 'mutation',
      description:
        'Create an end-user on the Aminos One panel under the supplied plan. Mirrors the activepieces createUser action.',
      parameters: {
        type: 'object',
        properties: {
          useremail: {
            type: 'string',
            description: 'Username for the new Aminos user. Must be an e-mail address.',
          },
          userfriendlyname: {
            type: 'string',
            description: 'Display name for the new Aminos user.',
          },
          userplanid: {
            type: 'integer',
            description: 'Plan ID number from the plans defined in the Aminos One panel.',
          },
        },
        required: ['useremail', 'userfriendlyname', 'userplanid'],
      },
      request: {
        method: 'POST',
        path: '/api/users',
        body: {
          useremail: '{useremail}',
          userfriendlyname: '{userfriendlyname}',
          userplanid: '{userplanid}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
