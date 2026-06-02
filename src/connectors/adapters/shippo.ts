import { declarativeRestConnector } from './declarative-rest.js'

export const shippoConnector = declarativeRestConnector({
  kind: 'shippo',
  displayName: 'Shippo',
  description: 'Multi-carrier shipping platform for real-time rates, labels, and tracking.',
  auth: { kind: 'api-key', hint: 'Shippo API key.' },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.goshippo.com',
  test: { method: 'GET', path: '/v1/serviceleveltoken' },
  capabilities: [
    {
      name: 'orders.create',
      class: 'mutation',
      description: 'Create a new order in Shippo.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Custom order number' },
          orderStatus: { type: 'string', description: 'Order status (e.g., awaiting_shipment, shipped, cancelled)' },
          placedAt: { type: 'string', description: 'ISO 8601 timestamp when order was placed' },
          totalPrice: { type: 'string', description: 'Total price including shipping and tax' },
          subtotalPrice: { type: 'string', description: 'Price before shipping and tax' },
          totalTax: { type: 'string', description: 'Total tax amount' },
          currency: { type: 'string', description: 'Currency code (USD, EUR, etc.)' },
          fromName: { type: 'string', description: 'Sender name' },
          fromCompany: { type: 'string', description: 'Sender company' },
          fromStreet1: { type: 'string', description: 'Sender street address line 1' },
          fromCity: { type: 'string', description: 'Sender city' },
          fromState: { type: 'string', description: 'Sender state/province' },
          fromZip: { type: 'string', description: 'Sender postal code' },
          fromCountry: { type: 'string', description: 'Sender country code' },
          toName: { type: 'string', description: 'Recipient name' },
          toCompany: { type: 'string', description: 'Recipient company' },
          toStreet1: { type: 'string', description: 'Recipient street address line 1' },
          toCity: { type: 'string', description: 'Recipient city' },
          toState: { type: 'string', description: 'Recipient state/province' },
          toZip: { type: 'string', description: 'Recipient postal code' },
          toCountry: { type: 'string', description: 'Recipient country code' },
        },
        required: ['orderId', 'orderStatus', 'placedAt', 'totalPrice', 'currency', 'toName', 'toCountry'],
      },
      request: {
        method: 'POST',
        path: '/v1/orders',
        body: {
          order_number: '{orderId}',
          order_status: '{orderStatus}',
          placed_at: '{placedAt}',
          total_price: '{totalPrice}',
          subtotal_price: '{subtotalPrice}',
          total_tax: '{totalTax}',
          currency: '{currency}',
          address_from: {
            name: '{fromName}',
            company: '{fromCompany}',
            street1: '{fromStreet1}',
            city: '{fromCity}',
            state: '{fromState}',
            zip: '{fromZip}',
            country: '{fromCountry}',
          },
          address_to: {
            name: '{toName}',
            company: '{toCompany}',
            street1: '{toStreet1}',
            city: '{toCity}',
            state: '{toState}',
            zip: '{toZip}',
            country: '{toCountry}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'orders.find',
      class: 'read',
      description: 'Find an order by order number or ID.',
      parameters: {
        type: 'object',
        properties: {
          orderIdOrNumber: { type: 'string', description: 'Order ID or order number' },
        },
        required: ['orderIdOrNumber'],
      },
      request: {
        method: 'GET',
        path: '/v1/orders/{orderIdOrNumber}',
      },
    },
    {
      name: 'shippinglabels.find',
      class: 'read',
      description: 'Find a shipping label by transaction ID.',
      parameters: {
        type: 'object',
        properties: {
          transactionId: { type: 'string', description: 'Transaction ID of the shipping label' },
        },
        required: ['transactionId'],
      },
      request: {
        method: 'GET',
        path: '/v1/transactions/{transactionId}',
      },
    },
    {
      name: 'transactions.create',
      class: 'mutation',
      description:
        'Purchase a shipping label by transacting against a previously quoted rate. Returns transaction object_id, status, tracking_number, tracking_url_provider, and label_url.',
      parameters: {
        type: 'object',
        properties: {
          rate: { type: 'string', description: 'Rate object_id returned from a previous shipment quote.' },
          label_file_type: {
            type: 'string',
            description: 'Output format for the label file (PDF, PNG, PNG_2.3x7.5, ZPLII, etc.). Optional; defaults to the account-level setting.',
          },
          async: {
            type: 'boolean',
            description: 'When true the carrier purchase is queued and the transaction polls to SUCCESS asynchronously. Defaults to false (synchronous).',
            default: false,
          },
        },
        required: ['rate'],
      },
      request: {
        method: 'POST',
        path: '/v1/transactions',
        body: {
          rate: '{rate}',
          label_file_type: '{label_file_type}',
          async: '{async}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tracks.get',
      class: 'read',
      description:
        'Get current tracking status and history for a tracking number on a specific carrier. Returns tracking_status, tracking_history, and eta.',
      parameters: {
        type: 'object',
        properties: {
          carrier: { type: 'string', description: 'Carrier token (e.g. usps, ups, fedex, dhl_express).' },
          tracking_number: { type: 'string', description: 'Carrier-issued tracking number.' },
        },
        required: ['carrier', 'tracking_number'],
      },
      request: {
        method: 'GET',
        path: '/v1/tracks/{carrier}/{tracking_number}',
      },
    },
  ],
})
