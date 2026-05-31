import { declarativeRestConnector } from './declarative-rest.js'

export const runwareConnector = declarativeRestConnector({
  kind: 'runware',
  displayName: 'Runware',
  description: 'Generate images and videos from text prompts or existing images using Runware.AI API.',
  auth: { kind: 'api-key', hint: 'Runware API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.runwayml.com/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'images.generate.from-text',
      class: 'mutation',
      description: 'Generate images from a text prompt.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text description of the image to generate' },
          width: { type: 'integer', description: 'Width of the generated image' },
          height: { type: 'integer', description: 'Height of the generated image' },
          numImages: { type: 'integer', description: 'Number of images to generate' },
          seed: { type: 'integer', description: 'Seed for reproducibility' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/imagine',
        body: {
          prompt: '{prompt}',
          width: '{width}',
          height: '{height}',
          numImages: '{numImages}',
          seed: '{seed}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'images.generate.from-image',
      class: 'mutation',
      description: 'Generate images from an existing image.',
      parameters: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'URL of the source image' },
          prompt: { type: 'string', description: 'Text prompt to guide the generation' },
          strength: { type: 'number', description: 'Strength of the generation (0-1)' },
          numImages: { type: 'integer', description: 'Number of images to generate' },
        },
        required: ['imageUrl', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/imagine',
        body: {
          imageUrl: '{imageUrl}',
          prompt: '{prompt}',
          strength: '{strength}',
          numImages: '{numImages}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'video.generate.from-text',
      class: 'mutation',
      description: 'Generate video from a text prompt.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Text description of the video to generate' },
          duration: { type: 'integer', description: 'Duration of the video in seconds' },
          fps: { type: 'integer', description: 'Frames per second' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/video',
        body: {
          prompt: '{prompt}',
          duration: '{duration}',
          fps: '{fps}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'image.remove-background',
      class: 'mutation',
      description: 'Remove background from an image.',
      parameters: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'URL of the image to process' },
        },
        required: ['imageUrl'],
      },
      request: {
        method: 'POST',
        path: '/remove-background',
        body: {
          imageUrl: '{imageUrl}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
