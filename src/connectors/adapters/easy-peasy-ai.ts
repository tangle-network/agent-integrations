import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Easy-Peasy.AI connector.
 *
 * Easy-Peasy.AI exposes a small REST surface for AI generation tasks:
 *   - Custom text generation through tenant-defined generators
 *   - AI image generation across multiple model backends
 *   - Asynchronous audio transcription against a hosted audio URL
 *
 * Catalog action surface (Activepieces piece-easy-peasy-ai 0.1.4):
 *   - custom.generator.text  -> customGeneratorText
 *   - generate.ai.image      -> generateAiImage
 *   - get.ai.transcription   -> getAiTranscription
 *
 * Auth: tenant-issued API key, sent in the Authorization header as
 * `Bearer <key>` on every request.
 *
 * Consistency:
 *   - All three operations are LLM/model-backed, non-deterministic, and
 *     billed per call. CAS = `none`, externalEffect = true so the
 *     orchestrator treats them as side-effecting and the caller owns
 *     dedupe (Easy-Peasy.AI does not accept a client idempotency key).
 *   - Transcription returns asynchronously: the create call returns a job
 *     handle and the read capability is used to poll the result.
 */
export const easyPeasyAiConnector = declarativeRestConnector({
  kind: 'easy-peasy-ai',
  displayName: 'Easy-Peasy.AI',
  description:
    'Generate text from tenant-defined custom generators, produce AI images across multiple model backends, and transcribe audio via Easy-Peasy.AI.',
  auth: {
    kind: 'api-key',
    hint: 'Easy-Peasy.AI API key from Account → API. Sent as a Bearer token in the Authorization header.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://easy-peasy.ai/api',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  capabilities: [
    {
      name: 'generator.text.run',
      class: 'mutation',
      description:
        'Run a custom Easy-Peasy.AI text generator. The generator and its prompt template are configured in the Easy-Peasy.AI UI; this call supplies the keyword payload, optional background context, and model/language switches at invocation time.',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: 'Primary input prompt for the generator. Max 1000 characters.',
          },
          extra1: {
            type: 'string',
            description: 'Optional background context that augments the prompt. Max 1000 characters.',
          },
          outputs: {
            type: 'integer',
            description: 'Number of candidate generations to return. Defaults to 1 server-side.',
          },
          language: {
            type: 'string',
            description: 'Target language for the generated text (e.g. English, Spanish, German). Defaults to English.',
          },
          shouldUseGPT4: {
            type: 'boolean',
            description:
              'When true, route the generation through the GPT-4 model variant. Higher cost; the default model is the lower-tier backend.',
          },
        },
        required: ['keywords'],
      },
      request: {
        method: 'POST',
        path: '/generate',
        body: {
          keywords: '{keywords}',
          extra1: '{extra1}',
          outputs: '{outputs}',
          language: '{language}',
          shouldUseGPT4: '{shouldUseGPT4}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'image.generate',
      class: 'mutation',
      description:
        'Generate an AI image from a text prompt. Selects between Easy-Peasy.AI image-model backends and accepts style, artist, dimension, HD, and reference-image controls.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to render.',
          },
          model: {
            type: 'string',
            description: 'Image model identifier (e.g. stable-diffusion, dall-e, flux). Maps to an Easy-Peasy.AI model slug.',
          },
          style: {
            type: 'string',
            description: 'Art style or aesthetic descriptor blended into the prompt (e.g. cinematic, watercolor, neon).',
          },
          artist: {
            type: 'string',
            description: 'Optional artist whose style the image should imitate.',
          },
          dimensions: {
            type: 'string',
            description: 'Aspect ratio / output dimensions (e.g. 1024x1024, 1792x1024).',
          },
          useHD: {
            type: 'boolean',
            description: 'When true, render in HD quality. Higher cost than the standard quality default.',
          },
          image: {
            type: 'string',
            description: 'Optional URL to a reference image used to anchor style or composition.',
          },
        },
        required: ['prompt', 'model'],
      },
      request: {
        method: 'POST',
        path: '/image',
        body: {
          prompt: '{prompt}',
          model: '{model}',
          style: '{style}',
          artist: '{artist}',
          dimensions: '{dimensions}',
          useHD: '{useHD}',
          image: '{image}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'transcription.create',
      class: 'mutation',
      description:
        'Submit a hosted audio URL for asynchronous transcription. Returns a transcription job handle; the result is fetched with transcription.get once processing is complete.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Publicly fetchable URL of the audio file to transcribe.',
          },
          name: {
            type: 'string',
            description: 'Human-readable title used to label this transcription in the Easy-Peasy.AI dashboard.',
          },
          audio_type: {
            type: 'string',
            description:
              'Type of audio content (e.g. meeting, podcast, lecture, interview). Drives downstream transcript formatting.',
          },
          detect_speakers: {
            type: 'boolean',
            description: 'When true, run speaker diarization and label each segment with the detected speaker.',
          },
          enhanced_quality: {
            type: 'boolean',
            description: 'When true, use the higher-quality transcription model. Slower and more expensive than the default.',
          },
        },
        required: ['url', 'name', 'audio_type'],
      },
      request: {
        method: 'POST',
        path: '/transcriptions',
        body: {
          url: '{url}',
          name: '{name}',
          audio_type: '{audio_type}',
          detect_speakers: '{detect_speakers}',
          enhanced_quality: '{enhanced_quality}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'transcription.get',
      class: 'read',
      description:
        'Read the current state of an Easy-Peasy.AI transcription job by ID, including status (queued/processing/completed/failed) and, once finished, the transcript payload.',
      parameters: {
        type: 'object',
        properties: {
          transcriptionId: {
            type: 'string',
            description: 'Transcription job identifier returned by transcription.create.',
          },
        },
        required: ['transcriptionId'],
      },
      request: {
        method: 'GET',
        path: '/transcriptions/{transcriptionId}',
      },
    },
  ],
})
