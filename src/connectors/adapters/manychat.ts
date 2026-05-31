import { declarativeRestConnector } from './declarative-rest.js'

export const manychatConnector = declarativeRestConnector({
  kind: 'manychat',
  displayName: 'Manychat',
  description: 'Automations for Instagram, WhatsApp, TikTok, and Messenger marketing.',
  auth: { kind: 'api-key', hint: 'Manychat API key (Settings → API).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.manychat.com',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/fb/page/getInfo' },
  capabilities: [
    {
      name: 'subscribers.find.by.custom.field',
      class: 'read',
      description: 'Find a subscriber by the value of a custom field.',
      parameters: {
        type: 'object',
        properties: {
          field_id: { type: 'string' },
          field_value: { type: 'string' },
        },
        required: ['field_id', 'field_value'],
      },
      request: {
        method: 'GET',
        path: '/fb/subscriber/findByCustomField',
        query: {
          field_id: '{field_id}',
          field_value: '{field_value}',
        },
      },
    },
    {
      name: 'subscribers.find.by.name',
      class: 'read',
      description: 'Find a subscriber by name.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: {
        method: 'GET',
        path: '/fb/subscriber/findByName',
        query: { name: '{name}' },
      },
    },
    {
      name: 'subscribers.create',
      class: 'mutation',
      description: 'Create a Manychat subscriber.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          phone: { type: 'string' },
          whatsapp_phone: { type: 'string' },
          email: { type: 'string' },
          gender: { type: 'string' },
          has_opt_in_sms: { type: 'boolean' },
          has_opt_in_email: { type: 'boolean' },
          consent_phrase: { type: 'string' },
        },
        required: ['first_name'],
      },
      request: {
        method: 'POST',
        path: '/fb/subscriber/createSubscriber',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.send.content',
      class: 'mutation',
      description: 'Send content (text or media) to a subscriber across a Manychat-supported platform.',
      parameters: {
        type: 'object',
        properties: {
          subscriber_id: { type: 'string' },
          platform: { type: 'string' },
          content_type: { type: 'string' },
          text_content: { type: 'string' },
          media_url: { type: 'string' },
          message_tag: { type: 'string' },
        },
        required: ['subscriber_id', 'content_type'],
      },
      request: {
        method: 'POST',
        path: '/fb/sending/sendContent',
        body: 'args',
      },
      externalEffect: true,
    },
    {
      name: 'subscribers.custom_field.set',
      class: 'mutation',
      description: "Set the value of a subscriber's custom field.",
      parameters: {
        type: 'object',
        properties: {
          subscriber_id: { type: 'string' },
          field_id: { type: 'string' },
          field_value: {},
        },
        required: ['subscriber_id', 'field_id', 'field_value'],
      },
      request: {
        method: 'POST',
        path: '/fb/subscriber/setCustomField',
        body: 'args',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscribers.tag.add',
      class: 'mutation',
      description: 'Add a tag to a subscriber.',
      parameters: {
        type: 'object',
        properties: {
          subscriber_id: { type: 'string' },
          tag_name: { type: 'string' },
        },
        required: ['subscriber_id', 'tag_name'],
      },
      request: {
        method: 'POST',
        path: '/fb/subscriber/addTag',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.tag.remove',
      class: 'mutation',
      description: 'Remove a tag from a subscriber.',
      parameters: {
        type: 'object',
        properties: {
          subscriber_id: { type: 'string' },
          tag_name: { type: 'string' },
        },
        required: ['subscriber_id', 'tag_name'],
      },
      request: {
        method: 'POST',
        path: '/fb/subscriber/removeTag',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
  ],
})
