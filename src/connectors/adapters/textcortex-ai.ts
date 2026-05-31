import { declarativeRestConnector } from './declarative-rest.js'

export const textcortexAiConnector = declarativeRestConnector({
  kind: 'textcortex-ai',
  displayName: 'TextCortex AI',
  description: 'AI-powered writing assistant for content creation, code generation, translations, and more using multiple AI models.',
  auth: { kind: 'api-key', hint: 'TextCortex AI API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.textcortex.com',
  test: { method: 'GET', path: '/v1/hello' },
  capabilities: [
    {
      name: 'prompt.send',
      class: 'mutation',
      description: 'Send a prompt to TextCortex AI and get a response.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt text to send.' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
          max_tokens: { type: 'integer', description: 'Maximum tokens in response (optional, 1-4096).' },
          temperature: { type: 'number', description: 'Temperature/creativity level (optional, 0.0-2.0).' },
          n: { type: 'integer', description: 'Number of outputs to generate (optional, 1-5).' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/v1/completions',
        body: {
          prompt: '{prompt}',
          model: '{model}',
          max_tokens: '{max_tokens}',
          temperature: '{temperature}',
          n: '{n}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'paraphrase.create',
      class: 'mutation',
      description: 'Create a paraphrase of the provided text.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to paraphrase.' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/v1/paraphrase',
        body: {
          text: '{text}',
          model: '{model}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'social.media.caption.create',
      class: 'mutation',
      description: 'Generate a social media caption for given content.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The content to create a caption for.' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/v1/social-media-caption',
        body: {
          text: '{text}',
          model: '{model}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'translation.create',
      class: 'mutation',
      description: 'Translate text from source language to target language.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to translate.' },
          source_lang: { type: 'string', description: 'Source language code (optional).' },
          target_lang: { type: 'string', description: 'Target language code.' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
        },
        required: ['text', 'target_lang'],
      },
      request: {
        method: 'POST',
        path: '/v1/translate',
        body: {
          text: '{text}',
          source_lang: '{source_lang}',
          target_lang: '{target_lang}',
          model: '{model}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'code.create',
      class: 'mutation',
      description: 'Generate code based on provided instructions.',
      parameters: {
        type: 'object',
        properties: {
          instructions: { type: 'string', description: 'Code generation instructions.' },
          language: { type: 'string', description: 'Programming language for code.' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
          max_tokens: { type: 'integer', description: 'Maximum tokens in response (optional, 1-4096).' },
          temperature: { type: 'number', description: 'Temperature/creativity level (optional, 0.0-2.0).' },
        },
        required: ['instructions', 'language'],
      },
      request: {
        method: 'POST',
        path: '/v1/code',
        body: {
          instructions: '{instructions}',
          language: '{language}',
          model: '{model}',
          max_tokens: '{max_tokens}',
          temperature: '{temperature}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'email.create',
      class: 'mutation',
      description: 'Generate an email with optional context and instructions.',
      parameters: {
        type: 'object',
        properties: {
          context: { type: 'string', description: 'Context for the email.' },
          to: { type: 'string', description: 'Email recipient (optional).' },
          from: { type: 'string', description: 'Email sender (optional).' },
          instructions: { type: 'string', description: 'Instructions for email generation (optional).' },
          received_email: { type: 'string', description: 'Email being replied to (optional).' },
          purpose: { type: 'string', description: 'Purpose of the email (optional).' },
          company_details: { type: 'string', description: 'Company details (optional).' },
          formality: { type: 'string', description: 'Formality level (optional).' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
        },
        required: ['context'],
      },
      request: {
        method: 'POST',
        path: '/v1/email',
        body: {
          context: '{context}',
          to: '{to}',
          from: '{from}',
          instructions: '{instructions}',
          received_email: '{received_email}',
          purpose: '{purpose}',
          company_details: '{company_details}',
          formality: '{formality}',
          model: '{model}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'product.description.create',
      class: 'mutation',
      description: 'Generate a product description with name, features, brand, and category.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Product name.' },
          description: { type: 'string', description: 'Product features.' },
          brand: { type: 'string', description: 'Product brand (optional).' },
          category: { type: 'string', description: 'Product category (optional).' },
          keywords: { type: 'string', description: 'Keywords to include (comma-separated, optional).' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
        },
        required: ['name', 'description'],
      },
      request: {
        method: 'POST',
        path: '/v1/product-description',
        body: {
          name: '{name}',
          description: '{description}',
          brand: '{brand}',
          category: '{category}',
          keywords: '{keywords}',
          model: '{model}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'summary.create',
      class: 'mutation',
      description: 'Generate a summary of the provided text.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to summarize.' },
          model: { type: 'string', description: 'The AI model to use (optional).' },
        },
        required: ['text'],
      },
      request: {
        method: 'POST',
        path: '/v1/summary',
        body: {
          text: '{text}',
          model: '{model}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
