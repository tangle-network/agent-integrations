import { declarativeRestConnector } from './declarative-rest.js'

export const youcanbookmeConnector = declarativeRestConnector({
  kind: 'youcanbookme',
  displayName: 'YouCanBookMe',
  description: 'Manage online scheduling, profiles, and bookings with YouCanBookMe.',
  auth: { kind: 'api-key', hint: 'YouCanBookMe Account ID or API credentials.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.youcanbookme.com/v1',
  test: { method: 'GET', path: '/profiles' },
  capabilities: [
    {
      name: 'profiles.create',
      class: 'mutation',
      description: 'Create a new booking profile.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Profile title' },
          description: { type: 'string', description: 'Profile description' },
          subdomain: { type: 'string', description: 'Subdomain for the profile' },
          timeZone: { type: 'string', description: 'Time zone (e.g., America/New_York)' },
          locale: { type: 'string', description: 'Locale (e.g., en-US)' },
          logo: { type: 'string', description: 'Logo URL' },
          accessCode: { type: 'string', description: 'Access code' },
          displayTimeZone: { type: 'string', description: 'Display time zone' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/profiles',
        body: {
          title: '{title}',
          description: '{description}',
          subdomain: '{subdomain}',
          timeZone: '{timeZone}',
          locale: '{locale}',
          logo: '{logo}',
          accessCode: '{accessCode}',
          displayTimeZone: '{displayTimeZone}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bookings.retrieve',
      class: 'read',
      description: 'Retrieve a booking by ID.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'Booking ID' },
          fields: {
            type: 'string',
            description: 'Comma-separated list of fields to return (default: id,title,accountId,profileId,createdAt,startsAt,endsAt,location,tentative,timeZone,cancelled,numberOfSlots)',
          },
          displayTimeZone: { type: 'string', description: 'Time zone to display times in' },
        },
        required: ['bookingId'],
      },
      request: {
        method: 'GET',
        path: '/bookings/{bookingId}',
        query: {
          fields: '{fields}',
          displayTimeZone: '{displayTimeZone}',
        },
      },
    },
    {
      name: 'bookings.cancel',
      class: 'mutation',
      description: 'Cancel a booking by ID.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'Booking ID to cancel' },
          reason: { type: 'string', description: 'Optional cancellation reason' },
        },
        required: ['bookingId'],
      },
      request: {
        method: 'POST',
        path: '/bookings/{bookingId}/cancel',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bookings.reschedule',
      class: 'mutation',
      description: 'Reschedule a booking to a new slot.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'Booking ID to reschedule' },
          startsAt: { type: 'string', description: 'New start time (ISO 8601)' },
          endsAt: { type: 'string', description: 'New end time (ISO 8601)' },
          timeZone: { type: 'string', description: 'Time zone for the new slot' },
        },
        required: ['bookingId', 'startsAt'],
      },
      request: {
        method: 'POST',
        path: '/bookings/{bookingId}/reschedule',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'profiles.update',
      class: 'mutation',
      description: 'Update an existing booking profile.',
      parameters: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID to update' },
          title: { type: 'string', description: 'Updated profile title' },
          description: { type: 'string', description: 'Updated profile description' },
          subdomain: { type: 'string', description: 'Updated subdomain' },
          timeZone: { type: 'string', description: 'Updated time zone' },
          locale: { type: 'string', description: 'Updated locale' },
          logo: { type: 'string', description: 'Updated logo URL' },
          accessCode: { type: 'string', description: 'Updated access code' },
          displayTimeZone: { type: 'string', description: 'Updated display time zone' },
        },
        required: ['profileId'],
      },
      request: {
        method: 'PATCH',
        path: '/profiles/{profileId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'profiles.delete',
      class: 'mutation',
      description: 'Delete a booking profile.',
      parameters: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID to delete' },
        },
        required: ['profileId'],
      },
      request: {
        method: 'DELETE',
        path: '/profiles/{profileId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
