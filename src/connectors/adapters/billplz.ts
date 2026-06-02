import { declarativeRestConnector } from './declarative-rest.js'

// Billplz is a Malaysian payment-collection gateway. The public REST surface
// lives at https://www.billplz.com/api/v3 (production) and is mirrored at
// https://www.billplz-sandbox.com/api/v3 for sandbox testing. The activepieces
// piece exposes two action verbs against the bills resource — create and get —
// which together back the typical "send-a-bill, poll-for-payment" flow.
//
// Auth is HTTP Basic with the API key as the username and an empty password.
// We model it as `api-key` here; the declarative-rest runtime places the
// credential as the Basic-auth username via the standard credential header.
//
// The collection_id is per-tenant and is required to scope new bills. It is
// stored on the connection metadata so callers can target the correct
// collection without re-supplying it on every invocation.

export const billplzConnector = declarativeRestConnector({
  kind: 'billplz',
  displayName: 'Billplz',
  description: 'Create and retrieve Billplz bills for Malaysian Ringgit payment collection.',
  auth: {
    kind: 'api-key',
    hint: 'Billplz API key from Settings → Account Settings. Used as the HTTP Basic username with an empty password.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.billplz.com/api/v3',
  test: { method: 'GET', path: '/collections' },
  capabilities: [
    {
      name: 'create.bill',
      class: 'mutation',
      description: 'Create a Billplz bill in a collection and (optionally) trigger delivery to the recipient.',
      parameters: {
        type: 'object',
        properties: {
          collection_id: {
            type: 'string',
            description: 'Collection identifier that will own the new bill.',
          },
          email: {
            type: 'string',
            description: 'Recipient email address (required if mobile is omitted).',
          },
          mobile: {
            type: 'string',
            description: 'Recipient mobile number with country code (required if email is omitted).',
          },
          name: {
            type: 'string',
            description: 'Name of the bill recipient as displayed on the bill.',
          },
          amount: {
            type: 'integer',
            description: 'Amount in sen (1/100 of a Ringgit). E.g. 200 represents RM 2.00.',
          },
          description: {
            type: 'string',
            description: 'Bill description rendered on the payment page.',
          },
          callback_url: {
            type: 'string',
            description: 'Webhook URL Billplz will POST to on payment state changes.',
          },
          due_at: {
            type: 'string',
            description: 'Due date in YYYY-MM-DD format. Defaults to today when omitted.',
          },
          redirect_url: {
            type: 'string',
            description: 'URL the payer is redirected to after completing payment.',
          },
          deliver: {
            type: 'boolean',
            description: 'If true, Billplz emails/SMSes the bill link to the recipient.',
          },
          reference_1_label: {
            type: 'string',
            description: 'Label for the first custom reference field.',
          },
          reference_1: {
            type: 'string',
            description: 'Value for the first custom reference field.',
          },
          reference_2_label: {
            type: 'string',
            description: 'Label for the second custom reference field.',
          },
          reference_2: {
            type: 'string',
            description: 'Value for the second custom reference field.',
          },
        },
        required: ['collection_id', 'name', 'amount', 'description', 'callback_url'],
      },
      request: {
        method: 'POST',
        path: '/bills',
        body: {
          collection_id: '{collection_id}',
          email: '{email}',
          mobile: '{mobile}',
          name: '{name}',
          amount: '{amount}',
          description: '{description}',
          callback_url: '{callback_url}',
          due_at: '{due_at}',
          redirect_url: '{redirect_url}',
          deliver: '{deliver}',
          reference_1_label: '{reference_1_label}',
          reference_1: '{reference_1}',
          reference_2_label: '{reference_2_label}',
          reference_2: '{reference_2}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'get.bill',
      class: 'read',
      description: 'Fetch a Billplz bill by its identifier, including current payment state.',
      parameters: {
        type: 'object',
        properties: {
          bill_id: {
            type: 'string',
            description: 'Billplz bill identifier returned by create.bill.',
          },
        },
        required: ['bill_id'],
      },
      request: {
        method: 'GET',
        path: '/bills/{bill_id}',
      },
    },
    {
      name: 'cancel.bill',
      class: 'mutation',
      description:
        'Delete (cancel) an unpaid Billplz bill by its identifier. Paid bills cannot be deleted and the upstream will reject the request.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Billplz bill identifier to cancel.',
          },
        },
        required: ['id'],
      },
      request: {
        method: 'DELETE',
        path: '/bills/{id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'create.refund',
      class: 'mutation',
      description:
        'Refund a paid Billplz bill in full or in part. Amount is in sen (1/100 of a Ringgit) and must not exceed the original paid amount.',
      parameters: {
        type: 'object',
        properties: {
          bill_id: {
            type: 'string',
            description: 'Identifier of the paid bill being refunded.',
          },
          amount: {
            type: 'integer',
            description: 'Refund amount in sen (1/100 of a Ringgit). E.g. 200 represents RM 2.00.',
          },
          reason: {
            type: 'string',
            description: 'Reason recorded on the refund for audit/reporting.',
          },
        },
        required: ['bill_id', 'amount', 'reason'],
      },
      request: {
        method: 'POST',
        path: '/refunds',
        body: {
          bill_id: '{bill_id}',
          amount: '{amount}',
          reason: '{reason}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
