import { declarativeRestConnector } from './declarative-rest.js'

export const humeAiConnector = declarativeRestConnector({
  kind: 'hume-ai',
  displayName: 'Hume AI',
  description: 'Generate speech synthesis, analyze emotions from media, and manage custom voices.',
  auth: { kind: 'api-key', hint: 'Hume AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.hume.ai/v0',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'speech.generate',
      class: 'mutation',
      description: 'Convert text to speech using Hume AI voice synthesis.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to convert to speech' },
          voiceDescription: { type: 'string', description: 'Natural language description of how the speech should sound' },
          voiceName: { type: 'string', description: 'Optional name of a custom voice to use' },
          format: { type: 'string', enum: ['wav', 'mp3', 'ulaw'], description: 'The output audio file format' },
          speed: { type: 'number', description: 'Speed multiplier for the synthesized speech (0.75-1.5)' },
          contextText: { type: 'string', description: 'Optional context text to influence speech style' },
          contextDescription: { type: 'string', description: 'Description for the context text' },
          trailingSilence: { type: 'number', description: 'Duration of silence to add at the end in seconds' },
          splitUtterances: { type: 'boolean', description: 'Automatically split text into natural-sounding segments' },
          numGenerations: { type: 'integer', description: 'Number of audio generations to produce (1-5)' },
        },
        required: ['text', 'format'],
      },
      request: {
        method: 'POST',
        path: '/expressive_synthesis/generate_speech',
        body: {
          text: '{text}',
          voiceDescription: '{voiceDescription}',
          voiceName: '{voiceName}',
          format: '{format}',
          speed: '{speed}',
          contextText: '{contextText}',
          contextDescription: '{contextDescription}',
          trailingSilence: '{trailingSilence}',
          splitUtterances: '{splitUtterances}',
          numGenerations: '{numGenerations}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'speech.from-file',
      class: 'mutation',
      description: 'Generate speech from an audio file using voice cloning.',
      parameters: {
        type: 'object',
        properties: {
          generationId: { type: 'string', description: 'The unique ID from a previous TTS generation to use as voice' },
          text: { type: 'string', description: 'The text to convert to speech' },
          format: { type: 'string', enum: ['wav', 'mp3', 'ulaw'], description: 'The output audio file format' },
          speed: { type: 'number', description: 'Speed multiplier for the synthesized speech' },
        },
        required: ['generationId', 'text', 'format'],
      },
      request: {
        method: 'POST',
        path: '/expressive_synthesis/synthesize_voice',
        body: {
          generationId: '{generationId}',
          text: '{text}',
          format: '{format}',
          speed: '{speed}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'voice.create',
      class: 'mutation',
      description: 'Create a custom voice from a TTS generation.',
      parameters: {
        type: 'object',
        properties: {
          generationId: { type: 'string', description: 'The unique ID from a previous TTS generation to save as voice' },
          voiceName: { type: 'string', description: 'A descriptive name for the custom voice' },
        },
        required: ['generationId', 'voiceName'],
      },
      request: {
        method: 'POST',
        path: '/expressive_synthesis/save_voice',
        body: {
          generationId: '{generationId}',
          voiceName: '{voiceName}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'voice.delete',
      class: 'mutation',
      description: 'Delete a custom voice.',
      parameters: {
        type: 'object',
        properties: {
          voiceName: { type: 'string', description: 'The name of the custom voice to delete' },
        },
        required: ['voiceName'],
      },
      request: {
        method: 'DELETE',
        path: '/expressive_synthesis/voices/{voiceName}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'emotions.analyze',
      class: 'mutation',
      description: 'Analyze emotions from media URLs (images, videos, or audio).',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: 'URLs to media files to analyze' },
          models: { type: 'object', description: 'Specify which models to use for inference' },
          transcription: { type: 'boolean', description: 'Include speech-to-text transcription in the analysis' },
          callbackUrl: { type: 'string', description: 'Optional webhook URL to receive results when the job completes' },
          notify: { type: 'boolean', description: 'Send email notification upon job completion or failure' },
        },
        required: ['urls'],
      },
      request: {
        method: 'POST',
        path: '/batch/jobs/estimate/predict',
        body: {
          urls: '{urls}',
          models: '{models}',
          transcription: '{transcription}',
          callbackUrl: '{callbackUrl}',
          notify: '{notify}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'emotions.results',
      class: 'read',
      description: 'Retrieve results from a completed emotion analysis job.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The ID of the emotion analysis job' },
        },
        required: ['jobId'],
      },
      request: {
        method: 'GET',
        path: '/batch/jobs/{jobId}',
      },
    },
  ],
})
