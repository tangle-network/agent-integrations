import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Salesloft sales-engagement API — REST v2.
 *
 * Standard 3-legged OAuth2 authorization_code flow (authorize at
 * accounts.salesloft.com/oauth/authorize, token at
 * accounts.salesloft.com/oauth/token). Salesloft's default OAuth grant is
 * not scoped per-request — API access is governed by the connected user's
 * Salesloft role — so we leave `scopes` empty rather than request granular
 * scope strings the standard app would reject. Endpoints live under
 * `https://api.salesloft.com/v2` with NO `.json` extension (verified
 * against developers.salesloft.com).
 *
 * `people.create` accepts either an email address OR a phone number paired
 * with a last name; the schema marks neither hard-required because the
 * either/or constraint isn't expressible in JSON-Schema `required`, and the
 * upstream returns a precise 422 when the pair is missing.
 */
export const salesloftConnector = declarativeRestConnector({
  kind: 'salesloft',
  displayName: 'Salesloft',
  description: 'Manage Salesloft people and accounts and enroll people into cadences through the REST API v2.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.salesloft.com/oauth/authorize',
    tokenUrl: 'https://accounts.salesloft.com/oauth/token',
    scopes: [],
    clientIdEnv: 'SALESLOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SALESLOFT_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.salesloft.com/v2',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'me.get',
      class: 'read',
      description: 'Return the authenticated user and team — the cheapest grant-validity probe.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/me' },
    },
    {
      name: 'people.list',
      class: 'read',
      description: 'List people (contacts). Paginate with page/per_page.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number (1-based).' },
          per_page: { type: 'number', description: 'Records per page (max 100).' },
        },
      },
      request: { method: 'GET', path: '/people', query: { page: '{page}', per_page: '{per_page}' } },
    },
    {
      name: 'people.create',
      class: 'mutation',
      description:
        'Create a person. Provide email_address, OR phone paired with last_name. first_name/last_name optional otherwise.',
      parameters: {
        type: 'object',
        properties: {
          email_address: { type: 'string', description: 'Email address; required unless phone+last_name are provided.' },
          first_name: { type: 'string', description: "Person's first name." },
          last_name: { type: 'string', description: "Person's last name; required when phone is provided instead of email_address." },
          phone: { type: 'string', description: 'Phone number; required (with last_name) when email_address is absent.' },
        },
      },
      request: { method: 'POST', path: '/people', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'accounts.create',
      class: 'mutation',
      description: 'Create an account (company). name is required; domain must be unique on the team.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Account/company name.' },
          domain: { type: 'string', description: 'Website domain; must be unique on the team.' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/accounts', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'cadences.list',
      class: 'read',
      description: 'List cadences. Paginate with page/per_page.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number (1-based).' },
          per_page: { type: 'number', description: 'Records per page (max 100).' },
        },
      },
      request: { method: 'GET', path: '/cadences', query: { page: '{page}', per_page: '{per_page}' } },
    },
    {
      name: 'cadence_memberships.create',
      class: 'mutation',
      description: 'Add a person to a cadence. Provide person_id and cadence_id; user_id defaults to the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          person_id: { type: 'number', description: 'Id of the person to enroll (must be visible to the authenticated user).' },
          cadence_id: { type: 'number', description: 'Id of the cadence to enroll the person into.' },
          user_id: { type: 'number', description: 'Owner of the membership; defaults to the authenticated user.' },
        },
        required: ['person_id', 'cadence_id'],
      },
      request: { method: 'POST', path: '/cadence_memberships', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
