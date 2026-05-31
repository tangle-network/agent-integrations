import { declarativeRestConnector } from './declarative-rest.js'

// JustInvoice is a SaaS invoicing product. The Activepieces catalog ships the
// piece with two operations — create an invoice from a customer + line items,
// and delete an invoice by id — auth'd by a per-account API key sent as a
// bearer token. The vendor API roots at api.justinvoice.com; the catalog does
// not advertise a custom host, so the bearer + base URL pair is the canonical
// shape.
export const justInvoiceConnector = declarativeRestConnector({
  kind: 'just-invoice',
  displayName: 'JustInvoice',
  description: 'Create and delete invoices in JustInvoice for billing workflows.',
  auth: {
    kind: 'api-key',
    hint: 'JustInvoice API key issued from the account settings. Sent as a bearer token on every request.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.justinvoice.com/v1',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'invoices.create',
      class: 'mutation',
      description:
        'Create a JustInvoice invoice for a customer with one or more line items. The customer is identified by email; optional name and address fields are upserted onto the customer record.',
      parameters: {
        type: 'object',
        properties: {
          customerEmail: {
            type: 'string',
            description: 'Email address of the customer the invoice is billed to.',
          },
          customerFirstName: { type: 'string', description: 'First name of the customer.' },
          customerLastName: { type: 'string', description: 'Last name of the customer.' },
          customerCompanyName: { type: 'string', description: 'Company name of the customer.' },
          customerAddress: { type: 'string', description: 'Street address of the customer.' },
          customerCity: { type: 'string', description: 'City of the customer.' },
          customerProvinceState: {
            type: 'string',
            description: 'Province or state of the customer.',
          },
          customerPostalCode: { type: 'string', description: 'Postal code of the customer.' },
          customerCountry: {
            type: 'string',
            description: 'ISO country code of the customer (e.g. US, CA, GB).',
          },
          invoiceDate: {
            type: 'string',
            description: 'Date of the invoice in YYYY-MM-DD. Defaults to today on the vendor side.',
          },
          invoiceStatus: {
            type: 'string',
            enum: ['draft', 'sent', 'paid', 'overdue', 'void'],
            description: 'Initial status of the invoice.',
          },
          currencyCode: {
            type: 'string',
            description: 'ISO currency code (e.g. USD, EUR, GBP).',
          },
          noteToCustomer: {
            type: 'string',
            description: 'Additional notes shown to the customer on the invoice.',
          },
          lineItems: {
            type: 'array',
            minItems: 1,
            description: 'Products or services being billed.',
            items: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                  description: 'Description of the line item.',
                },
                quantity: {
                  type: 'number',
                  minimum: 0,
                  description: 'Number of units billed.',
                },
                unitPrice: {
                  type: 'number',
                  minimum: 0,
                  description: 'Price per unit, expressed in the invoice currency.',
                },
              },
              required: ['description', 'quantity', 'unitPrice'],
            },
          },
        },
        required: ['customerEmail', 'lineItems'],
      },
      request: {
        method: 'POST',
        path: '/invoices',
        body: {
          customer: {
            email: '{customerEmail}',
            firstName: '{customerFirstName}',
            lastName: '{customerLastName}',
            companyName: '{customerCompanyName}',
            address: '{customerAddress}',
            city: '{customerCity}',
            provinceState: '{customerProvinceState}',
            postalCode: '{customerPostalCode}',
            country: '{customerCountry}',
          },
          invoiceDate: '{invoiceDate}',
          status: '{invoiceStatus}',
          currencyCode: '{currencyCode}',
          noteToCustomer: '{noteToCustomer}',
          lineItems: '{lineItems}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invoices.delete',
      class: 'mutation',
      description: 'Delete a JustInvoice invoice by its invoice id or invoice number.',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: {
            type: 'string',
            description: 'The ID or invoice number of the invoice to delete.',
          },
        },
        required: ['invoiceId'],
      },
      request: {
        method: 'DELETE',
        path: '/invoices/{invoiceId}',
      },
      cas: 'native-idempotency',
    },
  ],
})
