import { declarativeRestConnector } from './declarative-rest.js'

export const blandAiConnector = declarativeRestConnector({
  kind: 'bland-ai',
  displayName: 'Bland AI',
  description: 'AI phone calling platform for outbound and conversational voice workflows.',
  auth: { kind: 'api-key', hint: 'Bland AI API key, sent in the Authorization header.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bland.ai',
  test: { method: 'GET', path: '/v1/calls', query: { limit: '1' } },
  capabilities: [
    {
      name: 'calls.send',
      class: 'mutation',
      description:
        'Place an outbound AI phone call. Either a Task or a Pathway ID must be supplied; Pathway overrides Task when both are present.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: {
            type: 'string',
            description:
              'Destination phone number in E.164 format (e.g. +12223334444), country code required.',
          },
          task: {
            type: 'string',
            description:
              'Instructions for the AI agent — what it should say, ask, or accomplish during the call.',
          },
          pathwayId: {
            type: 'string',
            description:
              'UUID of a pre-built Pathway from the Bland AI dashboard. Overrides task when present.',
          },
          fromNumber: { type: 'string', description: 'Optional origin phone number.' },
          firstSentence: {
            type: 'string',
            description: 'Exact opening line the agent will say when the call is answered.',
          },
          voice: { type: 'string', description: 'Bland AI preset voice identifier.' },
          model: { type: 'string', description: 'Bland AI model identifier.' },
          language: {
            type: 'string',
            description: 'Language code for transcription and speech (e.g. en, es).',
          },
          maxDuration: {
            type: 'integer',
            description:
              'Maximum call length in minutes; the call ends automatically after this time. Defaults to 30.',
          },
          waitForGreeting: {
            type: 'boolean',
            description:
              'When true, the AI waits for the recipient to speak first before responding.',
          },
          record: {
            type: 'boolean',
            description:
              'When true, the call is recorded; the recording URL is included in the post-call data.',
          },
          transferPhoneNumber: {
            type: 'string',
            description: 'E.164 phone number to transfer the call to when the AI hands off.',
          },
          webhook: {
            type: 'string',
            description:
              'URL that receives a POST request with full call data after the call ends.',
          },
          summaryPrompt: {
            type: 'string',
            description:
              'Custom instructions for the post-call summary (max 2000 characters).',
          },
        },
        required: ['phoneNumber'],
      },
      request: {
        method: 'POST',
        path: '/v1/calls',
        body: {
          phone_number: '{phoneNumber}',
          task: '{task}',
          pathway_id: '{pathwayId}',
          from: '{fromNumber}',
          first_sentence: '{firstSentence}',
          voice: '{voice}',
          model: '{model}',
          language: '{language}',
          max_duration: '{maxDuration}',
          wait_for_greeting: '{waitForGreeting}',
          record: '{record}',
          transfer_phone_number: '{transferPhoneNumber}',
          webhook: '{webhook}',
          summary_prompt: '{summaryPrompt}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Fetch the full record for a single call by its Bland AI call ID.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The Bland AI call identifier.' },
        },
        required: ['callId'],
      },
      request: { method: 'GET', path: '/v1/calls/{callId}' },
    },
    {
      name: 'calls.list',
      class: 'read',
      description: 'List recent calls, optionally filtered by origin or destination number.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of calls to return.',
          },
          fromNumber: {
            type: 'string',
            description: 'Filter by origin phone number.',
          },
          toNumber: {
            type: 'string',
            description: 'Filter by destination phone number.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/calls',
        query: {
          limit: '{limit}',
          from_number: '{fromNumber}',
          to_number: '{toNumber}',
        },
      },
    },
  ],
})
