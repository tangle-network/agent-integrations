import { declarativeRestConnector } from './declarative-rest.js'

export const writesonicBulkConnector = declarativeRestConnector({
  kind: 'writesonic-bulk',
  displayName: 'Writesonic',
  description: 'Generate AI-powered content: blog ideas, intros, outlines, product descriptions, ads, and more.',
  auth: { kind: 'api-key', hint: 'Writesonic API key.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.writesonic.com/v1',
  test: { method: 'GET', path: '/ping' },
  capabilities: [
    {
      name: 'blog.ideas',
      class: 'mutation',
      description: 'Generate blog ideas for a given topic.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          numCopies: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['topic', 'numCopies'],
      },
      request: {
        method: 'POST',
        path: '/blog-ideas',
        body: { topic: '{topic}', num_copies: '{numCopies}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'blog.intros',
      class: 'mutation',
      description: 'Generate blog introductions based on title and keyword.',
      parameters: {
        type: 'object',
        properties: {
          blogTitle: { type: 'string' },
          keyword: { type: ['string', 'null'] },
        },
        required: ['blogTitle'],
      },
      request: {
        method: 'POST',
        path: '/blog-intros',
        body: { blog_title: '{blogTitle}', keyword: '{keyword}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'blog.outlines',
      class: 'mutation',
      description: 'Generate blog outlines based on introduction.',
      parameters: {
        type: 'object',
        properties: {
          blogIntro: { type: 'string' },
        },
        required: ['blogIntro'],
      },
      request: {
        method: 'POST',
        path: '/blog-outlines',
        body: { blog_intro: '{blogIntro}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'content.rephraser',
      class: 'mutation',
      description: 'Rephrase existing content.',
      parameters: {
        type: 'object',
        properties: {
          contentToRephrase: { type: 'string' },
        },
        required: ['contentToRephrase'],
      },
      request: {
        method: 'POST',
        path: '/content-rephraser',
        body: { content_to_rephrase: '{contentToRephrase}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'content.shorten',
      class: 'mutation',
      description: 'Shorten existing content.',
      parameters: {
        type: 'object',
        properties: {
          contentToShorten: { type: 'string' },
        },
        required: ['contentToShorten'],
      },
      request: {
        method: 'POST',
        path: '/content-shorten',
        body: { content_to_shorten: '{contentToShorten}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sentence.expander',
      class: 'mutation',
      description: 'Expand a sentence into longer content.',
      parameters: {
        type: 'object',
        properties: {
          contentToExpand: { type: 'string' },
        },
        required: ['contentToExpand'],
      },
      request: {
        method: 'POST',
        path: '/sentence-expander',
        body: { content_to_expand: '{contentToExpand}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'facebook.ads',
      class: 'mutation',
      description: 'Generate Facebook ad copy.',
      parameters: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          productDescription: { type: ['string', 'null'] },
        },
        required: ['productName'],
      },
      request: {
        method: 'POST',
        path: '/facebook-ads',
        body: { product_name: '{productName}', product_description: '{productDescription}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'google.ads',
      class: 'mutation',
      description: 'Generate Google ad copy.',
      parameters: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          searchTerm: { type: ['string', 'null'] },
        },
        required: ['productName'],
      },
      request: {
        method: 'POST',
        path: '/google-ads',
        body: { product_name: '{productName}', search_term: '{searchTerm}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'generate.product.descriptions',
      class: 'mutation',
      description: 'Generate product descriptions with keywords.',
      parameters: {
        type: 'object',
        properties: {
          productCharacteristics: { type: 'string' },
          primaryKeyword: { type: ['string', 'null'] },
          secondaryKeywords: { type: ['string', 'null'] },
        },
        required: ['productCharacteristics'],
      },
      request: {
        method: 'POST',
        path: '/generate-product-descriptions',
        body: {
          product_characteristics: '{productCharacteristics}',
          primary_keyword: '{primaryKeyword}',
          secondary_keywords: '{secondaryKeywords}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'landing.page.headlines',
      class: 'mutation',
      description: 'Generate landing page headlines.',
      parameters: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          productDescription: { type: ['string', 'null'] },
        },
        required: ['productName'],
      },
      request: {
        method: 'POST',
        path: '/landing-page-headlines',
        body: { product_name: '{productName}', product_description: '{productDescription}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
