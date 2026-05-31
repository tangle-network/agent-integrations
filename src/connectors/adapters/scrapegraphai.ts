import { declarativeRestConnector } from './declarative-rest.js'

export const scrapegraphaiConnector = declarativeRestConnector({
  kind: 'scrapegraphai',
  displayName: 'ScrapeGraphAI',
  description: 'AI-powered web scraping and content extraction.',
  auth: { kind: 'api-key', hint: 'ScrapeGraphAI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.scrapegraphai.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'scraper.smart',
      class: 'read',
      description: 'Intelligently scrape a website using AI to extract the data you need.',
      parameters: {
        type: 'object',
        properties: {
          website_url: { type: 'string', description: 'The URL of the website to scrape.' },
          user_prompt: { type: 'string', description: 'Natural language description of what to extract.' },
          output_schema: { type: 'object', description: 'Optional schema to structure the output.' },
        },
        required: ['website_url', 'user_prompt'],
      },
      request: {
        method: 'POST',
        path: '/scrape',
        body: {
          url: '{website_url}',
          userPrompt: '{user_prompt}',
          outputSchema: '{output_schema}',
        },
      },
    },
    {
      name: 'scraper.local',
      class: 'read',
      description: 'Scrape content using local processing without external API calls.',
      parameters: {
        type: 'object',
        properties: {
          website_html: { type: 'string', description: 'The HTML content to process (max 2MB).' },
          user_prompt: { type: 'string', description: 'Natural language description of what to extract.' },
          output_schema: { type: 'object', description: 'Optional schema to structure the output.' },
        },
        required: ['website_html', 'user_prompt'],
      },
      request: {
        method: 'POST',
        path: '/scrape-local',
        body: {
          html: '{website_html}',
          userPrompt: '{user_prompt}',
          outputSchema: '{output_schema}',
        },
      },
    },
    {
      name: 'markdown.convert',
      class: 'read',
      description: 'Convert a webpage to Markdown format.',
      parameters: {
        type: 'object',
        properties: {
          website_url: { type: 'string', description: 'The URL of the website to convert to Markdown.' },
        },
        required: ['website_url'],
      },
      request: {
        method: 'POST',
        path: '/markdown',
        body: {
          url: '{website_url}',
        },
      },
    },
  ],
})
