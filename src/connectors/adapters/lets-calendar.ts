import { declarativeRestConnector } from './declarative-rest.js'

// LetsCalendar.com is a scheduling and CRM tool whose public API exposes
// campaign-driven contact management. The activepieces piece
// (@activepieces/piece-lets-calendar) authenticates with a client_key /
// secret_key pair and adds contacts to a campaign by id. We model the
// adapter as a single declarative-REST action plus a read-side capability
// for fetching a campaign by id, so callers can verify a campaign exists
// before they push contacts at it.
export const letsCalendarConnector = declarativeRestConnector({
  kind: 'lets-calendar',
  displayName: 'LetsCalendar',
  description:
    'Push contacts into LetsCalendar campaigns and read campaign metadata for scheduling and outreach flows.',
  auth: {
    kind: 'api-key',
    hint: 'LetsCalendar client_key and secret_key issued from the workspace API settings. The connector sends them as HTTP Basic credentials on every request.',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.letscalendar.com',
  test: { method: 'GET', path: '/v1/me' },
  capabilities: [
    {
      name: 'contacts.add.to.campaign',
      class: 'mutation',
      description:
        'Add a contact to a LetsCalendar campaign. Mirrors the activepieces add.contact.to.campaign action — campaign_id selects the campaign, the remaining fields populate the contact record.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: {
            type: 'string',
            description: 'The unique identifier of the campaign to add the contact to.',
          },
          firstname: {
            type: 'string',
            description: 'First name of the contact (max 150 characters).',
            maxLength: 150,
          },
          lastname: {
            type: 'string',
            description: 'Last name of the contact (max 150 characters).',
            maxLength: 150,
          },
          email: {
            type: 'string',
            description: 'A valid email address for the contact (max 150 characters).',
            maxLength: 150,
            format: 'email',
          },
          loginurl: {
            type: 'string',
            description: 'Login URL to send to the contact for the campaign portal.',
          },
          username: {
            type: 'string',
            description: 'Username to associate with the contact in the campaign portal.',
          },
          password: {
            type: 'string',
            description: 'Password to associate with the contact in the campaign portal.',
          },
        },
        required: ['campaign_id', 'firstname', 'email'],
      },
      request: {
        method: 'POST',
        path: '/v1/campaigns/{campaign_id}/contacts',
        body: {
          firstname: '{firstname}',
          lastname: '{lastname}',
          email: '{email}',
          loginurl: '{loginurl}',
          username: '{username}',
          password: '{password}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.get',
      class: 'read',
      description:
        'Read a LetsCalendar campaign by id. Useful as a precheck before pushing contacts, and as the read pair to the new.campaign trigger.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: {
            type: 'string',
            description: 'The unique identifier of the campaign to read.',
          },
        },
        required: ['campaign_id'],
      },
      request: { method: 'GET', path: '/v1/campaigns/{campaign_id}' },
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List campaigns in the workspace. Backs the new.campaign trigger.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Max campaigns to return.',
          },
          cursor: {
            type: 'string',
            description: 'Opaque pagination cursor returned by a previous page.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/campaigns',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
  ],
})
