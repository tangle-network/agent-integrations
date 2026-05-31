import { declarativeRestConnector } from './declarative-rest.js'

export const vlmRunConnector = declarativeRestConnector({
  kind: 'vlm-run',
  displayName: 'VLM Run',
  description: 'Analyze images, videos, audio, and documents using visual AI. Extract data, detect objects, transcribe, and parse content.',
  auth: { kind: 'api-key', hint: 'VLM Run API key from your account dashboard.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.vlmrun.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'analyze.image',
      class: 'mutation',
      description: 'Analyze an image using visual AI to extract data and detect objects.',
      parameters: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'URL of the image to analyze' },
          prompt: { type: 'string', description: 'Optional analysis prompt or instruction' },
          mode: { type: 'string', enum: ['object-detection', 'ocr', 'general'], description: 'Analysis mode' },
        },
        required: ['imageUrl'],
      },
      request: {
        method: 'POST',
        path: '/analyze/image',
        body: {
          imageUrl: '{imageUrl}',
          prompt: '{prompt}',
          mode: '{mode}',
        },
      },
    },
    {
      name: 'analyze.video',
      class: 'mutation',
      description: 'Analyze a video file to extract frames, detect objects, and summarize content.',
      parameters: {
        type: 'object',
        properties: {
          videoUrl: { type: 'string', description: 'URL of the video to analyze' },
          sampleRate: { type: 'integer', description: 'Frame sampling rate (frames per second)' },
          prompt: { type: 'string', description: 'Optional analysis instruction' },
        },
        required: ['videoUrl'],
      },
      request: {
        method: 'POST',
        path: '/analyze/video',
        body: {
          videoUrl: '{videoUrl}',
          sampleRate: '{sampleRate}',
          prompt: '{prompt}',
        },
      },
    },
    {
      name: 'analyze.audio',
      class: 'mutation',
      description: 'Transcribe and analyze audio content.',
      parameters: {
        type: 'object',
        properties: {
          audioUrl: { type: 'string', description: 'URL of the audio file to analyze' },
          language: { type: 'string', description: 'Language code (e.g., en, es, fr)' },
          extractEntities: { type: 'boolean', description: 'Extract named entities from transcription' },
        },
        required: ['audioUrl'],
      },
      request: {
        method: 'POST',
        path: '/analyze/audio',
        body: {
          audioUrl: '{audioUrl}',
          language: '{language}',
          extractEntities: '{extractEntities}',
        },
      },
    },
    {
      name: 'analyze.document',
      class: 'mutation',
      description: 'Extract text and structured data from documents (PDF, images, etc.).',
      parameters: {
        type: 'object',
        properties: {
          documentUrl: { type: 'string', description: 'URL of the document to parse' },
          documentType: { type: 'string', enum: ['pdf', 'image', 'mixed'], description: 'Document type' },
          extractTables: { type: 'boolean', description: 'Extract tables as structured data' },
        },
        required: ['documentUrl'],
      },
      request: {
        method: 'POST',
        path: '/analyze/document',
        body: {
          documentUrl: '{documentUrl}',
          documentType: '{documentType}',
          extractTables: '{extractTables}',
        },
      },
    },
    {
      name: 'file.get',
      class: 'read',
      description: 'Retrieve a previously analyzed file result.',
      parameters: {
        type: 'object',
        properties: { fileId: { type: 'string', description: 'ID of the analyzed file' } },
        required: ['fileId'],
      },
      request: { method: 'GET', path: '/files/{fileId}' },
    },
  ],
})
