import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Gistly connector.
 *
 * Gistly (gist.ly) is a hosted YouTube-transcript API. A caller hands it a
 * YouTube video URL and receives the transcript either as timestamped chunks
 * or merged into a single text blob.
 *
 * Auth: a tenant-issued API key delivered in the `x-api-key` request header.
 * No OAuth, no refresh — the key is long-lived and rotated out-of-band in the
 * Gistly dashboard.
 *
 * Category: the activepieces catalog labels Gistly as `workflow`, which the
 * connector manifest does not enumerate. The closest accurate UI bucket is
 * `other`.
 *
 * Consistency: every action is a pure read against a third-party transcript
 * cache. There is no resource we own that needs CAS, and the upstream YouTube
 * transcript content is what it is — repeated calls return the same payload.
 * `authoritative` is correct because Gistly's response is the source of truth
 * for the transcript value at the time of the call; there is no local mirror
 * to reconcile.
 */
export const gistlyConnector = declarativeRestConnector({
  kind: 'gistly',
  displayName: 'Gistly',
  description:
    'Fetch YouTube video transcripts from the Gistly API as timestamped chunks or merged text.',
  auth: {
    kind: 'api-key',
    hint: 'Gistly API key from https://api-portal.gist.ly/. Sent as the `x-api-key` header.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.gist.ly',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: {
    accept: 'application/json',
  },
  // Gistly exposes a documented `/health` endpoint that the upstream piece
  // also uses for its API-key validation step. It is the cheapest probe that
  // both confirms reachability and (because the header guard runs before the
  // health check) validates the credential in one round-trip.
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'transcripts.get',
      class: 'read',
      description:
        'Fetch the transcript of a YouTube video by URL. When `text` is true the transcript is collapsed into a single merged string instead of timestamped chunks.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'A public YouTube video URL (e.g. https://www.youtube.com/watch?v=...).',
          },
          text: {
            type: 'boolean',
            description:
              'If true, return the transcript as a single merged string instead of timestamped chunks.',
          },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/youtube/transcript',
        query: {
          url: '{url}',
          text: '{text}',
        },
      },
    },
  ],
})
