import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Postmark — transactional email API.
 *
 * Auth model: Postmark issues two distinct tokens per Postmark account:
 *   - `X-Postmark-Server-Token`  (server-scoped, used for /email,
 *     /email/batch, /email/withTemplate, /messages/outbound, /bounces,
 *     /stats/outbound, /templates)
 *   - `X-Postmark-Account-Token` (account-scoped, used for /servers,
 *     /domains, /senders, /push/templates)
 *
 * This adapter scopes itself to the server-token surface (sending,
 * message search, bounce inspection, outbound stats, templates) — the set
 * an agent needs for "send a transactional email" and "look at what was
 * sent / what bounced". Account-level provisioning (creating new servers
 * or sender identities) belongs to a separate `postmark-account` adapter
 * because mixing the two tokens into a single connection silently
 * misroutes API calls.
 *
 * The declarative-rest runtime carries exactly one credential per
 * connection, placed via `credentialPlacement`. Postmark accepts the
 * server token in the `X-Postmark-Server-Token` request header on every
 * server-scoped path; that is the placement wired here.
 */

const emailAddress = {
  type: 'string',
  description: 'RFC-5322 mailbox. Either bare `user@example.com` or `"Name" <user@example.com>`.',
}

const attachment = {
  type: 'object',
  properties: {
    Name: { type: 'string', description: 'Filename shown to the recipient.' },
    Content: { type: 'string', description: 'Base64-encoded file content.' },
    ContentType: { type: 'string', description: 'MIME type (e.g. application/pdf).' },
    ContentID: {
      type: 'string',
      description: 'Optional cid: identifier for inline attachments (used in HTML img src="cid:...").',
    },
  },
  required: ['Name', 'Content', 'ContentType'],
}

const header = {
  type: 'object',
  properties: {
    Name: { type: 'string' },
    Value: { type: 'string' },
  },
  required: ['Name', 'Value'],
}

const emailPayload = {
  type: 'object',
  properties: {
    From: { ...emailAddress, description: 'Sender address. Must match a verified Postmark Signature or Domain.' },
    To: { type: 'string', description: 'Comma-separated recipient list.' },
    Cc: { type: 'string' },
    Bcc: { type: 'string' },
    Subject: { type: 'string' },
    Tag: { type: 'string', description: 'Single tag used by Postmark analytics + filtering.' },
    HtmlBody: { type: 'string' },
    TextBody: { type: 'string' },
    ReplyTo: { type: 'string' },
    Metadata: {
      type: 'object',
      description: 'Up to 25 key/value pairs (string values, 1KB total) echoed in webhooks and stats.',
      additionalProperties: { type: 'string' },
    },
    Headers: { type: 'array', items: header },
    TrackOpens: { type: 'boolean' },
    TrackLinks: {
      type: 'string',
      enum: ['None', 'HtmlAndText', 'HtmlOnly', 'TextOnly'],
    },
    MessageStream: {
      type: 'string',
      description: 'Outbound message stream ID (default "outbound" for transactional; "broadcast" for broadcast streams).',
    },
    Attachments: { type: 'array', items: attachment },
  },
  required: ['From'],
}

