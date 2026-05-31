import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Outlook connector backed by Microsoft Graph v1.0 /me/messages.
 *
 * Drives the signed-in user's Outlook/Exchange Online mailbox: send mail,
 * drafts, replies, forwards, attachment download, label (category) tagging,
 * folder moves, and search. Authentication uses the Microsoft identity
 * platform v2.0 OAuth endpoints against the `common` tenant so one app
 * registration can serve work, school, or personal accounts.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/message?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/user-sendmail?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/message-reply?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/message-forward?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/message-move?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/attachment-get?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/permissions-reference#mail-permissions
 */
export const microsoftOutlookConnector = declarativeRestConnector({
  kind: 'microsoft-outlook',
  displayName: 'Microsoft Outlook',
  description:
    "Send, draft, reply to, forward, search, label, and organize email in the signed-in user's Outlook mailbox via Microsoft Graph.",
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'User.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'MailboxSettings.Read',
    ],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'email.send',
      class: 'mutation',
      description:
        "Send an email immediately from the signed-in user's mailbox. Optionally saves the sent message to the Sent Items folder.",
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          body: { type: 'object' },
          toRecipients: { type: 'array', items: { type: 'object' } },
          ccRecipients: { type: 'array', items: { type: 'object' } },
          bccRecipients: { type: 'array', items: { type: 'object' } },
          attachments: { type: 'array', items: { type: 'object' } },
          saveToSentItems: { type: 'boolean' },
        },
        required: ['subject', 'body', 'toRecipients'],
      },
      request: {
        method: 'POST',
        path: '/me/sendMail',
        body: {
          message: {
            subject: '{subject}',
            body: '{body}',
            toRecipients: '{toRecipients}',
            ccRecipients: '{ccRecipients}',
            bccRecipients: '{bccRecipients}',
            attachments: '{attachments}',
          },
          saveToSentItems: '{saveToSentItems}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['Mail.Send'],
    },
    {
      name: 'email.draft.create',
      class: 'mutation',
      description: 'Create a draft email in the signed-in user mailbox without sending it.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          body: { type: 'object' },
          toRecipients: { type: 'array', items: { type: 'object' } },
          ccRecipients: { type: 'array', items: { type: 'object' } },
          bccRecipients: { type: 'array', items: { type: 'object' } },
          importance: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
        },
        required: ['subject', 'body'],
      },
      request: {
        method: 'POST',
        path: '/me/messages',
        body: {
          subject: '{subject}',
          body: '{body}',
          toRecipients: '{toRecipients}',
          ccRecipients: '{ccRecipients}',
          bccRecipients: '{bccRecipients}',
          importance: '{importance}',
          categories: '{categories}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Mail.ReadWrite'],
    },
    {
      name: 'email.draft.send',
      class: 'mutation',
      description: 'Send a previously created draft message by id.',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
      request: { method: 'POST', path: '/me/messages/{messageId}/send' },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['Mail.Send'],
    },
    {
      name: 'email.reply',
      class: 'mutation',
      description:
        'Reply to an existing message. When comment is provided alone, Graph generates the reply body; when message is provided, it overrides recipients/body.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          comment: { type: 'string' },
          message: { type: 'object' },
        },
        required: ['messageId'],
      },
      request: {
        method: 'POST',
        path: '/me/messages/{messageId}/reply',
        body: { comment: '{comment}', message: '{message}' },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['Mail.Send'],
    },
    {
      name: 'email.forward',
      class: 'mutation',
      description: 'Forward an existing message to one or more recipients with an optional comment.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          toRecipients: { type: 'array', items: { type: 'object' } },
          comment: { type: 'string' },
        },
        required: ['messageId', 'toRecipients'],
      },
      request: {
        method: 'POST',
        path: '/me/messages/{messageId}/forward',
        body: { toRecipients: '{toRecipients}', comment: '{comment}' },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['Mail.Send'],
    },
    {
      name: 'email.move',
      class: 'mutation',
      description: 'Move a message to a destination mail folder by id (or well-known name like inbox/archive).',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          destinationId: { type: 'string' },
        },
        required: ['messageId', 'destinationId'],
      },
      request: {
        method: 'POST',
        path: '/me/messages/{messageId}/move',
        body: { destinationId: '{destinationId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Mail.ReadWrite'],
    },
    {
      name: 'email.label.add',
      class: 'mutation',
      description:
        'Tag a message with one or more Outlook categories (labels). Pass the desired full set; Graph replaces the categories array.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
        },
        required: ['messageId', 'categories'],
      },
      request: {
        method: 'PATCH',
        path: '/me/messages/{messageId}',
        body: { categories: '{categories}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Mail.ReadWrite'],
    },
    {
      name: 'email.label.remove',
      class: 'mutation',
      description:
        'Remove labels from a message by writing the surviving categories array. Caller computes the remaining set and supplies it explicitly.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
        },
        required: ['messageId', 'categories'],
      },
      request: {
        method: 'PATCH',
        path: '/me/messages/{messageId}',
        body: { categories: '{categories}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
      requiredScopes: ['Mail.ReadWrite'],
    },
    {
      name: 'email.find',
      class: 'read',
      description:
        'Search messages in a folder using OData $search/$filter with $top, $select, $orderby. Folder defaults to the well-known inbox if omitted.',
      parameters: {
        type: 'object',
        properties: {
          mailFolderId: { type: 'string' },
          $search: { type: 'string' },
          $filter: { type: 'string' },
          $select: { type: 'string' },
          $top: { type: 'integer' },
          $orderby: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/mailFolders/{mailFolderId}/messages',
        query: {
          $search: '{$search}',
          $filter: '{$filter}',
          $select: '{$select}',
          $top: '{$top}',
          $orderby: '{$orderby}',
        },
      },
      requiredScopes: ['Mail.ReadWrite'],
    },
    {
      name: 'email.attachment.download',
      class: 'read',
      description:
        'Read an attachment record (metadata plus base64 contentBytes for file attachments) for a message by attachment id.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          attachmentId: { type: 'string' },
        },
        required: ['messageId', 'attachmentId'],
      },
      request: {
        method: 'GET',
        path: '/me/messages/{messageId}/attachments/{attachmentId}',
      },
      requiredScopes: ['Mail.ReadWrite'],
    },
    {
      name: 'email.approval.request',
      class: 'mutation',
      description:
        'Send an approval-request email by composing a structured message body and sending it through /me/sendMail. The body should encode the approval prompt and reply-handling instructions.',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          body: { type: 'object' },
          toRecipients: { type: 'array', items: { type: 'object' } },
          ccRecipients: { type: 'array', items: { type: 'object' } },
          saveToSentItems: { type: 'boolean' },
        },
        required: ['subject', 'body', 'toRecipients'],
      },
      request: {
        method: 'POST',
        path: '/me/sendMail',
        body: {
          message: {
            subject: '{subject}',
            body: '{body}',
            toRecipients: '{toRecipients}',
            ccRecipients: '{ccRecipients}',
          },
          saveToSentItems: '{saveToSentItems}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['Mail.Send'],
    },
  ],
})
