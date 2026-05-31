import { declarativeRestConnector } from './declarative-rest.js'

export const cambAiConnector = declarativeRestConnector({
  kind: 'camb-ai',
  displayName: 'Camb.AI',
  description: 'Create text-to-sound, text-to-speech, translations, and transcriptions.',
  auth: { kind: 'api-key', hint: 'Camb.AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.camb.ai/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'audio.textToSound',
      class: 'mutation',
      description: 'Create text to sound audio.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'A clear, descriptive explanation of the desired audio effect.' },
          duration: { type: 'number', description: 'The desired length of the audio in seconds (max 10).' },
          projectName: { type: 'string', description: 'A memorable name for your project.' },
          projectDescription: { type: 'string', description: 'Details about your project.' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/text-to-sound',
        body: {
          prompt: '{prompt}',
          duration: '{duration}',
          projectName: '{projectName}',
          projectDescription: '{projectDescription}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'audio.textToSpeech',
      class: 'mutation',
      description: 'Create text to speech audio.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to be converted to speech.' },
          gender: { type: 'string', description: 'The gender of the speaker.' },
          age: { type: 'number', description: 'The age of the speaker to be generated.' },
          projectName: { type: 'string', description: 'A memorable name for your project.' },
          projectDescription: { type: 'string', description: 'Details about your project.' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/text-to-speech',
        body: {
          text: '{text}',
          gender: '{gender}',
          age: '{age}',
          projectName: '{projectName}',
          projectDescription: '{projectDescription}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'audio.transcribe',
      class: 'mutation',
      description: 'Transcribe audio media to text.',
      parameters: {
        type: 'object',
        properties: {
          sourceType: { type: 'string', description: 'Choose whether to upload a file or provide a URL.' },
          media: { type: 'string', description: 'The media file (e.g., MP3, WAV, MP4) to transcribe. Max size: 20MB.' },
          projectName: { type: 'string', description: 'A memorable name for your project.' },
          projectDescription: { type: 'string', description: 'Details about your project.' },
        },
        required: ['sourceType', 'media'],
      },
      request: {
        method: 'POST',
        path: '/transcribe',
        body: {
          sourceType: '{sourceType}',
          media: '{media}',
          projectName: '{projectName}',
          projectDescription: '{projectDescription}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'text.translate',
      class: 'mutation',
      description: 'Translate text to another language.',
      parameters: {
        type: 'object',
        properties: {
          texts: { type: 'string', description: 'The text to be translated. You can enter multiple lines; each line will be treated as a separate text segment.' },
          formality: { type: 'string', description: 'Adjust the formality level to match your context.' },
          projectName: { type: 'string', description: 'A memorable name for your project.' },
          projectDescription: { type: 'string', description: 'Details about your project.' },
        },
        required: ['texts'],
      },
      request: {
        method: 'POST',
        path: '/translate',
        body: {
          texts: '{texts}',
          formality: '{formality}',
          projectName: '{projectName}',
          projectDescription: '{projectDescription}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
