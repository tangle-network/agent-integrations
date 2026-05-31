import { declarativeRestConnector } from './declarative-rest.js'

// Klenty is a sales engagement platform. The activepieces piece
// (@activepieces/piece-klenty) wraps four prospect-management endpoints, all
// scoped under /user/{username}/. Authentication is an account API key passed
// in the x-api-key header; the username (an email address) is embedded in the
// URL path. See the activepieces source for endpoint shapes.
export const klentyConnector = declarativeRestConnector({
  kind: 'klenty',
  displayName: 'Klenty',
  description:
    'Sales engagement platform for managing prospects and adding them to outreach cadences.',
  auth: {
    kind: 'api-key',
    hint: 'Klenty API key from Settings → API. Sent as the x-api-key header. The Klenty username/email is supplied per-call as the user path segment.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://app.klenty.com/apis/v1',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: {
    accept: 'application/json',
    'content-type': 'application/json',
  },
  capabilities: [
    {
      name: 'prospect.get',
      class: 'read',
      description: 'Look up a prospect in Klenty by email address.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'Klenty username/email used in the API URL path (e.g. you@company.com).',
          },
          email: {
            type: 'string',
            description: 'Prospect email address to look up.',
          },
        },
        required: ['username', 'email'],
      },
      request: {
        method: 'GET',
        path: '/user/{username}/prospects',
        query: { email: '{email}' },
      },
    },
    {
      name: 'prospect.create',
      class: 'mutation',
      description:
        'Create a new prospect in Klenty. Requires email and first name; additional fields (last name, company, title, phone, location, custom fields) may be supplied.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'Klenty username/email used in the API URL path.',
          },
          email: { type: 'string', description: 'Prospect email address.' },
          firstName: { type: 'string', description: 'Prospect first name.' },
          lastName: { type: 'string' },
          middleName: { type: 'string' },
          fullName: { type: 'string' },
          company: { type: 'string' },
          companyDomain: { type: 'string' },
          title: { type: 'string' },
          phone: { type: 'string' },
          mobilePhone: { type: 'string' },
          location: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
          linkedinURL: { type: 'string' },
          twitterId: { type: 'string' },
          website: { type: 'string' },
          industry: { type: 'string' },
          customFields: {
            type: 'object',
            description: 'Custom prospect fields keyed by field name.',
          },
        },
        required: ['username', 'email', 'firstName'],
      },
      request: {
        method: 'POST',
        path: '/user/{username}/prospects',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          middleName: '{middleName}',
          fullName: '{fullName}',
          company: '{company}',
          companyDomain: '{companyDomain}',
          title: '{title}',
          phone: '{phone}',
          mobilePhone: '{mobilePhone}',
          location: '{location}',
          city: '{city}',
          state: '{state}',
          country: '{country}',
          linkedinURL: '{linkedinURL}',
          twitterId: '{twitterId}',
          website: '{website}',
          industry: '{industry}',
          customFields: '{customFields}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'prospect.update',
      class: 'mutation',
      description:
        'Update an existing prospect in Klenty, identified by their current email address. Supply only the fields to change.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'Klenty username/email used in the API URL path.',
          },
          currentEmail: {
            type: 'string',
            description: 'The current email used to identify the prospect in Klenty.',
          },
          email: {
            type: 'string',
            description: 'New email address (omit to keep the existing one).',
          },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          middleName: { type: 'string' },
          fullName: { type: 'string' },
          company: { type: 'string' },
          companyDomain: { type: 'string' },
          title: { type: 'string' },
          phone: { type: 'string' },
          mobilePhone: { type: 'string' },
          location: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
          linkedinURL: { type: 'string' },
          twitterId: { type: 'string' },
          website: { type: 'string' },
          industry: { type: 'string' },
          customFields: {
            type: 'object',
            description: 'Custom prospect fields keyed by field name.',
          },
        },
        required: ['username', 'currentEmail'],
      },
      request: {
        method: 'PATCH',
        path: '/user/{username}/prospects/{currentEmail}',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          middleName: '{middleName}',
          fullName: '{fullName}',
          company: '{company}',
          companyDomain: '{companyDomain}',
          title: '{title}',
          phone: '{phone}',
          mobilePhone: '{mobilePhone}',
          location: '{location}',
          city: '{city}',
          state: '{state}',
          country: '{country}',
          linkedinURL: '{linkedinURL}',
          twitterId: '{twitterId}',
          website: '{website}',
          industry: '{industry}',
          customFields: '{customFields}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'prospect.add.to.campaign',
      class: 'mutation',
      description:
        'Add an existing prospect to a Klenty cadence (campaign), starting the sequence for that prospect.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'Klenty username/email used in the API URL path.',
          },
          email: {
            type: 'string',
            description: 'Email of the prospect to add to the cadence.',
          },
          cadenceName: {
            type: 'string',
            description: 'Name of the cadence (campaign) to add the prospect to.',
          },
        },
        required: ['username', 'email', 'cadenceName'],
      },
      request: {
        method: 'POST',
        path: '/user/{username}/startCadence',
        body: {
          email: '{email}',
          cadenceName: '{cadenceName}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
