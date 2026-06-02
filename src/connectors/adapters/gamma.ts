import { declarativeRestConnector } from './declarative-rest.js'

export const gammaConnector = declarativeRestConnector({
  kind: 'gamma',
  displayName: 'Gamma',
  description: 'Generate and retrieve AI-powered presentations, documents, webpages, and social media posts.',
  auth: {
    kind: 'api-key',
    hint: 'Gamma API key from your workspace settings.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.gamma.app/v1',
  test: { method: 'POST', path: '/health' },
  capabilities: [
    {
      name: 'content.generate',
      class: 'mutation',
      description: 'Generate a new Gamma (presentation, document, webpage, or social post) from text and optional configuration.',
      parameters: {
        type: 'object',
        properties: {
          inputText: { type: 'string', description: 'Text used to generate your gamma (1-750,000 characters).' },
          format: { type: 'string', description: 'The type of artifact: presentation, document, social, or webpage.' },
          numCards: { type: 'integer', description: 'Number of cards to create (default 10, Pro: 1-50, Ultra: 1-75).' },
          textMode: { type: 'string', description: 'How to modify inputText: generate, condense, or preserve.' },
          themeName: { type: 'string', description: 'Theme name to apply. Defaults to workspace default.' },
          cardSplit: { type: 'string', description: 'How content is divided into cards: inputTextBreaks or auto.' },
          additionalInstructions: { type: 'string', description: 'Extra specifications for content and layouts (1-500 characters).' },
          textOptions: { type: 'object', description: 'JSON object for text attributes (amount, tone, audience, language).' },
          imageOptions: { type: 'object', description: 'JSON object for image attributes (source, model, style).' },
          cardOptions: { type: 'object', description: 'JSON object for card attributes (dimensions, headerFooter).' },
          sharingOptions: { type: 'object', description: 'JSON object for sharing attributes (workspaceAccess, externalAccess).' },
          exportAs: { type: 'string', description: 'File format for export: pptx, pdf, or png.' },
        },
        required: ['inputText'],
      },
      request: {
        method: 'POST',
        path: '/generate',
        body: {
          inputText: '{inputText}',
          format: '{format}',
          numCards: '{numCards}',
          textMode: '{textMode}',
          themeName: '{themeName}',
          cardSplit: '{cardSplit}',
          additionalInstructions: '{additionalInstructions}',
          textOptions: '{textOptions}',
          imageOptions: '{imageOptions}',
          cardOptions: '{cardOptions}',
          sharingOptions: '{sharingOptions}',
          exportAs: '{exportAs}',
        },
      },
    },
    {
      name: 'generation.status',
      class: 'read',
      description: 'Retrieve the status and details of a generation job by ID.',
      parameters: {
        type: 'object',
        properties: {
          generationId: { type: 'string', description: 'The ID of the generation job.' },
        },
        required: ['generationId'],
      },
      request: {
        method: 'GET',
        path: '/generation/{generationId}',
      },
    },
    {
      name: 'presentation.delete',
      class: 'mutation',
      description: 'Delete a Gamma presentation by ID.',
      parameters: {
        type: 'object',
        properties: {
          gammaId: { type: 'string', description: 'The ID of the Gamma presentation to delete.' },
        },
        required: ['gammaId'],
      },
      request: {
        method: 'DELETE',
        path: '/gammas/{gammaId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'presentation.update',
      class: 'mutation',
      description: 'Update metadata for an existing Gamma presentation.',
      parameters: {
        type: 'object',
        properties: {
          gammaId: { type: 'string', description: 'The ID of the Gamma presentation to update.' },
          title: { type: 'string', description: 'New title for the presentation.' },
          folderId: { type: 'string', description: 'Folder to move the presentation into.' },
          sharingOptions: {
            type: 'object',
            description: 'JSON object for sharing attributes (workspaceAccess, externalAccess).',
          },
        },
        required: ['gammaId'],
      },
      request: {
        method: 'PATCH',
        path: '/gammas/{gammaId}',
        body: {
          title: '{title}',
          folderId: '{folderId}',
          sharingOptions: '{sharingOptions}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'folder.create',
      class: 'mutation',
      description: 'Create a folder for organizing Gamma presentations.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Folder display name.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/folders',
        body: {
          name: '{name}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
