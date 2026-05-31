import { declarativeRestConnector } from './declarative-rest.js'

export const kallabotAiConnector = declarativeRestConnector({
  kind: 'kallabot-ai',
  displayName: 'Kallabot AI',
  description: 'AI-powered voice agents and conversational interfaces for making calls and managing campaigns.',
  auth: { kind: 'api-key', hint: 'Kallabot AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.kallabot.ai/v1',
  test: { method: 'GET', path: '/agents' },
  capabilities: [
    {
      name: 'calls.make',
      class: 'mutation',
      description: 'Make an outbound call with an AI agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          recipient_phone_number: { type: 'string' },
          sender_phone_number: { type: 'string' },
          template_variables: { type: 'object' },
          webhook_url: { type: 'string' },
        },
        required: ['agent_id', 'recipient_phone_number', 'sender_phone_number'],
      },
      request: {
        method: 'POST',
        path: '/calls/make',
        body: {
          agent_id: '{agent_id}',
          recipient_phone_number: '{recipient_phone_number}',
          sender_phone_number: '{sender_phone_number}',
          template_variables: '{template_variables}',
          webhook_url: '{webhook_url}',
        },
      },
    },
    {
      name: 'calls.details',
      class: 'read',
      description: 'Get details for a specific call.',
      parameters: {
        type: 'object',
        properties: { call_sid: { type: 'string' } },
        required: ['call_sid'],
      },
      request: { method: 'GET', path: '/calls/{call_sid}' },
    },
    {
      name: 'contacts.add_to_list',
      class: 'mutation',
      description: 'Add a contact to an existing contact list.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string' },
          contacts: { type: 'array' },
        },
        required: ['list_id', 'contacts'],
      },
      request: {
        method: 'POST',
        path: '/contact_lists/{list_id}/contacts',
        body: { contacts: '{contacts}' },
      },
    },
    {
      name: 'contacts.list_get',
      class: 'read',
      description: 'Get all contacts from a contact list.',
      parameters: {
        type: 'object',
        properties: { list_id: { type: 'string' } },
        required: ['list_id'],
      },
      request: { method: 'GET', path: '/contact_lists/{list_id}/contacts' },
    },
    {
      name: 'contact_lists.create',
      class: 'mutation',
      description: 'Create a new contact list.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' } },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/contact_lists',
        body: { name: '{name}', description: '{description}' },
      },
    },
    {
      name: 'contact_lists.edit',
      class: 'mutation',
      description: 'Edit an existing contact list.',
      parameters: {
        type: 'object',
        properties: { list_id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } },
        required: ['list_id'],
      },
      request: {
        method: 'PUT',
        path: '/contact_lists/{list_id}',
        body: { name: '{name}', description: '{description}' },
      },
    },
    {
      name: 'campaigns.create',
      class: 'mutation',
      description: 'Create a new outbound campaign.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          agent_id: { type: 'string' },
          list_id: { type: 'string' },
          sender_phone_numbers: { type: 'array' },
          scheduled_time: { type: 'string' },
          timezone: { type: 'string' },
          delay_between_calls: { type: 'integer' },
          rotate_numbers_after: { type: 'integer' },
        },
        required: ['name', 'agent_id', 'list_id', 'sender_phone_numbers', 'scheduled_time'],
      },
      request: {
        method: 'POST',
        path: '/campaigns',
        body: {
          name: '{name}',
          description: '{description}',
          agent_id: '{agent_id}',
          list_id: '{list_id}',
          sender_phone_numbers: '{sender_phone_numbers}',
          scheduled_time: '{scheduled_time}',
          timezone: '{timezone}',
          delay_between_calls: '{delay_between_calls}',
          rotate_numbers_after: '{rotate_numbers_after}',
        },
      },
    },
    {
      name: 'campaigns.delete',
      class: 'mutation',
      description: 'Delete a campaign.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          delete_contact_list: { type: 'boolean' },
        },
        required: ['campaign_id'],
      },
      request: {
        method: 'DELETE',
        path: '/campaigns/{campaign_id}',
        query: { delete_contact_list: '{delete_contact_list}' },
      },
    },
  ],
})
