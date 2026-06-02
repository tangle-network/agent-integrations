import { declarativeRestConnector } from './declarative-rest.js'

export const emailitConnector = declarativeRestConnector({
  kind: 'emailit',
  displayName: 'Emailit',
  description: 'Send transactional emails through the Emailit API.',
  auth: { kind: 'api-key', hint: 'Emailit API key. Sent as a Bearer token on every request.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.emailit.com/v1',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'send.email',
      class: 'mutation',
      description:
        'Send a transactional email through Emailit. Supports plain text or HTML body, CC/BCC fan-out, reply-to override, and custom headers.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'array',
            items: { type: 'string' },
            description: 'Recipient email addresses. Combined cap of 50 across to/cc/bcc.',
          },
          from_email: {
            type: 'string',
            description: 'Verified sender email address.',
          },
          from_name: {
            type: 'string',
            description: 'Optional display name shown to recipients.',
          },
          cc: {
            type: 'array',
            items: { type: 'string' },
            description: 'Visible carbon-copy recipients.',
          },
          bcc: {
            type: 'array',
            items: { type: 'string' },
            description: 'Hidden carbon-copy recipients.',
          },
          reply_to: {
            type: 'string',
            description: 'Reply-to address. Defaults to from_email when omitted.',
          },
          subject: {
            type: 'string',
            description: 'Subject line shown in the recipient inbox.',
          },
          content: {
            type: 'string',
            description: 'Email body. Either plain text or HTML.',
          },
          content_type: {
            type: 'string',
            enum: ['text', 'html'],
            description: 'Body encoding hint. Defaults to text.',
          },
          headers: {
            type: 'object',
            description: 'Custom email headers as key/value pairs, e.g. X-Campaign-ID.',
          },
        },
        required: ['to', 'from_email', 'subject', 'content'],
      },
      request: {
        method: 'POST',
        path: '/emails',
        body: {
          to: '{to}',
          from: { email: '{from_email}', name: '{from_name}' },
          cc: '{cc}',
          bcc: '{bcc}',
          reply_to: '{reply_to}',
          subject: '{subject}',
          content: '{content}',
          content_type: '{content_type}',
          headers: '{headers}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'logs.list',
      class: 'read',
      description:
        'List Emailit delivery logs. Filter by RFC3339 `from`/`to` window and delivery `status` (delivered|bounced|opened|clicked). `limit` caps the page size.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'RFC3339 lower bound for the log window (inclusive).',
          },
          to: {
            type: 'string',
            description: 'RFC3339 upper bound for the log window (inclusive).',
          },
          status: {
            type: 'string',
            enum: ['delivered', 'bounced', 'opened', 'clicked'],
            description: 'Filter logs to a single delivery status.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum number of log entries to return.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/logs',
        query: {
          from: '{from}',
          to: '{to}',
          status: '{status}',
          limit: '{limit}',
        },
      },
    },
  ],
})
