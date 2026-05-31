import { declarativeRestConnector } from './declarative-rest.js'

export const simplybookmeConnector = declarativeRestConnector({
  kind: 'simplybookme',
  displayName: 'SimplyBook.me',
  description: 'Manage bookings, clients, and services in SimplyBook.me.',
  auth: {
    kind: 'api-key',
    hint: 'SimplyBook.me company login, user login, and password',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'companyLogin' },
  test: { method: 'GET', path: '/admin/bookings' },
  capabilities: [
    {
      name: 'bookings.create',
      class: 'mutation',
      description: 'Create a new booking.',
      parameters: {
        type: 'object',
        properties: {
          clientName: { type: 'string' },
          startDate: { type: 'string' },
          startTime: { type: 'string' },
          endDate: { type: 'string' },
          endTime: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['clientName', 'startDate', 'startTime', 'endDate', 'endTime'],
      },
      request: {
        method: 'POST',
        path: '/admin/bookings',
        body: {
          name: '{clientName}',
          email: '{email}',
          phone: '{phone}',
          startDate: '{startDate}',
          startTime: '{startTime}',
          endDate: '{endDate}',
          endTime: '{endTime}',
          comment: '{comment}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bookings.find',
      class: 'read',
      description: 'Find bookings by criteria.',
      parameters: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string' },
          dateTo: { type: 'string' },
          code: { type: 'string' },
          clientId: { type: 'integer' },
          serviceId: { type: 'integer' },
          providerId: { type: 'integer' },
          status: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/admin/bookings',
        query: {
          dateFrom: '{dateFrom}',
          dateTo: '{dateTo}',
          code: '{code}',
          clientId: '{clientId}',
          serviceId: '{serviceId}',
          providerId: '{providerId}',
          status: '{status}',
        },
      },
    },
    {
      name: 'bookings.cancel',
      class: 'mutation',
      description: 'Cancel an existing booking.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'integer' },
        },
        required: ['bookingId'],
      },
      request: {
        method: 'POST',
        path: '/admin/bookings/{bookingId}/cancel',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'bookings.addComment',
      class: 'mutation',
      description: 'Add a comment to a booking.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'integer' },
          comment: { type: 'string' },
        },
        required: ['bookingId', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/admin/bookings/{bookingId}/comments',
        body: {
          comment: '{comment}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'clients.create',
      class: 'mutation',
      description: 'Create a new client.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          zip: { type: 'string' },
          countryId: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/admin/clients',
        body: {
          name: '{name}',
          email: '{email}',
          phone: '{phone}',
          address: '{address}',
          city: '{city}',
          zip: '{zip}',
          countryId: '{countryId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'clients.find',
      class: 'read',
      description: 'Find clients by search criteria.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer' },
          page: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/admin/clients',
        query: {
          search: '{search}',
          limit: '{limit}',
          page: '{page}',
        },
      },
    },
    {
      name: 'clients.delete',
      class: 'mutation',
      description: 'Delete a client.',
      parameters: {
        type: 'object',
        properties: {
          clientId: { type: 'integer' },
        },
        required: ['clientId'],
      },
      request: {
        method: 'DELETE',
        path: '/admin/clients/{clientId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'invoices.find',
      class: 'read',
      description: 'Find invoices by criteria.',
      parameters: {
        type: 'object',
        properties: {
          datetimeFrom: { type: 'string' },
          datetimeTo: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'integer' },
          page: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/admin/invoices',
        query: {
          datetimeFrom: '{datetimeFrom}',
          datetimeTo: '{datetimeTo}',
          status: '{status}',
          limit: '{limit}',
          page: '{page}',
        },
      },
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description: 'Create a note or block time.',
      parameters: {
        type: 'object',
        properties: {
          startDateTime: { type: 'string' },
          endDateTime: { type: 'string' },
          note: { type: 'string' },
          mode: { type: 'string' },
          timeBlocked: { type: 'boolean' },
        },
        required: ['startDateTime', 'endDateTime', 'note'],
      },
      request: {
        method: 'POST',
        path: '/admin/notes',
        body: {
          startDateTime: '{startDateTime}',
          endDateTime: '{endDateTime}',
          note: '{note}',
          mode: '{mode}',
          timeBlocked: '{timeBlocked}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