export const postmarkConnector = declarativeRestConnector({
  kind: 'postmark',
  displayName: 'Postmark',
  description:
    'Send transactional email through the Postmark Server API — single send, batch send, template send, message search, bounce inspection, outbound stats, and template management.',
  auth: {
    kind: 'api-key',
    hint: 'Postmark Server API token (Servers → your server → API Tokens). Sent as the `X-Postmark-Server-Token` header. Account-scoped operations (creating servers, domains, sender signatures) require a different token and are intentionally out of scope for this connector.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.postmarkapp.com',
  credentialPlacement: { kind: 'header', header: 'X-Postmark-Server-Token', prefix: '' },
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: '/server' },
  capabilities: [
    {
      name: 'server.get',
      class: 'read',
      description: 'Return the Postmark server this token belongs to (GET /server). Use as a credential probe.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/server' },
    },
    {
      name: 'email.send',
      class: 'mutation',
      description:
        'Send a single transactional email (POST /email). Either HtmlBody or TextBody (or both) must be supplied; Postmark rejects empty payloads.',
      parameters: emailPayload,
      request: { method: 'POST', path: '/email', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'email.send.batch',
      class: 'mutation',
      description:
        'Send up to 500 transactional emails in a single request (POST /email/batch). Returns one result object per submitted message, in order.',
      parameters: {
        type: 'object',
        properties: {
          Messages: { type: 'array', items: emailPayload, maxItems: 500 },
        },
        required: ['Messages'],
      },
      request: { method: 'POST', path: '/email/batch', body: '{Messages}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'email.send.template',
      class: 'mutation',
      description:
        'Render and send a single email using a Postmark template (POST /email/withTemplate). Supply TemplateId or TemplateAlias plus a TemplateModel that fills the template variables.',
      parameters: {
        type: 'object',
        properties: {
          From: { ...emailAddress, description: 'Verified sender address.' },
          To: { type: 'string' },
          Cc: { type: 'string' },
          Bcc: { type: 'string' },
          Tag: { type: 'string' },
          ReplyTo: { type: 'string' },
          TemplateId: { type: 'integer', description: 'Numeric template identifier. Mutually exclusive with TemplateAlias.' },
          TemplateAlias: { type: 'string', description: 'String alias of the template. Mutually exclusive with TemplateId.' },
          TemplateModel: {
            type: 'object',
            description: 'Key/value map applied to the template variables.',
            additionalProperties: true,
          },
          InlineCss: { type: 'boolean', description: 'If true (default for HTML templates), inlines CSS at send time.' },
          TrackOpens: { type: 'boolean' },
          TrackLinks: { type: 'string', enum: ['None', 'HtmlAndText', 'HtmlOnly', 'TextOnly'] },
          MessageStream: { type: 'string' },
          Metadata: { type: 'object', additionalProperties: { type: 'string' } },
          Headers: { type: 'array', items: header },
          Attachments: { type: 'array', items: attachment },
        },
        required: ['From', 'TemplateModel'],
      },
      request: { method: 'POST', path: '/email/withTemplate', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'email.send.template.batch',
      class: 'mutation',
      description:
        'Send up to 500 template-rendered messages in one request (POST /email/batchWithTemplates). Each entry independently selects a TemplateId or TemplateAlias.',
      parameters: {
        type: 'object',
        properties: {
          Messages: {
            type: 'array',
            maxItems: 500,
            items: {
              type: 'object',
              properties: {
                From: emailAddress,
                To: { type: 'string' },
                Cc: { type: 'string' },
                Bcc: { type: 'string' },
                TemplateId: { type: 'integer' },
                TemplateAlias: { type: 'string' },
                TemplateModel: { type: 'object', additionalProperties: true },
                Tag: { type: 'string' },
                MessageStream: { type: 'string' },
                Metadata: { type: 'object', additionalProperties: { type: 'string' } },
                Headers: { type: 'array', items: header },
                Attachments: { type: 'array', items: attachment },
              },
              required: ['From', 'TemplateModel'],
            },
          },
        },
        required: ['Messages'],
      },
      request: { method: 'POST', path: '/email/batchWithTemplates', body: { Messages: '{Messages}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'messages.outbound.search',
      class: 'read',
      description:
        'Search outbound messages (GET /messages/outbound). Supports filters by recipient, tag, status, message stream, and date range; paginated by count + offset.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 500, description: 'Page size. Postmark default 50.' },
          offset: { type: 'integer', minimum: 0 },
          recipient: { type: 'string' },
          fromemail: { type: 'string' },
          tag: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'sent', 'failed'] },
          todate: { type: 'string', description: 'YYYY-MM-DD (exclusive upper bound).' },
          fromdate: { type: 'string', description: 'YYYY-MM-DD (inclusive lower bound).' },
          messagestream: { type: 'string' },
          subject: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/messages/outbound',
        query: {
          count: '{count}',
          offset: '{offset}',
          recipient: '{recipient}',
          fromemail: '{fromemail}',
          tag: '{tag}',
          status: '{status}',
          todate: '{todate}',
          fromdate: '{fromdate}',
          messagestream: '{messagestream}',
          subject: '{subject}',
        },
      },
    },
    {
      name: 'messages.outbound.get',
      class: 'read',
      description: 'Fetch a single outbound message by MessageID (GET /messages/outbound/{messageId}/details).',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string', description: 'Postmark MessageID (UUID).' } },
        required: ['messageId'],
      },
      request: { method: 'GET', path: '/messages/outbound/{messageId}/details' },
    },
    {
      name: 'bounces.search',
      class: 'read',
      description:
        'List bounces (GET /bounces). Filter by bounce type, inactive flag, recipient, tag, or message stream.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
          type: {
            type: 'string',
            description:
              'Postmark bounce type (HardBounce, Transient, Unsubscribe, Subscribe, AutoResponder, AddressChange, DnsError, SpamNotification, OpenRelayTest, Unknown, SoftBounce, VirusNotification, ChallengeVerification, BadEmailAddress, SpamComplaint, ManuallyDeactivated, Unconfirmed, Blocked, SMTPApiError, InboundError, DMARCPolicy, TemplateRenderingFailed).',
          },
          inactive: { type: 'boolean' },
          emailFilter: { type: 'string' },
          tag: { type: 'string' },
          messageID: { type: 'string' },
          fromdate: { type: 'string' },
          todate: { type: 'string' },
          messagestream: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/bounces',
        query: {
          count: '{count}',
          offset: '{offset}',
          type: '{type}',
          inactive: '{inactive}',
          emailFilter: '{emailFilter}',
          tag: '{tag}',
          messageID: '{messageID}',
          fromdate: '{fromdate}',
          todate: '{todate}',
          messagestream: '{messagestream}',
        },
      },
    },
    {
      name: 'bounces.get',
      class: 'read',
      description: 'Fetch a single bounce record (GET /bounces/{bounceId}).',
      parameters: {
        type: 'object',
        properties: { bounceId: { type: 'integer' } },
        required: ['bounceId'],
      },
      request: { method: 'GET', path: '/bounces/{bounceId}' },
    },
    {
      name: 'bounces.activate',
      class: 'mutation',
      description:
        'Reactivate a recipient previously suppressed because of a hard bounce (PUT /bounces/{bounceId}/activate). Postmark validates that the recipient is currently inactive.',
      parameters: {
        type: 'object',
        properties: { bounceId: { type: 'integer' } },
        required: ['bounceId'],
      },
      request: { method: 'PUT', path: '/bounces/{bounceId}/activate' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'stats.outbound.overview',
      class: 'read',
      description: 'Outbound delivery overview for a window (GET /stats/outbound).',
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          fromdate: { type: 'string', description: 'YYYY-MM-DD.' },
          todate: { type: 'string', description: 'YYYY-MM-DD.' },
          messagestream: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/stats/outbound',
        query: {
          tag: '{tag}',
          fromdate: '{fromdate}',
          todate: '{todate}',
          messagestream: '{messagestream}',
        },
      },
    },
    {
      name: 'templates.list',
      class: 'read',
      description: 'List templates owned by this server (GET /templates).',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
          templateType: { type: 'string', enum: ['Standard', 'Layout'] },
          layoutTemplate: { type: 'string', description: 'Filter to templates that use the named layout.' },
        },
      },
      request: {
        method: 'GET',
        path: '/templates',
        query: {
          count: '{count}',
          offset: '{offset}',
          TemplateType: '{templateType}',
          LayoutTemplate: '{layoutTemplate}',
        },
      },
    },
    {
      name: 'templates.get',
      class: 'read',
      description: 'Fetch a single template by ID or alias (GET /templates/{idOrAlias}).',
      parameters: {
        type: 'object',
        properties: { idOrAlias: { type: 'string' } },
        required: ['idOrAlias'],
      },
      request: { method: 'GET', path: '/templates/{idOrAlias}' },
    },
    {
      name: 'templates.create',
      class: 'mutation',
      description: 'Create a new template (POST /templates).',
      parameters: {
        type: 'object',
        properties: {
          Name: { type: 'string' },
          Subject: { type: 'string' },
          HtmlBody: { type: 'string' },
          TextBody: { type: 'string' },
          Alias: { type: 'string' },
          TemplateType: { type: 'string', enum: ['Standard', 'Layout'] },
          LayoutTemplate: { type: 'string' },
        },
        required: ['Name'],
      },
      request: { method: 'POST', path: '/templates', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'templates.update',
      class: 'mutation',
      description:
        'Update an existing template by ID or alias (PUT /templates/{idOrAlias}). Only the fields supplied are modified; omit fields to leave them unchanged.',
      parameters: {
        type: 'object',
        properties: {
          idOrAlias: { type: 'string', description: 'Template ID or string alias.' },
          Name: { type: 'string' },
          Subject: { type: 'string' },
          HtmlBody: { type: 'string' },
          TextBody: { type: 'string' },
          Alias: { type: 'string' },
          TemplateType: { type: 'string', enum: ['Standard', 'Layout'] },
          LayoutTemplate: { type: 'string' },
        },
        required: ['idOrAlias'],
      },
      request: { method: 'PUT', path: '/templates/{idOrAlias}', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'templates.delete',
      class: 'mutation',
      description: 'Delete a template by ID or alias (DELETE /templates/{idOrAlias}).',
      parameters: {
        type: 'object',
        properties: {
          idOrAlias: { type: 'string', description: 'Template ID or string alias.' },
        },
        required: ['idOrAlias'],
      },
      request: { method: 'DELETE', path: '/templates/{idOrAlias}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bounces.delete',
      class: 'mutation',
      description:
        'Delete suppression records for one or more recipients on a message stream (POST /message-streams/{streamId}/suppressions/delete). This is Postmark\'s "un-suppress" operation — the way to clear a bounce-driven block so future sends to that recipient are accepted again.',
      parameters: {
        type: 'object',
        properties: {
          streamId: {
            type: 'string',
            description: 'Outbound message stream ID (e.g. "outbound", "broadcast").',
          },
          Suppressions: {
            type: 'array',
            description: 'List of email addresses to remove from the stream\'s suppression list.',
            items: {
              type: 'object',
              properties: {
                EmailAddress: { type: 'string' },
              },
              required: ['EmailAddress'],
            },
          },
        },
        required: ['streamId', 'Suppressions'],
      },
      request: {
        method: 'POST',
        path: '/message-streams/{streamId}/suppressions/delete',
        body: { Suppressions: '{Suppressions}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'servers.update',
      class: 'mutation',
      description:
        'Update settings on the server this token belongs to (PUT /server). Server-token scoped — account-level server provisioning (creating new servers) requires an account token and is intentionally out of scope.',
      parameters: {
        type: 'object',
        properties: {
          Name: { type: 'string' },
          Color: {
            type: 'string',
            description:
              'UI badge color (Purple, Blue, Turquoise, Green, Red, Yellow, Grey).',
          },
          SmtpApiActivated: { type: 'boolean' },
          RawEmailEnabled: { type: 'boolean' },
          DeliveryHookUrl: { type: 'string' },
          InboundHookUrl: { type: 'string' },
          BounceHookUrl: { type: 'string' },
          OpenHookUrl: { type: 'string' },
          ClickHookUrl: { type: 'string' },
          DeliveryType: {
            type: 'string',
            enum: ['Live', 'Sandbox'],
            description: 'Live sends real email; Sandbox is a no-send dev mode.',
          },
          PostFirstOpenOnly: { type: 'boolean' },
          TrackOpens: { type: 'boolean' },
          TrackLinks: {
            type: 'string',
            enum: ['None', 'HtmlAndText', 'HtmlOnly', 'TextOnly'],
          },
          IncludeBounceContentInHook: { type: 'boolean' },
          EnableSmtpApiErrorHooks: { type: 'boolean' },
        },
      },
      request: { method: 'PUT', path: '/server', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
