import { declarativeRestConnector } from './declarative-rest.js'

export const greipConnector = declarativeRestConnector({
  kind: 'greip',
  displayName: 'Greip',
  description: 'Detect and prevent fraud with Greip IP, BIN, ASN, email, phone, and profanity lookups.',
  auth: { kind: 'api-key', hint: 'Greip API token (passed via the `key` query parameter).' },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://gregeoip.com',
  credentialPlacement: { kind: 'query', parameter: 'key' },
  test: { method: 'GET', path: '/IPLookup', query: { ip: '8.8.8.8' } },
  capabilities: [
    {
      name: 'asn.lookup',
      class: 'read',
      description: 'Look up an Autonomous System Number (AS Number) and return ownership + routing metadata.',
      parameters: {
        type: 'object',
        properties: {
          asn: { type: 'string', description: 'AS Number (e.g., AS6167 or 6167).' },
          format: { type: 'string', enum: ['JSON', 'XML', 'CSV', 'Newline'] },
          mode: { type: 'string', enum: ['live', 'test'] },
          lang: { type: 'string' },
        },
        required: ['asn'],
      },
      request: {
        method: 'GET',
        path: '/ASNLookup',
        query: { asn: '{asn}', format: '{format}', mode: '{mode}', lang: '{lang}' },
      },
    },
    {
      name: 'bin.lookup',
      class: 'read',
      description: 'Look up a payment card BIN/IIN to retrieve issuer, brand, scheme, and country.',
      parameters: {
        type: 'object',
        properties: {
          bin: { type: 'string', description: 'Card BIN/IIN, minimum 6 digits.' },
          format: { type: 'string', enum: ['JSON', 'XML', 'CSV', 'Newline'] },
          mode: { type: 'string', enum: ['live', 'test'] },
          lang: { type: 'string' },
          userID: { type: 'string' },
        },
        required: ['bin'],
      },
      request: {
        method: 'GET',
        path: '/BINLookup',
        query: { bin: '{bin}', format: '{format}', mode: '{mode}', lang: '{lang}', userID: '{userID}' },
      },
    },
    {
      name: 'ip.lookup',
      class: 'read',
      description: 'Look up an IPv4 or IPv6 address for geolocation, security risk, currency, and timezone.',
      parameters: {
        type: 'object',
        properties: {
          ip: { type: 'string', description: 'IPv4 or IPv6 address to look up.' },
          params: {
            type: 'string',
            description: 'Comma-separated module list (e.g., security,currency,timezone,location).',
          },
          format: { type: 'string', enum: ['JSON', 'XML', 'CSV', 'Newline'] },
          mode: { type: 'string', enum: ['live', 'test'] },
          lang: { type: 'string' },
          userID: { type: 'string' },
        },
        required: ['ip'],
      },
      request: {
        method: 'GET',
        path: '/IPLookup',
        query: {
          ip: '{ip}',
          params: '{params}',
          format: '{format}',
          mode: '{mode}',
          lang: '{lang}',
          userID: '{userID}',
        },
      },
    },
    {
      name: 'email.validation',
      class: 'read',
      description: 'Validate an email address for syntax, deliverability, and disposable / spam signals.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to validate.' },
          format: { type: 'string', enum: ['JSON', 'XML', 'CSV', 'Newline'] },
          mode: { type: 'string', enum: ['live', 'test'] },
          userID: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/validateEmail',
        query: { email: '{email}', format: '{format}', mode: '{mode}', userID: '{userID}' },
      },
    },
    {
      name: 'phone.validation',
      class: 'read',
      description: 'Validate a phone number against its ISO country code for line type and reachability.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Phone number in international or local format.' },
          countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2 country code (e.g., US, GB).' },
          format: { type: 'string', enum: ['JSON', 'XML', 'CSV', 'Newline'] },
          mode: { type: 'string', enum: ['live', 'test'] },
          userID: { type: 'string' },
        },
        required: ['phone', 'countryCode'],
      },
      request: {
        method: 'GET',
        path: '/validatePhone',
        query: {
          phone: '{phone}',
          countryCode: '{countryCode}',
          format: '{format}',
          mode: '{mode}',
          userID: '{userID}',
        },
      },
    },
    {
      name: 'profanity.detection',
      class: 'read',
      description: 'Score arbitrary text for profanity; optionally return matched words and safety score.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to scan for profanity.' },
          scoreOnly: { type: 'string', enum: ['yes', 'no'] },
          listBadWords: { type: 'string', enum: ['yes', 'no'] },
          format: { type: 'string', enum: ['JSON', 'XML', 'CSV', 'Newline'] },
          mode: { type: 'string', enum: ['live', 'test'] },
          userID: { type: 'string' },
        },
        required: ['text'],
      },
      request: {
        method: 'GET',
        path: '/badWords',
        query: {
          text: '{text}',
          scoreOnly: '{scoreOnly}',
          listBadWords: '{listBadWords}',
          format: '{format}',
          mode: '{mode}',
          userID: '{userID}',
        },
      },
    },
  ],
})
