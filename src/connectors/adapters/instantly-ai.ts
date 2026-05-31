import { declarativeRestConnector } from './declarative-rest.js'

// Instantly.ai exposes the cold-email/outreach platform via a versioned REST
// API at https://api.instantly.ai/api/v2 — API keys are minted in the app
// (Settings -> Integrations) and presented as `Authorization: Bearer <key>`.
export const instantlyAiConnector = declarativeRestConnector({
  kind: 'instantly-ai',
  displayName: 'Instantly.ai',
  description:
    'Manage Instantly.ai cold-email outreach: create campaigns, build lead lists, add leads to campaigns, and search the campaign/lead corpus.',
  auth: {
    kind: 'api-key',
    hint: 'Instantly.ai API key from Settings -> Integrations. Sent as Authorization: Bearer <key>.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.instantly.ai/api/v2',
  test: { method: 'GET', path: '/campaigns', query: { limit: '1' } },
  capabilities: [
    {
      name: 'campaigns.create',
      class: 'mutation',
      description: 'Create a new outreach campaign with schedule and sending rules.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign name.' },
          campaign_schedule: {
            type: 'object',
            description: 'Sending schedule (timing windows, timezone, weekday/weekend rules).',
            properties: {
              schedules: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    timing: {
                      type: 'object',
                      properties: {
                        from: { type: 'string', description: 'Start time in 24h format (HH:MM).' },
                        to: { type: 'string', description: 'End time in 24h format (HH:MM).' },
                      },
                      required: ['from', 'to'],
                    },
                    days: {
                      type: 'object',
                      description: 'Weekday flags keyed 0 (Sun) .. 6 (Sat).',
                    },
                    timezone: { type: 'string', description: 'IANA timezone (e.g. America/New_York).' },
                  },
                  required: ['timing', 'timezone'],
                },
              },
              start_date: { type: 'string', description: 'ISO start date (YYYY-MM-DD).' },
              end_date: { type: 'string', description: 'ISO end date (YYYY-MM-DD).' },
            },
            required: ['schedules'],
          },
          pl_value: { type: 'number', description: 'Value of every positive lead.' },
          is_evergreen: { type: 'boolean' },
          email_gap: { type: 'integer', description: 'Gap between emails in minutes.' },
          random_wait_max: { type: 'integer', description: 'Maximum random wait time in minutes.' },
          text_only: { type: 'boolean' },
          daily_limit: { type: 'integer', description: 'Daily limit for sending emails.' },
          stop_on_reply: { type: 'boolean' },
          link_tracking: { type: 'boolean' },
          open_tracking: { type: 'boolean' },
          stop_on_auto_reply: { type: 'boolean' },
          daily_max_leads: { type: 'integer' },
          prioritize_new_leads: { type: 'boolean' },
          match_lead_esp: { type: 'boolean' },
          stop_for_company: { type: 'boolean' },
          insert_unsubscribe_header: { type: 'boolean' },
        },
        required: ['name', 'campaign_schedule'],
      },
      request: {
        method: 'POST',
        path: '/campaigns',
        body: {
          name: '{name}',
          campaign_schedule: '{campaign_schedule}',
          pl_value: '{pl_value}',
          is_evergreen: '{is_evergreen}',
          email_gap: '{email_gap}',
          random_wait_max: '{random_wait_max}',
          text_only: '{text_only}',
          daily_limit: '{daily_limit}',
          stop_on_reply: '{stop_on_reply}',
          link_tracking: '{link_tracking}',
          open_tracking: '{open_tracking}',
          stop_on_auto_reply: '{stop_on_auto_reply}',
          daily_max_leads: '{daily_max_leads}',
          prioritize_new_leads: '{prioritize_new_leads}',
          match_lead_esp: '{match_lead_esp}',
          stop_for_company: '{stop_for_company}',
          insert_unsubscribe_header: '{insert_unsubscribe_header}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'lead-lists.create',
      class: 'mutation',
      description: 'Create a new lead list to group prospects before assigning them to campaigns.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Lead list name.' },
          has_enrichment_task: {
            type: 'boolean',
            description: 'If true, Instantly will run enrichment on imported leads.',
          },
          owned_by: { type: 'string', description: 'Workspace member id that should own the list.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/lead-lists',
        body: {
          name: '{name}',
          has_enrichment_task: '{has_enrichment_task}',
          owned_by: '{owned_by}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.add-to-campaign',
      class: 'mutation',
      description:
        'Add a lead (by email) to a campaign, optionally skipping duplicates already enrolled.',
      parameters: {
        type: 'object',
        properties: {
          campaign: { type: 'string', description: 'Campaign id to add the lead to.' },
          email: { type: 'string', description: 'Lead email address.' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company_name: { type: 'string' },
          phone: { type: 'string' },
          website: { type: 'string' },
          personalization: { type: 'string', description: 'Custom personalization snippet.' },
          custom_variables: {
            type: 'object',
            description: 'Free-form custom variables merged into the lead record.',
          },
          skip_if_in_campaign: {
            type: 'boolean',
            description: 'Skip the lead if it already exists in the target campaign.',
          },
          skip_if_in_workspace: {
            type: 'boolean',
            description: 'Skip the lead if it already exists anywhere in the workspace.',
          },
        },
        required: ['campaign', 'email'],
      },
      request: {
        method: 'POST',
        path: '/leads',
        body: {
          campaign: '{campaign}',
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          company_name: '{company_name}',
          phone: '{phone}',
          website: '{website}',
          personalization: '{personalization}',
          custom_variables: '{custom_variables}',
          skip_if_in_campaign: '{skip_if_in_campaign}',
          skip_if_in_workspace: '{skip_if_in_workspace}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.search',
      class: 'read',
      description: 'List or search campaigns by name, status, and pagination cursor.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Substring match against campaign name.' },
          status: {
            type: 'integer',
            description: 'Campaign status filter (0=draft, 1=active, 2=paused, 3=completed, 4=running-subseq).',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          starting_after: {
            type: 'string',
            description: 'Pagination cursor: id of the last campaign on the previous page.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/campaigns',
        query: {
          search: '{search}',
          status: '{status}',
          limit: '{limit}',
          starting_after: '{starting_after}',
        },
      },
    },
    {
      name: 'leads.search',
      class: 'read',
      description: 'Search leads by campaign, list, email, or free-text query.',
      parameters: {
        type: 'object',
        properties: {
          campaign: { type: 'string', description: 'Restrict to leads in this campaign id.' },
          list_id: { type: 'string', description: 'Restrict to leads in this lead-list id.' },
          search: { type: 'string', description: 'Free-text search across lead fields.' },
          email: { type: 'string', description: 'Filter by exact email match.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          starting_after: {
            type: 'string',
            description: 'Pagination cursor: id of the last lead on the previous page.',
          },
        },
      },
      request: {
        method: 'POST',
        path: '/leads/list',
        body: {
          campaign: '{campaign}',
          list_id: '{list_id}',
          search: '{search}',
          email: '{email}',
          limit: '{limit}',
          starting_after: '{starting_after}',
        },
      },
    },
  ],
})
