import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Dialpad AI cloud-calling / contact-center API — v2.
 *
 * Standard 3-legged OAuth2 authorization_code flow (authorize at
 * dialpad.com/oauth2/authorize, token at dialpad.com/oauth2/token). The
 * access token is sent as a Bearer token. Dialpad scopes are pre-approved
 * per OAuth app and passed per-request. Of the REST endpoints here only
 * Call--List/Get require a documented scope (`calls:list`); contacts, users,
 * and sms-send are reachable with base bearer access (no extra scope). We
 * therefore request just `calls:list` plus `offline_access` (refresh tokens).
 * The `message_content_export` / `recordings_export` scopes are deliberately
 * NOT requested — they gate webhook event-payload enrichment (SMS body in SMS
 * events; recording URLs in call events), not these REST calls, and this
 * connector subscribes to no webhooks.
 *
 * Note the calls endpoints are singular (`/call`, `/call/{id}`) while
 * users/contacts/sms are their own top-level resources.
 */
export const dialpadConnector = declarativeRestConnector({
  kind: 'dialpad',
  displayName: 'Dialpad',
  description: 'Read Dialpad contacts, calls, and users, create contacts, and send SMS through the v2 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://dialpad.com/oauth2/authorize',
    tokenUrl: 'https://dialpad.com/oauth2/token',
    scopes: ['calls:list', 'offline_access'],
    clientIdEnv: 'DIALPAD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DIALPAD_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://dialpad.com/api/v2',
  test: { method: 'GET', path: '/users' },
  capabilities: [
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List contacts. Set include_local + owner_id to include a user\'s local contacts; paginate with cursor.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Pagination token from a previous response.' },
          include_local: { type: 'boolean', description: 'Include company local contacts (default false).' },
          owner_id: { type: 'string', description: 'User id whose local contacts should be retrieved.' },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: { cursor: '{cursor}', include_local: '{include_local}', owner_id: '{owner_id}' },
      },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a contact. first_name and last_name are required. Omit owner_id for a shared company contact.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: "Contact's first name." },
          last_name: { type: 'string', description: "Contact's last name." },
          company_name: { type: 'string', description: "Contact's company name." },
          job_title: { type: 'string', description: "Contact's job title." },
          emails: { type: 'array', description: 'Email strings; primary first.', items: { type: 'string' } },
          phones: { type: 'array', description: 'E.164-formatted phone strings; primary first.', items: { type: 'string' } },
          owner_id: { type: 'string', description: "User id to create a local contact for; omit for a shared company contact." },
        },
        required: ['first_name', 'last_name'],
      },
      request: { method: 'POST', path: '/contacts', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.list',
      class: 'read',
      description: 'List calls. Filter by started_after/started_before (UTC ms) and target; paginate with cursor.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Pagination token from a previous response.' },
          started_after: { type: 'number', description: 'UTC millisecond timestamp; calls started after this time.' },
          started_before: { type: 'number', description: 'UTC millisecond timestamp; calls started before this time.' },
          target_id: { type: 'number', description: 'Filter calls by target entity id.' },
          target_type: { type: 'string', description: 'Target type: callcenter, callrouter, channel, coaching, team, department, office, user, etc.' },
          include_anonymized: { type: 'boolean', description: 'Include anonymized call records (default false).' },
        },
      },
      request: {
        method: 'GET',
        path: '/call',
        query: {
          cursor: '{cursor}',
          started_after: '{started_after}',
          started_before: '{started_before}',
          target_id: '{target_id}',
          target_type: '{target_type}',
          include_anonymized: '{include_anonymized}',
        },
      },
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Get a single call by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: "The call's unique identifier (int64)." } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/call/{id}' },
    },
    {
      name: 'sms.send',
      class: 'mutation',
      description:
        'Send an SMS/MMS. to_numbers = up to 10 E.164 destinations, text = body. Provide one sender: user_id, from_number, or sender_group_id(+type).',
      parameters: {
        type: 'object',
        properties: {
          to_numbers: { type: 'array', description: 'Up to 10 E.164-formatted destination numbers.', items: { type: 'string' } },
          text: { type: 'string', description: 'Message body text.' },
          user_id: { type: 'number', description: "Sender's Dialpad user id." },
          from_number: { type: 'string', description: "Sender's phone number; overrides user_id/sender_group_id." },
          sender_group_id: { type: 'number', description: 'Office, department, or call-center id to send from.' },
          sender_group_type: { type: 'string', enum: ['callcenter', 'department', 'office'], description: 'Sender group type.' },
          media: { type: 'string', description: 'Base64-encoded media attachment (max 500 KiB); triggers MMS.' },
          infer_country_code: { type: 'boolean', description: 'Relax strict E.164 requirement (default false).' },
        },
        required: ['to_numbers', 'text'],
      },
      request: { method: 'POST', path: '/sms', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List users. Filter by email/name/state; paginate with cursor.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Pagination token from a previous response.' },
          email: { type: 'string', description: "Filter by user's email address." },
          first_name: { type: 'string', description: 'Filter by first-name prefix.' },
          last_name: { type: 'string', description: 'Filter by last-name prefix.' },
          state: { type: 'string', description: 'Filter by state: active, all, cancelled, deleted, pending, suspended.' },
          company_admin: { type: 'boolean', description: 'Return only company admins (true) or non-admins (false).' },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: {
          cursor: '{cursor}',
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          state: '{state}',
          company_admin: '{company_admin}',
        },
      },
    },
  ],
})
