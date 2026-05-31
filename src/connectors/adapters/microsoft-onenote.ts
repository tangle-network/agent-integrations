import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft OneNote connector via the Microsoft Graph v1.0 OneNote API.
 *
 * Auth: OAuth2 against the Microsoft identity platform. We request the
 * delegated Notes scopes that cover read + write of the user's notebooks,
 * sections, and pages, plus offline_access for refresh.
 *
 * Capability surface mirrors the activepieces piece actions:
 *   - createNotebook        → notebooks.create
 *   - createSection         → sections.create
 *   - createPage            → pages.create        (HTML body)
 *   - createNoteInSection   → pages.createInSection (typed alias of pages.create
 *                             that pins the parent sectionId)
 *   - createImageNote       → pages.createImage   (multipart not modeled here;
 *                             accepts an HTML page body referencing image data;
 *                             callers supply Graph-compatible HTML)
 *   - appendNote            → pages.append        (PATCH a page with revisions)
 *
 * We also expose read helpers (list notebooks/sections/pages, get page content)
 * so an agent can navigate the hierarchy before mutating.
 *
 * Page mutations use 'native-idempotency' because Graph generates the page id
 * server-side on POST and accepts a client-request-id header for de-duplication;
 * page append is 'optimistic-read-verify' since PATCH targets a known page and
 * Graph has no etag for the OneNote subset.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/onenote-api-overview
 *   - https://learn.microsoft.com/graph/api/onenote-list-notebooks
 *   - https://learn.microsoft.com/graph/api/notebook-post-sections
 *   - https://learn.microsoft.com/graph/api/section-post-pages
 *   - https://learn.microsoft.com/graph/api/page-update
 */
export const microsoftOnenoteConnector = declarativeRestConnector({
  kind: 'microsoft-onenote',
  displayName: 'Microsoft OneNote',
  description:
    'Create notebooks, sections, and pages in Microsoft OneNote and append content to existing pages via the Microsoft Graph OneNote API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Notes.ReadWrite', 'Notes.ReadWrite.All', 'User.Read'],
    clientIdEnv: 'MICROSOFT_ONENOTE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_ONENOTE_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  defaultHeaders: {
    Accept: 'application/json',
  },
  test: { method: 'GET', path: '/me/onenote/notebooks', query: { $top: '1' } },
  capabilities: [
    {
      name: 'notebooks.list',
      class: 'read',
      description:
        'List the signed-in user\'s OneNote notebooks. Use $top to page, $filter to narrow by displayName.',
      parameters: {
        type: 'object',
        properties: {
          $top: { type: 'integer' },
          $filter: { type: 'string' },
          $select: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/onenote/notebooks',
        query: { $top: '{$top}', $filter: '{$filter}', $select: '{$select}' },
      },
    },
    {
      name: 'sections.list',
      class: 'read',
      description:
        'List sections in a given notebook. notebookId is the Graph notebook id (e.g. "1-abcdef…").',
      parameters: {
        type: 'object',
        properties: {
          notebookId: { type: 'string' },
          $top: { type: 'integer' },
          $filter: { type: 'string' },
        },
        required: ['notebookId'],
      },
      request: {
        method: 'GET',
        path: '/me/onenote/notebooks/{notebookId}/sections',
        query: { $top: '{$top}', $filter: '{$filter}' },
      },
    },
    {
      name: 'pages.list',
      class: 'read',
      description:
        'List pages in a section. sectionId is the Graph section id; pages are returned in OneNote\'s default order (most-recently-modified first).',
      parameters: {
        type: 'object',
        properties: {
          sectionId: { type: 'string' },
          $top: { type: 'integer' },
          $filter: { type: 'string' },
          $search: { type: 'string' },
        },
        required: ['sectionId'],
      },
      request: {
        method: 'GET',
        path: '/me/onenote/sections/{sectionId}/pages',
        query: { $top: '{$top}', $filter: '{$filter}', $search: '{$search}' },
      },
    },
    {
      name: 'pages.getContent',
      class: 'read',
      description:
        'Get the HTML body of a OneNote page. Pass includeIDs=true to receive data-id attributes for use with the page-update PATCH endpoint.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          includeIDs: { type: 'boolean' },
        },
        required: ['pageId'],
      },
      request: {
        method: 'GET',
        path: '/me/onenote/pages/{pageId}/content',
        query: { includeIDs: '{includeIDs}' },
      },
    },
    {
      name: 'notebooks.create',
      class: 'mutation',
      description:
        'Create a new OneNote notebook owned by the signed-in user. displayName is required and must be unique across the user\'s notebooks.',
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
        },
        required: ['displayName'],
      },
      request: {
        method: 'POST',
        path: '/me/onenote/notebooks',
        headers: { 'Content-Type': 'application/json' },
        body: { displayName: '{displayName}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sections.create',
      class: 'mutation',
      description:
        'Create a section inside an existing notebook. notebookId pins the parent.',
      parameters: {
        type: 'object',
        properties: {
          notebookId: { type: 'string' },
          displayName: { type: 'string' },
        },
        required: ['notebookId', 'displayName'],
      },
      request: {
        method: 'POST',
        path: '/me/onenote/notebooks/{notebookId}/sections',
        headers: { 'Content-Type': 'application/json' },
        body: { displayName: '{displayName}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.create',
      class: 'mutation',
      description:
        'Create a new page in a OneNote section by POSTing OneNote-flavored HTML (full document with <title> and <body>). Callers must supply text/html content; this capability uses /me/onenote/pages directly, which requires a sectionId query parameter.',
      parameters: {
        type: 'object',
        properties: {
          sectionId: { type: 'string' },
          html: { type: 'string' },
        },
        required: ['sectionId', 'html'],
      },
      request: {
        method: 'POST',
        path: '/me/onenote/pages',
        query: { sectionId: '{sectionId}' },
        headers: { 'Content-Type': 'text/html' },
        body: '{html}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.createInSection',
      class: 'mutation',
      description:
        'Create a page inside a specific section (alias of pages.create that POSTs to the section subpath). html is OneNote-flavored HTML with <title> and <body>.',
      parameters: {
        type: 'object',
        properties: {
          sectionId: { type: 'string' },
          html: { type: 'string' },
        },
        required: ['sectionId', 'html'],
      },
      request: {
        method: 'POST',
        path: '/me/onenote/sections/{sectionId}/pages',
        headers: { 'Content-Type': 'text/html' },
        body: '{html}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.createImage',
      class: 'mutation',
      description:
        'Create a page whose body embeds an image. html must reference the image either by absolute URL (<img src="https://…">) or by data-URI (<img src="data:image/png;base64,…">). For multipart uploads with named parts, use the upstream Graph multipart endpoint directly.',
      parameters: {
        type: 'object',
        properties: {
          sectionId: { type: 'string' },
          html: { type: 'string' },
        },
        required: ['sectionId', 'html'],
      },
      request: {
        method: 'POST',
        path: '/me/onenote/sections/{sectionId}/pages',
        headers: { 'Content-Type': 'text/html' },
        body: '{html}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.append',
      class: 'mutation',
      description:
        'Append (or otherwise patch) content to an existing OneNote page. revisions is a JSON array of OneNote PATCH commands; each entry is { target, action, position, content }. Common form: [{"target":"body","action":"append","content":"<p>…</p>"}].',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          revisions: { type: 'array' },
        },
        required: ['pageId', 'revisions'],
      },
      request: {
        method: 'PATCH',
        path: '/me/onenote/pages/{pageId}/content',
        headers: { 'Content-Type': 'application/json' },
        body: '{revisions}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
