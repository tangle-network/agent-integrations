import { declarativeRestConnector } from './declarative-rest.js'

/**
 * LLM Rails connector.
 *
 * LLM Rails is a managed RAG platform: tenants upload documents into
 * "datastores", LLM Rails ingests + chunks + embeds them, and the
 * public API exposes a single hybrid (dense + sparse) semantic search
 * endpoint over a chosen datastore. The only documented external
 * action in the activepieces catalog is `datastore.search`.
 *
 * Auth: tenant API key sent as a bearer token. No OAuth surface.
 *
 * Consistency: a search call is a read against the platform's
 * vector + keyword index. The index itself is eventually consistent
 * with respect to recent uploads (ingest pipeline runs asynchronously
 * on LLM Rails' side), so we mark the connector `advisory` rather
 * than `authoritative` — a search issued moments after an upload may
 * not yet see the new chunks.
 */
export const llmrailsConnector = declarativeRestConnector({
  kind: 'llmrails',
  displayName: 'LLM Rails',
  description:
    'Run hybrid semantic search against an LLM Rails datastore and optionally summarize the results.',
  auth: {
    kind: 'api-key',
    hint: 'LLM Rails API key (workspace settings → API keys). Sent as a bearer token on every request.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.llmrails.com/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  // LLM Rails does not document a lightweight ping endpoint; we omit
  // `test` rather than issue a search that consumes the tenant's
  // metered query budget.
  capabilities: [
    {
      name: 'datastore.search',
      class: 'read',
      description:
        'Search a datastore using a natural-language query. Supports hybrid (dense + sparse) retrieval and optional answer summarization over the matched chunks.',
      parameters: {
        type: 'object',
        properties: {
          datastoreId: {
            type: 'string',
            description:
              'Identifier of the LLM Rails datastore to search. Visible in the LLM Rails UI as the datastore slug or UUID.',
          },
          text: {
            type: 'string',
            description: 'Natural-language search query.',
          },
          hybrid: {
            type: 'boolean',
            description:
              'When true, combine dense embedding similarity with sparse keyword scoring. When false, dense-only retrieval is used.',
          },
          summarize: {
            type: 'boolean',
            description:
              'When true, LLM Rails synthesizes a summary answer over the retrieved chunks in addition to returning the raw matches.',
          },
        },
        required: ['datastoreId', 'text', 'hybrid', 'summarize'],
      },
      request: {
        method: 'POST',
        path: '/datastores/{datastoreId}/search',
        body: {
          text: '{text}',
          hybrid: '{hybrid}',
          summarize: '{summarize}',
        },
      },
    },
  ],
})
