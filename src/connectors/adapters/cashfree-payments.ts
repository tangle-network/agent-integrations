import { declarativeRestConnector } from './declarative-rest.js'

// Cashfree Payment Gateway v3 (PG) + Payouts.
// PG base: https://api.cashfree.com/pg (sandbox: https://sandbox.cashfree.com/pg)
// Payouts base: https://payout-api.cashfree.com/payout (sandbox: https://payout-gamma.cashfree.com/payout)
// The connector targets the production PG host; sandbox routing is selected at
// orchestration time via source.metadata.baseUrl override (resolveBaseUrl).
//
// Auth model: Cashfree requires both x-client-id and x-client-secret on every
// request. The catalog declares `api_key` auth. We carry the client secret as
// the credential and require the client id from source.metadata.clientId so a
// single api-key credential can express both PG and Payouts scopes per tenant.
export const cashfreePaymentsConnector = declarativeRestConnector({
  kind: 'cashfree-payments',
  displayName: 'Cashfree Payments',
  description:
    'Cashfree Payments integration for processing payments, refunds, and managing payment links and cashgrams.',
  auth: {
    kind: 'api-key',
    hint: 'Cashfree client secret. Set source.metadata.clientId to the matching x-client-id; override metadata.baseUrl for sandbox/payouts hosts.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://api.cashfree.com/pg' },
  credentialPlacement: { kind: 'header', header: 'x-client-secret' },
  defaultHeaders: {
    'x-api-version': '2023-08-01',
    'x-client-id': '{metadata.clientId}',
  },
  test: { method: 'GET', path: '/orders/__connector_probe__' },
  capabilities: [
    {
      name: 'orders.create',
      class: 'mutation',
      description: 'Create an order in Cashfree PG.',
      parameters: {
        type: 'object',
        properties: {
          orderAmount: { type: 'number' },
          orderCurrency: { type: 'string' },
          customerId: { type: 'string' },
          customerPhone: { type: 'string' },
          customerEmail: { type: 'string' },
          customerName: { type: 'string' },
          orderId: { type: 'string' },
          orderNote: { type: 'string' },
          orderExpiryTime: { type: 'string' },
          returnUrl: { type: 'string' },
          notifyUrl: { type: 'string' },
          paymentMethods: { type: 'string' },
          orderTags: { type: 'object' },
          orderSplits: { type: 'array' },
        },
        required: ['orderAmount', 'orderCurrency', 'customerId', 'customerPhone'],
      },
      request: {
        method: 'POST',
        path: '/orders',
        headers: { 'x-idempotency-key': '{idempotencyKey}', 'x-request-id': '{requestId}' },
        body: {
          order_amount: '{orderAmount}',
          order_currency: '{orderCurrency}',
          order_id: '{orderId}',
          order_note: '{orderNote}',
          order_expiry_time: '{orderExpiryTime}',
          order_tags: '{orderTags}',
          order_splits: '{orderSplits}',
          customer_details: {
            customer_id: '{customerId}',
            customer_phone: '{customerPhone}',
            customer_email: '{customerEmail}',
            customer_name: '{customerName}',
            customer_bank_account_number: '{customerBankAccountNumber}',
            customer_bank_ifsc: '{customerBankIfsc}',
            customer_bank_code: '{customerBankCode}',
          },
          order_meta: {
            return_url: '{returnUrl}',
            notify_url: '{notifyUrl}',
            payment_methods: '{paymentMethods}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'payment_links.create',
      class: 'mutation',
      description: 'Create a Cashfree payment link.',
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          linkAmount: { type: 'number' },
          linkCurrency: { type: 'string' },
          linkPurpose: { type: 'string' },
          customerName: { type: 'string' },
          customerEmail: { type: 'string' },
          customerPhone: { type: 'string' },
          linkPartialPayments: { type: 'boolean' },
          linkMinimumPartialAmount: { type: 'number' },
          linkExpiryTime: { type: 'string' },
          sendSms: { type: 'boolean' },
          sendEmail: { type: 'boolean' },
          linkAutoReminders: { type: 'boolean' },
          upiIntent: { type: 'boolean' },
          linkNotes: { type: 'object' },
          notifyUrl: { type: 'string' },
          returnUrl: { type: 'string' },
        },
        required: ['linkId', 'linkAmount', 'linkCurrency', 'linkPurpose', 'customerPhone'],
      },
      request: {
        method: 'POST',
        path: '/links',
        headers: { 'x-idempotency-key': '{idempotencyKey}', 'x-request-id': '{requestId}' },
        body: {
          link_id: '{linkId}',
          link_amount: '{linkAmount}',
          link_currency: '{linkCurrency}',
          link_purpose: '{linkPurpose}',
          link_partial_payments: '{linkPartialPayments}',
          link_minimum_partial_amount: '{linkMinimumPartialAmount}',
          link_expiry_time: '{linkExpiryTime}',
          link_auto_reminders: '{linkAutoReminders}',
          link_notes: '{linkNotes}',
          customer_details: {
            customer_name: '{customerName}',
            customer_email: '{customerEmail}',
            customer_phone: '{customerPhone}',
          },
          link_notify: {
            send_sms: '{sendSms}',
            send_email: '{sendEmail}',
          },
          link_meta: {
            notify_url: '{notifyUrl}',
            return_url: '{returnUrl}',
            upi_intent: '{upiIntent}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'refunds.create',
      class: 'mutation',
      description: 'Create a refund against a Cashfree order.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          refundId: { type: 'string' },
          refundAmount: { type: 'number' },
          refundNote: { type: 'string' },
          refundSpeed: { type: 'string' },
          refundSplits: { type: 'array' },
        },
        required: ['orderId', 'refundId', 'refundAmount'],
      },
      request: {
        method: 'POST',
        path: '/orders/{orderId}/refunds',
        headers: { 'x-idempotency-key': '{idempotencyKey}', 'x-request-id': '{requestId}' },
        body: {
          refund_id: '{refundId}',
          refund_amount: '{refundAmount}',
          refund_note: '{refundNote}',
          refund_speed: '{refundSpeed}',
          refund_splits: '{refundSplits}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'payment_links.cancel',
      class: 'mutation',
      description: 'Cancel an ACTIVE Cashfree payment link.',
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
      request: {
        method: 'POST',
        path: '/links/{linkId}/cancel',
        headers: { 'x-request-id': '{requestId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'payment_links.get',
      class: 'read',
      description: 'Fetch details for a Cashfree payment link.',
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
      request: { method: 'GET', path: '/links/{linkId}' },
    },
    {
      name: 'cashgrams.create',
      class: 'mutation',
      description: 'Create a Cashfree Cashgram (payout link).',
      parameters: {
        type: 'object',
        properties: {
          cashgramId: { type: 'string' },
          amount: { type: 'number' },
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          linkExpiry: { type: 'string' },
          remarks: { type: 'string' },
          notifyCustomer: { type: 'boolean' },
        },
        required: ['cashgramId', 'amount', 'name', 'phone', 'linkExpiry'],
      },
      request: {
        method: 'POST',
        path: '/v1/createCashgram',
        headers: { 'x-idempotency-key': '{idempotencyKey}', 'x-request-id': '{requestId}' },
        body: {
          cashgramId: '{cashgramId}',
          amount: '{amount}',
          name: '{name}',
          email: '{email}',
          phone: '{phone}',
          linkExpiry: '{linkExpiry}',
          remarks: '{remarks}',
          notifyCustomer: '{notifyCustomer}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'payment_links.orders.list',
      class: 'read',
      description: 'List orders associated with a payment link.',
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
      request: { method: 'GET', path: '/links/{linkId}/orders' },
    },
    {
      name: 'orders.refunds.list',
      class: 'read',
      description: 'List all refunds attached to a Cashfree order.',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      request: { method: 'GET', path: '/orders/{orderId}/refunds' },
    },
    {
      name: 'cashgrams.deactivate',
      class: 'mutation',
      description: 'Deactivate an existing Cashfree Cashgram.',
      parameters: {
        type: 'object',
        properties: { cashgramId: { type: 'string' } },
        required: ['cashgramId'],
      },
      request: {
        method: 'POST',
        path: '/v1/deactivateCashgram',
        headers: { 'x-request-id': '{requestId}' },
        body: { cashgramId: '{cashgramId}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
