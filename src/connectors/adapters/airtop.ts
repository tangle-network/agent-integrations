import { declarativeRestConnector } from './declarative-rest.js'

// Airtop: cloud browser automation API. Sessions hold a remote browser;
// windows scope page operations; query/scrape/click/type drive the page.
// REST surface documented at https://docs.airtop.ai/api-reference.
export const airtopConnector = declarativeRestConnector({
  kind: 'airtop',
  displayName: 'Airtop',
  description: 'Drive cloud browser sessions: create/terminate sessions, open windows, scrape and interact with pages.',
  auth: { kind: 'api-key', hint: 'Airtop API key (Bearer).' },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.airtop.ai/api/v1',
  test: { method: 'GET', path: '/sessions' },
  capabilities: [
    {
      name: 'sessions.create',
      class: 'mutation',
      description: 'Create a new cloud browser session.',
      parameters: {
        type: 'object',
        properties: {
          configuration: { type: 'object' },
        },
      },
      request: {
        method: 'POST',
        path: '/sessions',
        body: { configuration: '{configuration}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sessions.terminate',
      class: 'mutation',
      description: 'Terminate an existing browser session.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
      request: { method: 'DELETE', path: '/sessions/{sessionId}' },
    },
    {
      name: 'windows.create',
      class: 'mutation',
      description: 'Open a new browser window inside a session at the given URL.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          url: { type: 'string' },
          screenResolution: { type: 'string' },
        },
        required: ['sessionId', 'url'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows',
        body: { url: '{url}', screenResolution: '{screenResolution}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'windows.screenshot',
      class: 'read',
      description: 'Take a screenshot of a browser window.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
        },
        required: ['sessionId', 'windowId'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/screenshot',
      },
    },
    {
      name: 'windows.pageQuery',
      class: 'read',
      description: 'Run a natural-language page query against a window.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
          prompt: { type: 'string' },
          followPaginationLinks: { type: 'boolean' },
          configuration: { type: 'object' },
        },
        required: ['sessionId', 'windowId', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/page-query',
        body: {
          prompt: '{prompt}',
          followPaginationLinks: '{followPaginationLinks}',
          configuration: '{configuration}',
        },
      },
    },
    {
      name: 'windows.smartScrape',
      class: 'mutation',
      description: 'Smart-scrape structured content from the current page.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
          prompt: { type: 'string' },
          configuration: { type: 'object' },
        },
        required: ['sessionId', 'windowId'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/scrape-content',
        body: {
          prompt: '{prompt}',
          configuration: '{configuration}',
        },
      },
    },
    {
      name: 'windows.paginatedExtraction',
      class: 'mutation',
      description: 'Extract structured records across paginated pages.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
          prompt: { type: 'string' },
          outputSchema: { type: 'object' },
          paginationMode: { type: 'string' },
        },
        required: ['sessionId', 'windowId', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/paginated-extraction',
        body: {
          prompt: '{prompt}',
          outputSchema: '{outputSchema}',
          paginationMode: '{paginationMode}',
        },
      },
    },
    {
      name: 'windows.click',
      class: 'mutation',
      description: 'Click an element described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
          elementDescription: { type: 'string' },
          clickType: { type: 'string' },
          waitForNavigation: { type: 'boolean' },
        },
        required: ['sessionId', 'windowId', 'elementDescription'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/click',
        body: {
          elementDescription: '{elementDescription}',
          clickType: '{clickType}',
          waitForNavigation: '{waitForNavigation}',
        },
      },
    },
    {
      name: 'windows.type',
      class: 'mutation',
      description: 'Type text into an element described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
          elementDescription: { type: 'string' },
          text: { type: 'string' },
          submit: { type: 'boolean' },
        },
        required: ['sessionId', 'windowId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/type',
        body: {
          elementDescription: '{elementDescription}',
          text: '{text}',
          submit: '{submit}',
        },
      },
    },
    {
      name: 'windows.hover',
      class: 'mutation',
      description: 'Hover an element described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          windowId: { type: 'string' },
          elementDescription: { type: 'string' },
        },
        required: ['sessionId', 'windowId', 'elementDescription'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/windows/{windowId}/hover',
        body: { elementDescription: '{elementDescription}' },
      },
    },
    {
      name: 'sessions.uploadFile',
      class: 'mutation',
      description: 'Upload a file to a browser session for later use.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          fileName: { type: 'string' },
          fileContent: { type: 'string' },
        },
        required: ['sessionId', 'fileName', 'fileContent'],
      },
      request: {
        method: 'POST',
        path: '/sessions/{sessionId}/files',
        body: { fileName: '{fileName}', fileContent: '{fileContent}' },
      },
    },
  ],
})
