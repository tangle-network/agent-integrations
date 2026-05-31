import { declarativeRestConnector } from './declarative-rest.js'

export const plausibleConnector = declarativeRestConnector({
  kind: 'plausible',
  displayName: 'Plausible Analytics',
  description: 'List sites, create goals, manage shared links, and configure custom properties in Plausible Analytics.',
  auth: { kind: 'api-key', hint: 'Plausible Analytics API key from account settings.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://plausible.io/api/v1',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'teams.list',
      class: 'read',
      description: 'List all teams accessible to the API key.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/teams' },
    },
    {
      name: 'sites.list',
      class: 'read',
      description: 'List all sites in your Plausible account.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/sites' },
    },
    {
      name: 'sites.get',
      class: 'read',
      description: 'Retrieve details of a specific site.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
      request: { method: 'GET', path: '/sites/{domain}' },
    },
    {
      name: 'sites.create',
      class: 'mutation',
      description: 'Create a new site in Plausible Analytics.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          timezone: { type: 'string' },
        },
        required: ['domain'],
      },
      request: {
        method: 'POST',
        path: '/sites',
        body: { domain: '{domain}', timezone: '{timezone}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sites.update',
      class: 'mutation',
      description: 'Update site settings like domain or timezone.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          new_domain: { type: 'string' },
          timezone: { type: 'string' },
          track_404_pages: { type: 'boolean' },
          hash_based_routing: { type: 'boolean' },
          outbound_links: { type: 'boolean' },
          file_downloads: { type: 'boolean' },
          form_submissions: { type: 'boolean' },
        },
        required: ['domain'],
      },
      request: {
        method: 'PUT',
        path: '/sites/{domain}',
        body: {
          new_domain: '{new_domain}',
          timezone: '{timezone}',
          track_404_pages: '{track_404_pages}',
          hash_based_routing: '{hash_based_routing}',
          outbound_links: '{outbound_links}',
          file_downloads: '{file_downloads}',
          form_submissions: '{form_submissions}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'sites.delete',
      class: 'mutation',
      description: 'Delete a site from Plausible Analytics.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
      request: { method: 'DELETE', path: '/sites/{domain}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'goals.list',
      class: 'read',
      description: 'List all goals configured for a site.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
      request: { method: 'GET', path: '/sites/{domain}/goals' },
    },
    {
      name: 'goals.create',
      class: 'mutation',
      description: 'Create a new goal (event, page view, or custom).',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          goal_type: { type: 'string' },
          event_name: { type: 'string' },
          page_path: { type: 'string' },
          display_name: { type: 'string' },
        },
        required: ['domain', 'goal_type'],
      },
      request: {
        method: 'POST',
        path: '/sites/{domain}/goals',
        body: {
          goal_type: '{goal_type}',
          event_name: '{event_name}',
          page_path: '{page_path}',
          display_name: '{display_name}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'goals.delete',
      class: 'mutation',
      description: 'Delete a goal from a site.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          goal_id: { type: 'string' },
        },
        required: ['domain', 'goal_id'],
      },
      request: { method: 'DELETE', path: '/sites/{domain}/goals/{goal_id}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'custom_properties.list',
      class: 'read',
      description: 'List all custom properties configured for a site.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
      request: { method: 'GET', path: '/sites/{domain}/custom-props' },
    },
    {
      name: 'custom_properties.create',
      class: 'mutation',
      description: 'Create a new custom property for a site.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          property: { type: 'string' },
        },
        required: ['domain', 'property'],
      },
      request: {
        method: 'POST',
        path: '/sites/{domain}/custom-props',
        body: { property: '{property}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'custom_properties.delete',
      class: 'mutation',
      description: 'Delete a custom property from a site.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          property: { type: 'string' },
        },
        required: ['domain', 'property'],
      },
      request: { method: 'DELETE', path: '/sites/{domain}/custom-props/{property}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'shared_links.create',
      class: 'mutation',
      description: 'Create a shared dashboard link for a site.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['domain', 'name'],
      },
      request: {
        method: 'POST',
        path: '/sites/{domain}/shared-links',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'guests.list',
      class: 'read',
      description: 'List all guest invitations for a site.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string' } },
        required: ['domain'],
      },
      request: { method: 'GET', path: '/sites/{domain}/invitations' },
    },
    {
      name: 'guests.invite',
      class: 'mutation',
      description: 'Invite a guest user to access a site.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string' },
        },
        required: ['domain', 'email', 'role'],
      },
      request: {
        method: 'POST',
        path: '/sites/{domain}/invitations',
        body: { email: '{email}', role: '{role}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'guests.remove',
      class: 'mutation',
      description: 'Remove a guest user from a site.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['domain', 'email'],
      },
      request: { method: 'DELETE', path: '/sites/{domain}/invitations/{email}' },
      cas: 'optimistic-read-verify',
    },
  ],
})
