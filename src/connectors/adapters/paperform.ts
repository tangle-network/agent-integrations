import { declarativeRestConnector } from './declarative-rest.js'

export const paperformConnector = declarativeRestConnector({
  kind: 'paperform',
  displayName: 'Paperform',
  description: 'Manage Paperform spaces, forms, products, coupons, and submissions.',
  auth: { kind: 'api-key', hint: 'Paperform API key.' },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.paperform.co/v1',
  test: { method: 'GET', path: '/spaces' },
  capabilities: [
    {
      name: 'spaces.create',
      class: 'mutation',
      description: 'Create a new space.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/spaces', body: { name: '{name}', domain: '{domain}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'spaces.update',
      class: 'mutation',
      description: 'Update a space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['spaceId'],
      },
      request: { method: 'PATCH', path: '/spaces/{spaceId}', body: { name: '{name}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'spaces.find',
      class: 'read',
      description: 'Find a space by ID.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
        },
        required: ['spaceId'],
      },
      request: { method: 'GET', path: '/spaces/{spaceId}' },
    },
    {
      name: 'forms.find',
      class: 'read',
      description: 'Find a form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
        },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/forms/{formId}' },
    },
    {
      name: 'submissions.find',
      class: 'read',
      description: 'Find a form submission by ID.',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string' },
        },
        required: ['submissionId'],
      },
      request: { method: 'GET', path: '/submissions/{submissionId}' },
    },
    {
      name: 'submissions.delete',
      class: 'mutation',
      description: 'Delete a form submission.',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string' },
        },
        required: ['submissionId'],
      },
      request: { method: 'DELETE', path: '/submissions/{submissionId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'partial_submissions.delete',
      class: 'mutation',
      description: 'Delete a partial form submission.',
      parameters: {
        type: 'object',
        properties: {
          partialSubmissionId: { type: 'string' },
        },
        required: ['partialSubmissionId'],
      },
      request: { method: 'DELETE', path: '/partial_submissions/{partialSubmissionId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'products.create',
      class: 'mutation',
      description: 'Create a form product.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          name: { type: 'string' },
          sku: { type: 'string' },
          price: { type: 'number' },
          quantity: { type: 'number' },
          discountable: { type: 'boolean' },
          imageUrl: { type: 'string' },
        },
        required: ['formId', 'name', 'sku', 'price'],
      },
      request: {
        method: 'POST',
        path: '/forms/{formId}/products',
        body: {
          name: '{name}',
          sku: '{sku}',
          price: '{price}',
          quantity: '{quantity}',
          discountable: '{discountable}',
          imageUrl: '{imageUrl}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'products.update',
      class: 'mutation',
      description: 'Update a form product.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          productId: { type: 'string' },
          name: { type: 'string' },
          price: { type: 'number' },
          quantity: { type: 'number' },
          discountable: { type: 'boolean' },
        },
        required: ['formId', 'productId'],
      },
      request: {
        method: 'PATCH',
        path: '/forms/{formId}/products/{productId}',
        body: {
          name: '{name}',
          price: '{price}',
          quantity: '{quantity}',
          discountable: '{discountable}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'products.delete',
      class: 'mutation',
      description: 'Delete a form product.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          productId: { type: 'string' },
        },
        required: ['formId', 'productId'],
      },
      request: { method: 'DELETE', path: '/forms/{formId}/products/{productId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'products.find',
      class: 'read',
      description: 'Find a form product.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          search: { type: 'string' },
        },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/forms/{formId}/products', query: { search: '{search}' } },
    },
    {
      name: 'coupons.create',
      class: 'mutation',
      description: 'Create a form coupon.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          code: { type: 'string' },
          discountType: { type: 'string' },
          discountAmount: { type: 'number' },
          discountPercentage: { type: 'number' },
          enabled: { type: 'boolean' },
          expiresAt: { type: 'string' },
        },
        required: ['formId', 'code', 'discountType'],
      },
      request: {
        method: 'POST',
        path: '/forms/{formId}/coupons',
        body: {
          code: '{code}',
          discountType: '{discountType}',
          discountAmount: '{discountAmount}',
          discountPercentage: '{discountPercentage}',
          enabled: '{enabled}',
          expiresAt: '{expiresAt}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'coupons.update',
      class: 'mutation',
      description: 'Update a form coupon.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          couponId: { type: 'string' },
          enabled: { type: 'boolean' },
          discountAmount: { type: 'number' },
          discountPercentage: { type: 'number' },
        },
        required: ['formId', 'couponId'],
      },
      request: {
        method: 'PATCH',
        path: '/forms/{formId}/coupons/{couponId}',
        body: {
          enabled: '{enabled}',
          discountAmount: '{discountAmount}',
          discountPercentage: '{discountPercentage}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'coupons.delete',
      class: 'mutation',
      description: 'Delete a form coupon.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          couponId: { type: 'string' },
        },
        required: ['formId', 'couponId'],
      },
      request: { method: 'DELETE', path: '/forms/{formId}/coupons/{couponId}' },
      cas: 'native-idempotency',
    },
  ],
})
