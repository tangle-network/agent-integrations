import { declarativeRestConnector } from './declarative-rest.js'

export const googleGeminiConnector = declarativeRestConnector({
  kind: 'google-gemini',
  displayName: 'Google Gemini',
  description: 'Generate content, chat, create videos, and perform AI tasks with Google Gemini models.',
  auth: { kind: 'api-key', hint: 'Google Gemini API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  test: { method: 'GET', path: '/models' },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description: 'List available Gemini models.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/models', query: {} },
    },
    {
      name: 'chat.generate',
      class: 'mutation',
      description: 'Chat with Gemini and generate text responses.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: { type: 'string' },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer' },
        },
        required: ['model', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: {
          contents: [{ parts: [{ text: '{prompt}' }] }],
          generationConfig: {
            temperature: '{temperature}',
            maxOutputTokens: '{maxTokens}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'content.generate',
      class: 'mutation',
      description: 'Generate content using Gemini with advanced options.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: { type: 'string' },
          safetySettings: { type: 'object' },
        },
        required: ['model', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: {
          contents: [{ parts: [{ text: '{prompt}' }] }],
          safetySettings: '{safetySettings}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'video.generate',
      class: 'mutation',
      description: 'Generate videos using Gemini video generation models.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: { type: 'string' },
          duration: { type: 'integer' },
          aspectRatio: { type: 'string' },
        },
        required: ['model', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: {
          contents: [{ parts: [{ text: '{prompt}' }] }],
          generationConfig: {
            duration: '{duration}',
            aspectRatio: '{aspectRatio}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'image.generateFromImage',
      class: 'mutation',
      description: 'Generate content from an input image.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: { type: 'string' },
          imageData: { type: 'string' },
        },
        required: ['model', 'prompt', 'imageData'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: {
          contents: [
            {
              parts: [
                { inlineData: { mimeType: 'image/jpeg', data: '{imageData}' } },
                { text: '{prompt}' },
              ],
            },
          ],
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'search.generateWithFile',
      class: 'read',
      description: 'Generate content with file search capabilities.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          query: { type: 'string' },
          fileUri: { type: 'string' },
        },
        required: ['model', 'query', 'fileUri'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: {
          contents: [
            {
              parts: [
                { text: '{query}' },
                { fileData: { mimeType: 'application/pdf', fileUri: '{fileUri}' } },
              ],
            },
          ],
        },
      },
    },
    {
      name: 'audio.textToSpeech',
      class: 'mutation',
      description: 'Convert text to speech using Gemini.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          text: { type: 'string' },
          voice: { type: 'string' },
          languageCode: { type: 'string' },
        },
        required: ['model', 'text', 'voice'],
      },
      request: {
        method: 'POST',
        path: '/models/{model}:generateContent',
        body: {
          contents: [{ parts: [{ text: '{text}' }] }],
          generationConfig: {
            voice: '{voice}',
            languageCode: '{languageCode}',
          },
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
