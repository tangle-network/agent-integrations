import { declarativeRestConnector } from './declarative-rest.js'

export const zohoBookingsConnector = declarativeRestConnector({
  kind: 'zoho-bookings',
  displayName: 'Zoho Bookings',
  description: 'Manage appointments and services in Zoho Bookings: book, reschedule, and cancel appointments; fetch availability; and retrieve appointment details.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scopes: ['ZohoBokings.appointments.ALL', 'offline_access'],
    clientIdEnv: 'ZOHO_BOOKINGS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZOHO_BOOKINGS_OAUTH_CLIENT_SECRET',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiDomain', fallback: 'https://www.zohoapis.com' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Zoho-oauthtoken ' },
  test: { method: 'GET', path: '/bookings/v1/appointments' },
  capabilities: [
    {
      name: 'appointment.list',
      class: 'read',
      description: 'List all appointments with optional filtering by status, date range, or customer.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by appointment status (e.g. confirmed, cancelled, completed).',
          },
          startDate: {
            type: 'string',
            description: 'ISO 8601 date to filter appointments from (inclusive).',
          },
          endDate: {
            type: 'string',
            description: 'ISO 8601 date to filter appointments until (inclusive).',
          },
          customerId: {
            type: 'string',
            description: 'Filter appointments by customer ID.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: 'Number of records to return.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/bookings/v1/appointments',
        query: {
          status: '{status}',
          startDate: '{startDate}',
          endDate: '{endDate}',
          customerId: '{customerId}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['ZohoBokings.appointments.ALL'],
    },
    {
      name: 'appointment.get',
      class: 'read',
      description: 'Fetch details for a specific appointment by ID.',
      parameters: {
        type: 'object',
        properties: {
          appointmentId: {
            type: 'string',
            description: 'The unique appointment ID.',
          },
        },
        required: ['appointmentId'],
      },
      request: {
        method: 'GET',
        path: '/bookings/v1/appointments/{appointmentId}',
      },
      requiredScopes: ['ZohoBokings.appointments.ALL'],
    },
    {
      name: 'availability.fetch',
      class: 'read',
      description: 'Fetch available time slots for a service and date range.',
      parameters: {
        type: 'object',
        properties: {
          serviceId: {
            type: 'string',
            description: 'The service ID to check availability for.',
          },
          startDate: {
            type: 'string',
            description: 'ISO 8601 date to start checking availability.',
          },
          endDate: {
            type: 'string',
            description: 'ISO 8601 date to end checking availability.',
          },
        },
        required: ['serviceId', 'startDate', 'endDate'],
      },
      request: {
        method: 'GET',
        path: '/bookings/v1/availability',
        query: {
          serviceId: '{serviceId}',
          startDate: '{startDate}',
          endDate: '{endDate}',
        },
      },
      requiredScopes: ['ZohoBokings.appointments.ALL'],
    },
    {
      name: 'appointment.book',
      class: 'mutation',
      description: 'Book a new appointment for a customer at an available time slot.',
      parameters: {
        type: 'object',
        properties: {
          customerId: {
            type: 'string',
            description: 'The customer ID to book the appointment for.',
          },
          serviceId: {
            type: 'string',
            description: 'The service ID for the appointment.',
          },
          startTime: {
            type: 'string',
            description: 'ISO 8601 datetime for the appointment start.',
          },
          details: {
            type: 'object',
            description: 'Additional appointment details (notes, custom fields, etc.).',
          },
        },
        required: ['customerId', 'serviceId', 'startTime'],
      },
      request: {
        method: 'POST',
        path: '/bookings/v1/appointments',
        body: {
          customerId: '{customerId}',
          serviceId: '{serviceId}',
          startTime: '{startTime}',
          details: '{details}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBokings.appointments.ALL'],
    },
    {
      name: 'appointment.reschedule',
      class: 'mutation',
      description: 'Reschedule an existing appointment to a new date and time.',
      parameters: {
        type: 'object',
        properties: {
          appointmentId: {
            type: 'string',
            description: 'The appointment ID to reschedule.',
          },
          startTime: {
            type: 'string',
            description: 'ISO 8601 datetime for the new appointment start.',
          },
          reason: {
            type: 'string',
            description: 'Optional reason for rescheduling.',
          },
        },
        required: ['appointmentId', 'startTime'],
      },
      request: {
        method: 'PUT',
        path: '/bookings/v1/appointments/{appointmentId}/reschedule',
        body: {
          startTime: '{startTime}',
          reason: '{reason}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBokings.appointments.ALL'],
    },
    {
      name: 'appointment.cancel',
      class: 'mutation',
      description: 'Cancel an existing appointment.',
      parameters: {
        type: 'object',
        properties: {
          appointmentId: {
            type: 'string',
            description: 'The appointment ID to cancel.',
          },
          reason: {
            type: 'string',
            description: 'Optional cancellation reason.',
          },
        },
        required: ['appointmentId'],
      },
      request: {
        method: 'DELETE',
        path: '/bookings/v1/appointments/{appointmentId}',
        query: {
          reason: '{reason}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBokings.appointments.ALL'],
    },
  ],
})
