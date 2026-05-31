import { declarativeRestConnector } from './declarative-rest.js'

export const wafeqConnector = declarativeRestConnector({
  kind: 'wafeq',
  displayName: 'Wafeq',
  description: 'Cloud accounting software for invoicing, bills, expenses, and tax reporting (ZATCA, UAE FTA compliance).',
  auth: {
    kind: 'api-key',
    hint: 'Wafeq API key from account settings.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.wafeq.com/v1',
  credentialPlacement: { kind: 'header', header: 'Authorization' },
  test: { method: 'GET', path: '/contacts' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a contact (customer or supplier) in Wafeq.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Business name or full name.' },
          relationship: {
            type: 'string',
            enum: ['customer', 'supplier', 'both'],
            description: 'Type of contact.',
          },
          email: { type: 'string', description: 'Contact email address.' },
          phone: { type: 'string', description: 'Contact phone number.' },
          tax_registration_number: { type: 'string', description: 'VAT or tax ID.' },
          address: { type: 'string', description: 'Street address.' },
          city: { type: 'string', description: 'City name.' },
          postal_code: { type: 'string', description: 'Postal or ZIP code.' },
          country: { type: 'string', description: 'Two-letter ISO country code (e.g., AE, SA, US).' },
          external_id: {
            type: 'string',
            description: 'Your internal reference ID for this contact.',
          },
        },
        required: ['name', 'relationship'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          name: '{name}',
          relationship: '{relationship}',
          email: '{email}',
          phone: '{phone}',
          tax_registration_number: '{tax_registration_number}',
          address: '{address}',
          city: '{city}',
          postal_code: '{postal_code}',
          country: '{country}',
          external_id: '{external_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Search contacts by keyword or reference ID.',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Search term to match against contact names and emails.',
          },
          external_id: {
            type: 'string',
            description: 'Filter by your internal reference ID.',
          },
          limit: {
            type: 'integer',
            description: 'Max results (default 50, max 200).',
            minimum: 1,
            maximum: 200,
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: {
          keyword: '{keyword}',
          external_id: '{external_id}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'invoices.create',
      class: 'mutation',
      description: 'Create a full invoice with line items for a customer.',
      parameters: {
        type: 'object',
        properties: {
          invoice_number: {
            type: 'string',
            description: 'Unique invoice number (e.g., INV-2024-001).',
          },
          invoice_date: {
            type: 'string',
            description: 'Invoice date (ISO format: YYYY-MM-DD).',
          },
          invoice_due_date: {
            type: 'string',
            description: 'Due date (ISO format: YYYY-MM-DD).',
          },
          contact_id: {
            type: 'string',
            description: 'ID of the customer contact.',
          },
          description: {
            type: 'string',
            description: 'Line item description.',
          },
          unit_price: {
            type: 'number',
            description: 'Sale price per unit.',
          },
          status: {
            type: 'string',
            enum: ['draft', 'authorized'],
            description: 'Draft = editable, not in books. Authorized = posted to books.',
          },
        },
        required: ['invoice_number', 'invoice_date', 'invoice_due_date', 'contact_id', 'description', 'unit_price'],
      },
      request: {
        method: 'POST',
        path: '/invoices',
        body: {
          invoice_number: '{invoice_number}',
          invoice_date: '{invoice_date}',
          invoice_due_date: '{invoice_due_date}',
          contact_id: '{contact_id}',
          description: '{description}',
          unit_price: '{unit_price}',
          status: '{status}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invoices.simplified',
      class: 'mutation',
      description: 'Create a simplified invoice (single-line, quick entry).',
      parameters: {
        type: 'object',
        properties: {
          invoice_number: { type: 'string' },
          invoice_date: { type: 'string', description: 'ISO format YYYY-MM-DD.' },
          invoice_due_date: { type: 'string', description: 'ISO format YYYY-MM-DD.' },
          contact_id: { type: 'string' },
          unit_price: { type: 'number' },
          status: { type: 'string', enum: ['draft', 'authorized'] },
        },
        required: ['invoice_number', 'invoice_date', 'invoice_due_date', 'contact_id', 'unit_price'],
      },
      request: {
        method: 'POST',
        path: '/invoices/simplified',
        body: {
          invoice_number: '{invoice_number}',
          invoice_date: '{invoice_date}',
          invoice_due_date: '{invoice_due_date}',
          contact_id: '{contact_id}',
          unit_price: '{unit_price}',
          status: '{status}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invoices.report.tax',
      class: 'mutation',
      description: 'Report an invoice to tax authority (ZATCA/UAE FTA).',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string', description: 'ID of the invoice to report.' },
        },
        required: ['invoice_id'],
      },
      request: {
        method: 'POST',
        path: '/invoices/{invoice_id}/report',
        body: {},
      },
      cas: 'native-idempotency',
    },
    {
      name: 'invoices.download.pdf',
      class: 'read',
      description: 'Download an invoice as PDF.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string', description: 'ID of the invoice.' },
          file_name: { type: 'string', description: 'Optional custom file name for the PDF.' },
        },
        required: ['invoice_id'],
      },
      request: {
        method: 'GET',
        path: '/invoices/{invoice_id}/pdf',
        query: { file_name: '{file_name}' },
      },
    },
    {
      name: 'bills.create',
      class: 'mutation',
      description: 'Create a bill (purchase) from a supplier.',
      parameters: {
        type: 'object',
        properties: {
          bill_number: { type: 'string', description: 'Unique bill number (e.g., BILL-2024-001).' },
          bill_date: { type: 'string', description: 'Date on the bill (ISO format: YYYY-MM-DD).' },
          bill_due_date: { type: 'string', description: 'Due date (ISO format: YYYY-MM-DD).' },
          contact_id: { type: 'string', description: 'ID of the supplier contact.' },
          description: { type: 'string', description: 'Line item description.' },
          unit_cost: { type: 'number', description: 'Cost per unit.' },
          status: { type: 'string', enum: ['draft', 'authorized'] },
          prices_include_tax: { type: 'boolean', description: 'Whether prices include tax.' },
          reference: { type: 'string', description: 'Optional reference (e.g., project name).' },
          order_number: { type: 'string', description: 'Optional PO number.' },
          notes: { type: 'string', description: 'Internal notes.' },
        },
        required: ['bill_number', 'bill_date', 'bill_due_date', 'contact_id', 'description', 'unit_cost'],
      },
      request: {
        method: 'POST',
        path: '/bills',
        body: {
          bill_number: '{bill_number}',
          bill_date: '{bill_date}',
          bill_due_date: '{bill_due_date}',
          contact_id: '{contact_id}',
          description: '{description}',
          unit_cost: '{unit_cost}',
          status: '{status}',
          prices_include_tax: '{prices_include_tax}',
          reference: '{reference}',
          order_number: '{order_number}',
          notes: '{notes}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'credits.create',
      class: 'mutation',
      description: 'Create a credit note.',
      parameters: {
        type: 'object',
        properties: {
          credit_note_number: { type: 'string', description: 'Unique credit note number (e.g., CN-2024-001).' },
          credit_note_date: { type: 'string', description: 'Date of credit note (ISO format: YYYY-MM-DD).' },
          contact_id: { type: 'string', description: 'ID of the contact.' },
          description: { type: 'string', description: 'Line item description.' },
          amount: { type: 'number', description: 'Credit amount.' },
        },
        required: ['credit_note_number', 'credit_note_date', 'contact_id', 'description', 'amount'],
      },
      request: {
        method: 'POST',
        path: '/credit-notes',
        body: {
          credit_note_number: '{credit_note_number}',
          credit_note_date: '{credit_note_date}',
          contact_id: '{contact_id}',
          description: '{description}',
          amount: '{amount}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'quotes.create',
      class: 'mutation',
      description: 'Create a quote (sales proposal).',
      parameters: {
        type: 'object',
        properties: {
          quote_number: { type: 'string', description: 'Unique quote number (e.g., QT-2024-001).' },
          quote_date: { type: 'string', description: 'Quote date (ISO format: YYYY-MM-DD).' },
          contact_id: { type: 'string', description: 'ID of the customer contact.' },
          description: { type: 'string', description: 'Line item description.' },
          unit_price: { type: 'number', description: 'Price per unit.' },
          purchase_order: { type: 'string', description: 'Optional customer PO number.' },
        },
        required: ['quote_number', 'quote_date', 'contact_id', 'description', 'unit_price'],
      },
      request: {
        method: 'POST',
        path: '/quotes',
        body: {
          quote_number: '{quote_number}',
          quote_date: '{quote_date}',
          contact_id: '{contact_id}',
          description: '{description}',
          unit_price: '{unit_price}',
          purchase_order: '{purchase_order}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'quotes.convert',
      class: 'mutation',
      description: 'Convert a quote to an invoice.',
      parameters: {
        type: 'object',
        properties: {
          quote_id: { type: 'string', description: 'ID of the quote to convert.' },
          invoice_number: { type: 'string', description: 'Number for the new invoice.' },
          invoice_date: { type: 'string', description: 'Invoice date (ISO format: YYYY-MM-DD).' },
        },
        required: ['quote_id', 'invoice_number', 'invoice_date'],
      },
      request: {
        method: 'POST',
        path: '/quotes/{quote_id}/convert',
        body: {
          invoice_number: '{invoice_number}',
          invoice_date: '{invoice_date}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'payments.record',
      class: 'mutation',
      description: 'Record a payment received from a customer or payment made to supplier.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['customer_payment', 'supplier_payment'],
            description: 'Payment type.',
          },
          target_id: {
            type: 'string',
            description: 'ID of the document (invoice, bill, or credit note).',
          },
          amount: { type: 'number', description: 'Amount applied to the document.' },
          amount_to_pcy: {
            type: 'number',
            description: 'Amount in the payment currency.',
          },
          date: { type: 'string', description: 'Payment date (ISO format: YYYY-MM-DD).' },
          payment_fees: { type: 'number', description: 'Optional bank/card fees.' },
        },
        required: ['type', 'target_id', 'amount', 'amount_to_pcy', 'date'],
      },
      request: {
        method: 'POST',
        path: '/payments',
        body: {
          type: '{type}',
          target_id: '{target_id}',
          amount: '{amount}',
          amount_to_pcy: '{amount_to_pcy}',
          date: '{date}',
          payment_fees: '{payment_fees}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'items.create',
      class: 'mutation',
      description: 'Create a catalog item (product or service).',
      parameters: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'SKU or product code.' },
          description: { type: 'string', description: 'Item description.' },
          unit_price: { type: 'number', description: 'Sale price per unit.' },
          unit_cost: { type: 'number', description: 'Purchase cost per unit.' },
          revenue_account: {
            type: 'string',
            description: 'Advanced: account ID for sales revenue.',
          },
          expense_account: {
            type: 'string',
            description: 'Advanced: account ID for purchase expense.',
          },
          revenue_tax_rate: {
            type: 'string',
            description: 'Advanced: tax rate ID for sales.',
          },
          purchase_tax_rate: {
            type: 'string',
            description: 'Advanced: tax rate ID for purchases.',
          },
          is_tracked_inventory: {
            type: 'boolean',
            description: 'Track stock levels.',
          },
          is_active: { type: 'boolean', description: 'Item is active and can be added to invoices.' },
        },
        required: ['description'],
      },
      request: {
        method: 'POST',
        path: '/items',
        body: {
          sku: '{sku}',
          description: '{description}',
          unit_price: '{unit_price}',
          unit_cost: '{unit_cost}',
          revenue_account: '{revenue_account}',
          expense_account: '{expense_account}',
          revenue_tax_rate: '{revenue_tax_rate}',
          purchase_tax_rate: '{purchase_tax_rate}',
          is_tracked_inventory: '{is_tracked_inventory}',
          is_active: '{is_active}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'items.list',
      class: 'read',
      description: 'List catalog items.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results to return.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/items',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'accounts.list',
      class: 'read',
      description: 'List chart of accounts, optionally filtered by type and payment capability.',
      parameters: {
        type: 'object',
        properties: {
          classification: {
            type: 'string',
            enum: ['revenue', 'expense', 'asset', 'liability', 'equity'],
            description: 'Filter by account type.',
          },
          is_payment_enabled: {
            type: 'string',
            enum: ['true', 'false'],
            description: 'Payment-enabled (bank/cash/card) accounts only.',
          },
          created_after: {
            type: 'string',
            description: 'Filter accounts created on or after this date (ISO format: YYYY-MM-DD).',
          },
          created_before: {
            type: 'string',
            description: 'Filter accounts created on or before this date (ISO format: YYYY-MM-DD).',
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/accounts',
        query: {
          classification: '{classification}',
          is_payment_enabled: '{is_payment_enabled}',
          created_after: '{created_after}',
          created_before: '{created_before}',
        },
      },
    },
  ],
})
