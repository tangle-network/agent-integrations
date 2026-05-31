/**
 * @stable Alai connector — AI-powered presentation generation.
 *
 * Alai is a REST + API-key product (header: `Authorization: Bearer <key>`).
 * Public API base: https://api.getalai.com
 *
 * The activepieces catalog exposes five actions on the Alai surface:
 *   - generate.presentation   (write)      POST /presentations/generate
 *   - get.generation          (read)       GET  /generations/{generationId}
 *   - export.presentation     (write)      POST /presentations/{presentationId}/export
 *   - add.slide               (write)      POST /presentations/{presentationId}/slides
 *   - delete.presentation     (destructive) DELETE /presentations/{presentationId}
 *
 * Consistency model is `authoritative`: Alai is the system of record for the
 * presentations it generates, and read-after-write of a generation job returns
 * Alai's own status — our adapter does not cache derived state.
 */

import { declarativeRestConnector } from './declarative-rest.js'

export const alaiConnector = declarativeRestConnector({
  kind: 'alai',
  displayName: 'Alai',
  description:
    'Generate, export, and manage AI-produced presentations on Alai from text prompts.',
  auth: {
    kind: 'api-key',
    hint: 'Alai API key (see your Alai account settings). Sent as `Authorization: Bearer <key>`.',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.getalai.com',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'generate.presentation',
      class: 'mutation',
      description:
        'Generate a new AI presentation from input text. Returns a generation job id; poll get.generation for status.',
      parameters: {
        type: 'object',
        properties: {
          inputText: { type: 'string', description: 'Text content to generate a presentation from.' },
          title: { type: 'string', description: 'Optional title; Alai will generate one if omitted.' },
          themeId: { type: 'string', description: 'Presentation theme id.' },
          slideRange: {
            type: 'string',
            description: 'Target slide count bucket (auto | 1 | 2-5 | 6-10 | 11-15 | 16-20 | 21-25 | 26-50).',
          },
          tone: { type: 'string', description: 'Tone of voice for generated copy.' },
          contentMode: { type: 'string', description: 'How to interpret inputText (e.g. summarize vs rewrite).' },
          amountMode: { type: 'string', description: 'Text density per slide.' },
          includeAiImages: { type: 'boolean' },
          imageStyle: { type: 'string' },
          waitForCompletion: { type: 'boolean' },
          maxWaitTime: { type: 'number', description: 'Seconds; default 300 on Alai side.' },
          additionalInstructions: { type: 'string' },
        },
        required: ['inputText'],
      },
      request: {
        method: 'POST',
        path: '/presentations/generate',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'get.generation',
      class: 'read',
      description: 'Fetch status + result for a previously started generation job.',
      parameters: {
        type: 'object',
        properties: {
          generationId: { type: 'string', description: 'Id returned by generate.presentation.' },
        },
        required: ['generationId'],
      },
      request: {
        method: 'GET',
        path: '/generations/{generationId}',
      },
    },
    {
      name: 'export.presentation',
      class: 'mutation',
      description:
        'Export an existing Alai presentation to one or more file formats (pdf, pptx, …). Returns a job id + download URLs.',
      parameters: {
        type: 'object',
        properties: {
          presentationId: { type: 'string' },
          exportFormats: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of formats, e.g. ["pdf", "pptx"].',
          },
          waitForCompletion: { type: 'boolean' },
          maxWaitTime: { type: 'number' },
        },
        required: ['presentationId', 'exportFormats'],
      },
      request: {
        method: 'POST',
        path: '/presentations/{presentationId}/export',
        body: {
          exportFormats: '{exportFormats}',
          waitForCompletion: '{waitForCompletion}',
          maxWaitTime: '{maxWaitTime}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'add.slide',
      class: 'mutation',
      description: 'Insert a new slide into an existing presentation at a given position.',
      parameters: {
        type: 'object',
        properties: {
          presentationId: { type: 'string' },
          slide_context: { type: 'string', description: 'Topic/content for the new slide.' },
          slide_order: {
            type: 'string',
            description: 'Position to insert the slide (e.g. "end", or a 1-based index).',
          },
          additionalInstructions: { type: 'string' },
          includeAiImages: { type: 'boolean' },
          imageStyle: { type: 'string' },
        },
        required: ['presentationId', 'slide_context'],
      },
      request: {
        method: 'POST',
        path: '/presentations/{presentationId}/slides',
        body: {
          slide_context: '{slide_context}',
          slide_order: '{slide_order}',
          additionalInstructions: '{additionalInstructions}',
          includeAiImages: '{includeAiImages}',
          imageStyle: '{imageStyle}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'delete.presentation',
      class: 'mutation',
      description: 'Permanently delete an Alai presentation. Destructive — not reversible.',
      parameters: {
        type: 'object',
        properties: {
          presentationId: { type: 'string' },
        },
        required: ['presentationId'],
      },
      request: {
        method: 'DELETE',
        path: '/presentations/{presentationId}',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
