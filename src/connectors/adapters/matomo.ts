import { declarativeRestConnector } from './declarative-rest.js'

// Matomo exposes a single Reporting API endpoint at /index.php on the
// customer-hosted Matomo domain. Every call is dispatched by `module=API` plus
// a `method=<Plugin.action>` query parameter, with the per-account auth token
// forwarded as `token_auth`. The connection-time `domain` metadata field
// (e.g. https://matomo.example.com) is read via metadataKey so the connector
// targets the customer's own Matomo install rather than a fixed vendor host.
export const matomoConnector = declarativeRestConnector({
  kind: 'matomo',
  displayName: 'Matomo',
  description: 'Open-source web analytics — add annotations against tracked sites in a self-hosted Matomo install.',
  auth: {
    kind: 'api-key',
    hint: 'Matomo "Token Auth" from your account profile. The connection must also store the Matomo `domain` (e.g. https://matomo.example.com) and `siteId`.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'domain' },
  credentialPlacement: { kind: 'query', parameter: 'token_auth' },
  test: {
    method: 'GET',
    path: '/index.php',
    query: {
      module: 'API',
      method: 'API.getMatomoVersion',
      format: 'JSON',
    },
  },
  capabilities: [
    {
      name: 'annotations.add',
      class: 'mutation',
      description:
        'Add an annotation to a tracked Matomo site on a given date, optionally marking it starred. Mirrors the catalog `add.annotation` action.',
      parameters: {
        type: 'object',
        properties: {
          idSite: {
            type: 'string',
            description: 'The Matomo site id the annotation will be attached to.',
          },
          note: {
            type: 'string',
            description: 'Annotation text.',
          },
          date: {
            type: 'string',
            description: 'Date for the annotation in YYYY-MM-DD format.',
          },
          starred: {
            type: 'integer',
            enum: [0, 1],
            description: '1 to star the annotation, 0 otherwise.',
          },
        },
        required: ['idSite', 'note', 'date'],
      },
      request: {
        method: 'POST',
        path: '/index.php',
        query: {
          module: 'API',
          method: 'Annotations.add',
          format: 'JSON',
          idSite: '{idSite}',
          note: '{note}',
          date: '{date}',
          starred: '{starred}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
