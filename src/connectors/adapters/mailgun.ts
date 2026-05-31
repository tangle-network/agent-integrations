import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Mailgun adapter — REST API at https://api.mailgun.net/v3 (US region) or
 * https://api.eu.mailgun.net/v3 (EU region).
 *
 * Auth: HTTP Basic with username `api` and the private API key as the password.
 * The credential token must be supplied pre-base64-encoded as `api:<KEY>` so the
 * declarative REST runtime can drop it into `Authorization: Basic <token>`
 * without per-request transformation. The catalog's `region` field selects the
 * base URL; default is the US endpoint, override via source metadata.baseUrl.
 *
 * Action set mirrors the activepieces `mailgun` piece: transactional send,
 * email validation, mailing-list membership, event/stat reads, and the bounces
 * suppression list. Domain templating uses the catalog `from` address's domain
 * for `/{domain}/messages`-style routes; callers pass the domain explicitly so
 * the same credential can drive multiple sending domains.
 */
export const mailgunConnector = declarativeRestConnector({
  kind: 'mailgun',
  displayName: 'Mailgun',
  description:
    'Send transactional email through Mailgun and read delivery events, domain stats, and bounce suppressions.',
  auth: {
    kind: 'api-key',
    hint: 'Mailgun private API key. Encode `api:<KEY>` as base64 and store that as the credential token — Mailgun authenticates via HTTP Basic.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://api.mailgun.net/v3' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Basic ' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/domains', query: { limit: '1' } },
  capabilities: [
    {
      name: 'messages.send',
      class: 'mutation',
      description:
        'Send an email via /{domain}/messages. Provide `from`, recipients, subject, and at least one of `text` or `html`.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Mailgun sending domain, e.g. mg.example.com' },
          from: { type: 'string' },
          to: { type: 'string', description: 'Comma-separated recipient addresses.' },
          cc: { type: 'string' },
          bcc: { type: 'string' },
          'h:Reply-To': { type: 'string' },
          subject: { type: 'string' },
          text: { type: 'string' },
          html: { type: 'string' },
        },
        required: ['domain', 'from', 'to', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/{domain}/messages',
        body: {
          from: '{from}',
          to: '{to}',
          cc: '{cc}',
          bcc: '{bcc}',
          'h:Reply-To': '{h:Reply-To}',
          subject: '{subject}',
          text: '{text}',
          html: '{html}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'email.validate',
      class: 'mutation',
      description:
        'Validate an email address through Mailgun /v4/address/validate. Marked mutation because Mailgun bills per call.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Email address to validate.' },
          provider_lookup: { type: 'boolean' },
        },
        required: ['address'],
      },
      request: {
        method: 'GET',
        path: '/v4/address/validate',
        query: {
          address: '{address}',
          provider_lookup: '{provider_lookup}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'mailing_list.member.add',
      class: 'mutation',
      description:
        'Add (or upsert) a member on a mailing list. Catalog `upsert=true` maps to the Mailgun `upsert=yes` flag.',
      parameters: {
        type: 'object',
        properties: {
          list: { type: 'string', description: 'Mailing list address, e.g. devs@mg.example.com.' },
          address: { type: 'string' },
          name: { type: 'string' },
          vars: { type: 'string', description: 'JSON-encoded custom variables.' },
          subscribed: { type: 'boolean' },
          upsert: { type: 'boolean' },
        },
        required: ['list', 'address'],
      },
      request: {
        method: 'POST',
        path: '/lists/{list}/members',
        body: {
          address: '{address}',
          name: '{name}',
          vars: '{vars}',
          subscribed: '{subscribed}',
          upsert: '{upsert}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'events.list',
      class: 'read',
      description:
        'Page Mailgun events for a domain. Filter by event type, severity, and time window.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          event: { type: 'string', description: 'Event filter: delivered, failed, opened, clicked, unsubscribed, complained, accepted.' },
          severity: { type: 'string', description: 'permanent or temporary — only meaningful for failed events.' },
          begin: { type: 'string', description: 'RFC 2822 date.' },
          end: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 300 },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/{domain}/events',
        query: {
          event: '{event}',
          severity: '{severity}',
          begin: '{begin}',
          end: '{end}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'domain.stats',
      class: 'read',
      description: 'Aggregate delivery statistics for a domain over a time window.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          event: { type: 'string', description: 'Comma-separated event types: accepted,delivered,failed,opened,clicked,unsubscribed,complained.' },
          duration: { type: 'string', description: 'Aggregation window, e.g. 1h, 24h, 7d, 30d.' },
          start: { type: 'string' },
          end: { type: 'string' },
          resolution: { type: 'string', description: 'hour, day, or month.' },
        },
        required: ['domain', 'event'],
      },
      request: {
        method: 'GET',
        path: '/{domain}/stats/total',
        query: {
          event: '{event}',
          duration: '{duration}',
          start: '{start}',
          end: '{end}',
          resolution: '{resolution}',
        },
      },
    },
    {
      name: 'bounces.list',
      class: 'read',
      description: 'List bounce suppression records for a domain.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10000 },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/{domain}/bounces',
        query: { limit: '{limit}' },
      },
    },
  ],
})
