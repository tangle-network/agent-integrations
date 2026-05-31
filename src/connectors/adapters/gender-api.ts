import { declarativeRestConnector } from './declarative-rest.js'

export const genderApiConnector = declarativeRestConnector({
  kind: 'gender-api',
  displayName: 'Gender API',
  description: 'Predict the gender of a person based on their name using Gender-api service.',
  auth: {
    kind: 'api-key',
    hint: 'Gender API key from https://gender-api.com. Store the API key in the auth config.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.genderapi.io',
  test: { method: 'GET', path: '/get', query: { key: '{apiKey}', name: 'test' } },
  capabilities: [
    {
      name: 'gender.get.by.first.name',
      class: 'read',
      description: 'Get gender prediction by first name.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'The first name to query' },
          countryCode: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code to improve accuracy (e.g. US, GB, DE)',
          },
          locale: { type: 'string', description: 'Browser locale for localization (e.g. en, de, fr)' },
        },
        required: ['firstName'],
      },
      request: {
        method: 'GET',
        path: '/get',
        query: { name: '{firstName}', country: '{countryCode}', locale: '{locale}', key: '{apiKey}' },
      },
    },
    {
      name: 'gender.get.by.full.name',
      class: 'read',
      description: 'Get gender prediction by full name (first and last name).',
      parameters: {
        type: 'object',
        properties: {
          fullName: { type: 'string', description: 'The full name (first and last name) to query' },
          countryCode: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code to improve accuracy (e.g. US, GB, DE)',
          },
          locale: { type: 'string', description: 'Browser locale for localization (e.g. en, de, fr)' },
        },
        required: ['fullName'],
      },
      request: {
        method: 'GET',
        path: '/get',
        query: { name: '{fullName}', country: '{countryCode}', locale: '{locale}', key: '{apiKey}' },
      },
    },
    {
      name: 'statistics.get',
      class: 'read',
      description: 'Get statistics about account usage.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: {
        method: 'GET',
        path: '/stats',
        query: { key: '{apiKey}' },
      },
    },
  ],
})
