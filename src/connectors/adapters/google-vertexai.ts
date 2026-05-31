import { declarativeRestConnector } from './declarative-rest.js'

export const googleVertexaiConnector = declarativeRestConnector({
  kind: 'google-vertexai',
  displayName: 'Google Vertex AI',
  description: 'Generate content and images using Gemini and Imagen models on Google Vertex AI.',
  auth: { kind: 'api-key', hint: 'Google Cloud API key with Vertex AI permissions.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://{location}-aiplatform.googleapis.com/v1/projects/{projectId}/locations/{location}',
  test: { method: 'GET', path: '/models' },
  capabilities: [
    {
      name: 'content.generate',
      class: 'read',
      description: 'Generate content using Gemini model.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          userMessage: { type: 'string' },
          systemMessage: { type: 'string' },
          temperature: { type: 'number' },
          maxOutputTokens: { type: 'integer' },
          thinkingLevel: { type: 'string' },
        },
        required: ['model', 'userMessage'],
      },
      request: {
        method: 'POST',
        path: '/endpoints/openapi/models/{model}:generateContent',
        body: {
          contents: [
            {
              role: 'user',
              parts: [{ text: '{userMessage}' }],
            },
          ],
          systemInstruction: { parts: [{ text: '{systemMessage}' }] },
          generationConfig: {
            temperature: '{temperature}',
            maxOutputTokens: '{maxOutputTokens}',
            thinkingConfig: {
              thinkingLevel: '{thinkingLevel}',
            },
          },
        },
      },
    },
    {
      name: 'content.generateWithFiles',
      class: 'read',
      description: 'Generate content with file attachments (images, PDFs, text, audio, video).',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          userMessage: { type: 'string' },
          files: { type: 'object' },
          temperature: { type: 'number' },
          maxOutputTokens: { type: 'integer' },
        },
        required: ['model', 'userMessage', 'files'],
      },
      request: {
        method: 'POST',
        path: '/endpoints/openapi/models/{model}:generateContent',
        body: {
          contents: [
            {
              role: 'user',
              parts: [{ text: '{userMessage}' }, '{files}'],
            },
          ],
          generationConfig: {
            temperature: '{temperature}',
            maxOutputTokens: '{maxOutputTokens}',
          },
        },
      },
    },
    {
      name: 'image.generate',
      class: 'mutation',
      description: 'Generate images using Imagen model.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          numberOfImages: { type: 'integer' },
          sampleCount: { type: 'integer' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/endpoints/openapi/google.imagegeneration.v1:predict',
        body: {
          instances: [
            {
              prompt: '{prompt}',
            },
          ],
          parameters: {
            sampleCount: '{sampleCount}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'models.list',
      class: 'read',
      description: 'List available models in the location.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          pageSize: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/models',
        query: { filter: '{filter}', pageSize: '{pageSize}' },
      },
    },
    {
      name: 'content.countTokens',
      class: 'read',
      description: 'Count tokens for a given prompt.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          userMessage: { type: 'string' },
        },
        required: ['model', 'userMessage'],
      },
      request: {
        method: 'POST',
        path: '/endpoints/openapi/models/{model}:countTokens',
        body: {
          contents: [
            {
              role: 'user',
              parts: [{ text: '{userMessage}' }],
            },
          ],
        },
      },
    },
  ],
})
