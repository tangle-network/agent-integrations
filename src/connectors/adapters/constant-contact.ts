import { declarativeRestConnector } from './declarative-rest.js'

// Constant Contact V3 (`api.cc.email/v3`) is a contact-and-list email
// marketing API. The activepieces piece exposes a single
// `createOrUpdateContact` action backed by Constant Contact's documented
// "sign_up_form" upsert endpoint, which dedupes on email address and
// (re)subscribes the contact to the supplied list ids in one call. We
// surface that as `contacts.upsert` and round it out with the adjacent
// list/contact reads + writes that ship alongside it in the same V3
// surface, so the adapter is useful as a CRM connector and not just a
// thin wrapper around the single upstream action.
export const constantContactConnector = declarativeRestConnector({
  kind: 'constant-contact',
  displayName: 'Constant Contact',
  description: 'Upsert Constant Contact contacts and manage subscriber lists via the V3 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://authz.constantcontact.com/oauth2/default/v1/authorize',
    tokenUrl: 'https://authz.constantcontact.com/oauth2/default/v1/token',
    scopes: ['contact_data', 'campaign_data', 'offline_access'],
    clientIdEnv: 'CONSTANT_CONTACT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CONSTANT_CONTACT_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cc.email/v3',
  test: { method: 'GET', path: '/account/summary' },
  capabilities: [
    {
      name: 'contacts.upsert',
      class: 'mutation',
      description:
        'Create a contact or update an existing one by email address, subscribing it to the supplied list ids. Mirrors the activepieces `createOrUpdateContact` action.',
      parameters: {
        type: 'object',
        properties: {
          email_address: { type: 'string', description: 'Email address used as the dedupe key.' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          job_title: { type: 'string' },
          company_name: { type: 'string' },
          phone_number: { type: 'string' },
          birthday_month: { type: 'integer', minimum: 1, maximum: 12 },
          birthday_day: { type: 'integer', minimum: 1, maximum: 31 },
          anniversary: { type: 'string', description: 'ISO-8601 date.' },
          list_memberships: {
            type: 'array',
            items: { type: 'string' },
            description: 'List ids the contact should be added to.',
          },
          custom_fields: {
            type: 'array',
            items: { type: 'object' },
            description: 'Custom field id / value pairs.',
          },
          street_addresses: { type: 'array', items: { type: 'object' } },
        },
        required: ['email_address', 'list_memberships'],
      },
      request: {
        method: 'POST',
        path: '/contacts/sign_up_form',
        body: {
          email_address: '{email_address}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          job_title: '{job_title}',
          company_name: '{company_name}',
          phone_number: '{phone_number}',
          birthday_month: '{birthday_month}',
          birthday_day: '{birthday_day}',
          anniversary: '{anniversary}',
          list_memberships: '{list_memberships}',
          custom_fields: '{custom_fields}',
          street_addresses: '{street_addresses}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['contact_data'],
    },
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Page through contacts, optionally filtered by email, status, or list id.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          status: { type: 'string', enum: ['all', 'active', 'unsubscribed', 'deleted'] },
          lists: { type: 'string', description: 'Comma-separated list ids.' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: {
          email: '{email}',
          status: '{status}',
          lists: '{lists}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['contact_data'],
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read a single contact by its V3 contact id.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          include: { type: 'string', description: 'Comma-separated sub-resources (e.g. "custom_fields,list_memberships").' },
        },
        required: ['contact_id'],
      },
      request: {
        method: 'GET',
        path: '/contacts/{contact_id}',
        query: { include: '{include}' },
      },
      requiredScopes: ['contact_data'],
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Replace a contact by id (PUT semantics — supply the full resource).',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          email_address: { type: 'object' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          job_title: { type: 'string' },
          company_name: { type: 'string' },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          list_memberships: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'array', items: { type: 'object' } },
          update_source: { type: 'string', enum: ['Account', 'Contact'] },
        },
        required: ['contact_id', 'email_address', 'update_source'],
      },
      request: {
        method: 'PUT',
        path: '/contacts/{contact_id}',
        body: {
          email_address: '{email_address}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          job_title: '{job_title}',
          company_name: '{company_name}',
          phone_numbers: '{phone_numbers}',
          list_memberships: '{list_memberships}',
          custom_fields: '{custom_fields}',
          update_source: '{update_source}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['contact_data'],
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Soft-delete a contact (status becomes "deleted").',
      parameters: {
        type: 'object',
        properties: { contact_id: { type: 'string' } },
        required: ['contact_id'],
      },
      request: { method: 'DELETE', path: '/contacts/{contact_id}' },
      cas: 'native-idempotency',
      requiredScopes: ['contact_data'],
    },
    {
      name: 'lists.search',
      class: 'read',
      description: 'Page through contact lists in the account.',
      parameters: {
        type: 'object',
        properties: {
          include_count: { type: 'boolean' },
          include_membership_count: { type: 'string', enum: ['all', 'active'] },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
      request: {
        method: 'GET',
        path: '/contact_lists',
        query: {
          include_count: '{include_count}',
          include_membership_count: '{include_membership_count}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['contact_data'],
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Read a single contact list by id.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string' },
          include_membership_count: { type: 'string', enum: ['all', 'active'] },
        },
        required: ['list_id'],
      },
      request: {
        method: 'GET',
        path: '/contact_lists/{list_id}',
        query: { include_membership_count: '{include_membership_count}' },
      },
      requiredScopes: ['contact_data'],
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a contact list.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          favorite: { type: 'boolean' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/contact_lists',
        body: { name: '{name}', description: '{description}', favorite: '{favorite}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['contact_data'],
    },
    {
      name: 'contact.create',
      class: 'mutation',
      description:
        'Create a new V3 contact with no upsert semantics. Use contacts.upsert when you want email-address dedupe + list-subscribe in one call; use this when you already know the contact does not exist.',
      parameters: {
        type: 'object',
        properties: {
          email_address: {
            type: 'object',
            description: 'V3 email envelope, e.g. { address, permission_to_send }.',
          },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          job_title: { type: 'string' },
          company_name: { type: 'string' },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          list_memberships: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'array', items: { type: 'object' } },
          create_source: { type: 'string', enum: ['Account', 'Contact'] },
        },
        required: ['email_address', 'create_source'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email_address: '{email_address}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          job_title: '{job_title}',
          company_name: '{company_name}',
          phone_numbers: '{phone_numbers}',
          list_memberships: '{list_memberships}',
          custom_fields: '{custom_fields}',
          create_source: '{create_source}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['contact_data'],
    },
    {
      name: 'campaign.create',
      class: 'mutation',
      description:
        'Create a Constant Contact email campaign. Caller assembles the V3 /emails envelope (name, type, scheduled_date, email_campaign_activities, etc.) and passes it as campaign; the adapter forwards it unchanged.',
      parameters: {
        type: 'object',
        properties: {
          campaign: {
            type: 'object',
            description: 'Full V3 /emails campaign-create envelope.',
          },
        },
        required: ['campaign'],
      },
      request: {
        method: 'POST',
        path: '/emails',
        body: '{campaign}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['campaign_data'],
    },
    {
      name: 'campaign.send',
      class: 'mutation',
      description:
        'Schedule (send) a drafted Constant Contact email campaign activity. POSTs to /emails/activities/{campaign_activity_id}/schedules with a scheduled_date — passing an immediate date (or "0") sends now per the V3 API.',
      parameters: {
        type: 'object',
        properties: {
          campaign_activity_id: {
            type: 'string',
            description: 'Campaign activity id from the /emails envelope.',
          },
          scheduled_date: {
            type: 'string',
            description:
              'ISO-8601 timestamp to send at, or "0" to send immediately per the V3 API.',
          },
        },
        required: ['campaign_activity_id', 'scheduled_date'],
      },
      request: {
        method: 'POST',
        path: '/emails/activities/{campaign_activity_id}/schedules',
        body: { scheduled_date: '{scheduled_date}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['campaign_data'],
    },
  ],
})
