import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Hastewire (https://hastewire.com) is an AI-text humanizer service. The
 * Activepieces piece exposes two actions backed by the public REST API:
 *   - detectTextAction   → detect.text    (classify text as AI- vs human-written)
 *   - humanizeTextAction → humanize.text  (rewrite AI-sounding text to read human)
 *
 * Both endpoints accept the input text in the request body and are authenticated
 * with a personal API key delivered as `Authorization: Bearer <key>`, matching
 * the api_key auth shape declared in the catalog. The catalog declares no
 * triggers, so the manifest below is purely action-driven.
 *
 * The catalog category is "workflow" upstream; the connector category enum
 * does not include `workflow`, so we map it to `other` (same choice the other
 * AI-text utility adapters make — see avian, afforai, alttextify).
 */
export const hastewireConnector = declarativeRestConnector({
  kind: 'hastewire',
  displayName: 'Hastewire',
  description:
    'Detect AI-generated text and humanize AI-sounding prose via the Hastewire API.',
  auth: {
    kind: 'api-key',
    hint: 'Hastewire API key (account dashboard → API). Sent as `Authorization: Bearer <key>`.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.hastewire.com/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'detect.text',
      class: 'read',
      description:
        'Classify a passage of text as AI- or human-written. Returns a probability score plus a per-span breakdown.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to analyze. Required.',
          },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/detect',
        body: {
          text: '{text}',
        },
      },
    },
    {
      name: 'humanize.text',
      class: 'mutation',
      description:
        'Rewrite AI-sounding text so it reads as if written by a human. Optionally constrain the rewrite to a particular writing style.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to rewrite. Required.',
          },
          style: {
            type: 'string',
            description:
              'Optional writing style for the rewrite (e.g. "casual", "formal", "academic"). Maps to the catalog `style` auth field.',
          },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/humanize',
        body: {
          text: '{text}',
          style: '{style}',
        },
      },
      // Humanize is a pure-function transform on the input text; calling it
      // twice with the same payload returns an equivalent rewrite, so we treat
      // the upstream call itself as the idempotency boundary rather than
      // layering optimistic-read-verify (there is no resource to read back).
      cas: 'native-idempotency',
    },
  ],
})
