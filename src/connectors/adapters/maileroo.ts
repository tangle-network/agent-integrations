import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Maileroo — transactional email delivery + address verification.
 *
 * Auth model: Maileroo issues two distinct API keys per account:
 *   - A "Sending Key" scoped to a verified domain. Used for the
 *     send / send-template endpoints on `smtp.maileroo.com`.
 *   - A "Verification API Key" account-scoped. Used for address
 *     verification on `verify.maileroo.net`.
 *
 * Both keys are accepted in the `X-API-Key` request header. A single
 * connection carries one key — operators provision a sending-scoped
 * connection or a verification-scoped connection based on which surface
 * the agent needs. Mixing the two in one connection silently misroutes:
 * the sending key cannot call `/check`, and the verification key cannot
 * call `/send` or `/send-template`.
 *
 * The declarative-REST runtime serializes request bodies as JSON. Maileroo
 * accepts JSON payloads on `/send`, `/send-template`, and `/check`; this
 * adapter does not exercise the multipart/form-data path the upstream
 * activepieces piece uses (form-data would require a bespoke executor).
 * JSON-encoded sends still respect Maileroo's verified-domain requirement
 * and reject unverified `from` addresses at the API boundary.
 */

const emailAddress = {
  type: 'string',
  description: 'RFC-5322 mailbox. Either bare `user@example.com` or `"Name" <user@example.com>`.',
}

const attachment = {
  type: 'object',
  properties: {
    file_name: { type: 'string', description: 'Filename shown to the recipient.' },
    content_type: { type: 'string', description: 'MIME type (e.g. application/pdf).' },
    content: { type: 'string', description: 'Base64-encoded file content.' },
    inline: {
      type: 'boolean',
      description: 'If true the attachment renders inline (used with HTML img src="cid:...").',
    },
  },
  required: ['file_name', 'content_type', 'content'],
}

const commonSendProps = {
  from: {
    ...emailAddress,
    description: 'Verified sender address. Must belong to a domain authorized by the Sending Key.',
  },
  from_name: { type: 'string', description: 'Optional display name attached to the sender.' },
  to: {
    type: 'array',
    items: emailAddress,
    description: 'Primary recipient list. At least one entry required.',
  },
  cc: { type: 'array', items: emailAddress },
  bcc: { type: 'array', items: emailAddress },
  reply_to: emailAddress,
  subject: { type: 'string' },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Tags surfaced in Maileroo analytics and webhook payloads.',
  },
  tracking: {
    type: 'object',
    description: 'Opt-in tracking flags. Omitted fields fall back to the account default.',
    properties: {
      opens: { type: 'boolean' },
      clicks: { type: 'boolean' },
      unsubscribe: { type: 'boolean' },
    },
  },
  headers: {
    type: 'object',
    description: 'Custom RFC-5322 headers (`{ "X-Campaign": "welcome" }`).',
    additionalProperties: { type: 'string' },
  },
  attachments: { type: 'array', items: attachment },
}

export const mailerooConnector = declarativeRestConnector({
  kind: 'maileroo',
  displayName: 'Maileroo',
  description:
    'Send transactional email through Maileroo (raw send, template send) and verify recipient addresses via the verification API. One connection carries either a domain-scoped Sending Key or an account-scoped Verification Key.',
  auth: {
    kind: 'api-key',
    hint: 'Maileroo Sending Key (Domains → your domain → API → Create Sending Key) for /send and /send-template, OR Verification Key (Verifications page) for /check. Sent as the `X-API-Key` header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://smtp.maileroo.com',
  credentialPlacement: { kind: 'header', header: 'X-API-Key', prefix: '' },
  defaultHeaders: { accept: 'application/json' },
  capabilities: [
    {
      name: 'email.send',
      class: 'mutation',
      description:
        'Send a transactional email (POST /send). Provide either `html` or `plain` (or both) — Maileroo rejects payloads with no body. The sender domain must already be verified for the Sending Key in use.',
      parameters: {
        type: 'object',
        properties: {
          ...commonSendProps,
          html: { type: 'string', description: 'HTML body. At least one of html / plain is required.' },
          plain: { type: 'string', description: 'Plain-text body. At least one of html / plain is required.' },
        },
        required: ['from', 'to', 'subject'],
      },
      request: { method: 'POST', path: '/send', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'email.send.template',
      class: 'mutation',
      description:
        'Send an email rendered from a stored Maileroo template (POST /send-template). `template_id` selects the template; `template_data` fills its `{{variable}}` placeholders. Sender, recipients, subject, and tracking flags behave the same as `email.send`.',
      parameters: {
        type: 'object',
        properties: {
          ...commonSendProps,
          template_id: {
            type: 'integer',
            description: 'Numeric template identifier (Templates page).',
          },
          template_data: {
            type: 'object',
            description: 'Key/value map applied to the template. Values are JSON-serialized before substitution.',
            additionalProperties: true,
          },
        },
        required: ['from', 'to', 'subject', 'template_id', 'template_data'],
      },
      request: { method: 'POST', path: '/send-template', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'email.verify',
      class: 'read',
      description:
        'Verify a single email address (POST https://verify.maileroo.net/check). Returns deliverability, role-account, disposable, free-provider, and MX-record signals. Requires the Verification API key — the Sending Key is rejected here.',
      parameters: {
        type: 'object',
        properties: {
          email_address: {
            type: 'string',
            description: 'Mailbox to verify, e.g. `user@example.com`.',
          },
        },
        required: ['email_address'],
      },
      request: {
        method: 'POST',
        path: 'https://verify.maileroo.net/check',
        body: { email_address: '{email_address}' },
      },
    },
  ],
})
