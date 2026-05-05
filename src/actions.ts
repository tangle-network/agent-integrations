import type {
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorTrigger,
} from './index.js'

export const CANONICAL_INTEGRATION_ACTIONS = {
  googleCalendarEventsList: 'google-calendar.events.list',
  googleCalendarEventsCreate: 'google-calendar.events.create',
  gmailMessagesSearch: 'gmail.messages.search',
  gmailMessagesSend: 'gmail.messages.send',
  googleDriveFilesSearch: 'google-drive.files.search',
  googleDriveFilesRead: 'google-drive.files.read',
  githubRepositoriesGet: 'github.repositories.get',
  githubIssuesSearch: 'github.issues.search',
  githubIssuesCreate: 'github.issues.create',
  githubPullRequestsComment: 'github.pull-requests.comment',
  slackChannelsList: 'slack.channels.list',
  slackMessagesSearch: 'slack.messages.search',
  slackMessagesPost: 'slack.messages.post',
  providerHttpRequest: 'provider.http.request',
} as const

export type CanonicalIntegrationActionId =
  typeof CANONICAL_INTEGRATION_ACTIONS[keyof typeof CANONICAL_INTEGRATION_ACTIONS]

export interface CanonicalLaunchConnectorOptions {
  providerId?: string
  includeProviderPassthrough?: boolean
}

export function buildCanonicalLaunchConnectors(options: CanonicalLaunchConnectorOptions = {}): IntegrationConnector[] {
  const providerId = options.providerId ?? 'tangle-platform'
  const connectors = [
    googleCalendarConnector(providerId),
    gmailConnector(providerId),
    googleDriveConnector(providerId),
    githubConnector(providerId),
    slackConnector(providerId),
  ]
  if (!options.includeProviderPassthrough) return connectors
  return connectors.map((connector) => ({
    ...connector,
    actions: [...connector.actions, providerPassthroughAction(connector.id)],
  }))
}

export function canonicalActionConnectorId(actionId: string): string | undefined {
  if (actionId.startsWith('google-calendar.')) return 'google-calendar'
  if (actionId.startsWith('gmail.')) return 'gmail'
  if (actionId.startsWith('google-drive.')) return 'google-drive'
  if (actionId.startsWith('github.')) return 'github'
  if (actionId.startsWith('slack.')) return 'slack'
  if (actionId === CANONICAL_INTEGRATION_ACTIONS.providerHttpRequest) return undefined
  return actionId.split('.')[0]
}

function googleCalendarConnector(providerId: string): IntegrationConnector {
  return {
    id: 'google-calendar',
    providerId,
    title: 'Google Calendar',
    category: 'calendar',
    auth: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
    actions: [
      {
        id: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsList,
        title: 'List calendar events',
        risk: 'read',
        requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        dataClass: 'private',
        description: 'Read events from a Google Calendar over a bounded time range.',
        inputSchema: objectSchema({
          calendarId: { type: 'string', default: 'primary' },
          timeMin: { type: 'string', description: 'RFC3339 lower bound.' },
          timeMax: { type: 'string', description: 'RFC3339 upper bound.' },
        }, ['timeMin', 'timeMax']),
      },
      {
        id: CANONICAL_INTEGRATION_ACTIONS.googleCalendarEventsCreate,
        title: 'Create calendar event',
        risk: 'write',
        requiredScopes: ['https://www.googleapis.com/auth/calendar.events'],
        dataClass: 'private',
        approvalRequired: true,
        description: 'Create an event on a Google Calendar after user approval.',
        inputSchema: objectSchema({
          calendarId: { type: 'string', default: 'primary' },
          start: { type: 'string', description: 'RFC3339 start time.' },
          end: { type: 'string', description: 'RFC3339 end time.' },
          summary: { type: 'string' },
          description: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
        }, ['start', 'end', 'summary']),
      },
    ],
    metadata: { source: 'canonical-launch', supportTier: 'setupReady' },
  }
}

function gmailConnector(providerId: string): IntegrationConnector {
  return {
    id: 'gmail',
    providerId,
    title: 'Gmail',
    category: 'email',
    auth: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    actions: [
      {
        id: CANONICAL_INTEGRATION_ACTIONS.gmailMessagesSearch,
        title: 'Search Gmail messages',
        risk: 'read',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        dataClass: 'private',
        description: 'Search user Gmail messages and return bounded message metadata/snippets.',
        inputSchema: objectSchema({ query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 50 } }, ['query']),
      },
      {
        id: CANONICAL_INTEGRATION_ACTIONS.gmailMessagesSend,
        title: 'Send Gmail message',
        risk: 'write',
        requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
        dataClass: 'private',
        approvalRequired: true,
        description: 'Send an email from the user account after approval.',
        inputSchema: objectSchema({
          to: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string' },
        }, ['to', 'subject', 'body']),
      },
    ],
    triggers: [{
      id: 'gmail.messages.received',
      title: 'Gmail message received',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      dataClass: 'private',
      description: 'Triggered when a new matching Gmail message is received.',
    }],
    metadata: { source: 'canonical-launch', supportTier: 'setupReady' },
  }
}

function googleDriveConnector(providerId: string): IntegrationConnector {
  return {
    id: 'google-drive',
    providerId,
    title: 'Google Drive',
    category: 'storage',
    auth: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
    actions: [
      {
        id: CANONICAL_INTEGRATION_ACTIONS.googleDriveFilesSearch,
        title: 'Search Drive files',
        risk: 'read',
        requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
        dataClass: 'private',
        description: 'Search user-visible Google Drive files.',
        inputSchema: objectSchema({ query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 50 } }, ['query']),
      },
      {
        id: CANONICAL_INTEGRATION_ACTIONS.googleDriveFilesRead,
        title: 'Read Drive file',
        risk: 'read',
        requiredScopes: ['https://www.googleapis.com/auth/drive.readonly'],
        dataClass: 'private',
        description: 'Read metadata and content for an authorized Drive file.',
        inputSchema: objectSchema({ fileId: { type: 'string' } }, ['fileId']),
      },
    ],
    metadata: { source: 'canonical-launch', supportTier: 'setupReady' },
  }
}

function githubConnector(providerId: string): IntegrationConnector {
  return {
    id: 'github',
    providerId,
    title: 'GitHub',
    category: 'workflow',
    auth: 'oauth2',
    scopes: ['repo', 'read:user'],
    actions: [
      readAction(CANONICAL_INTEGRATION_ACTIONS.githubRepositoriesGet, 'Read repository metadata', ['repo'], objectSchema({ owner: { type: 'string' }, repo: { type: 'string' } }, ['owner', 'repo'])),
      readAction(CANONICAL_INTEGRATION_ACTIONS.githubIssuesSearch, 'Search issues and pull requests', ['repo'], objectSchema({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, ['query'])),
      writeAction(CANONICAL_INTEGRATION_ACTIONS.githubIssuesCreate, 'Create issue', ['repo'], objectSchema({ owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } }, ['owner', 'repo', 'title'])),
      writeAction(CANONICAL_INTEGRATION_ACTIONS.githubPullRequestsComment, 'Comment on pull request', ['repo'], objectSchema({ owner: { type: 'string' }, repo: { type: 'string' }, pullNumber: { type: 'integer' }, body: { type: 'string' } }, ['owner', 'repo', 'pullNumber', 'body'])),
    ],
    metadata: { source: 'canonical-launch', supportTier: 'setupReady' },
  }
}

function slackConnector(providerId: string): IntegrationConnector {
  return {
    id: 'slack',
    providerId,
    title: 'Slack',
    category: 'chat',
    auth: 'oauth2',
    scopes: ['channels:read', 'search:read', 'chat:write'],
    actions: [
      readAction(CANONICAL_INTEGRATION_ACTIONS.slackChannelsList, 'List Slack channels', ['channels:read'], objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 200 } })),
      readAction(CANONICAL_INTEGRATION_ACTIONS.slackMessagesSearch, 'Search Slack messages', ['search:read'], objectSchema({ query: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 50 } }, ['query'])),
      writeAction(CANONICAL_INTEGRATION_ACTIONS.slackMessagesPost, 'Post Slack message', ['chat:write'], objectSchema({ channel: { type: 'string' }, text: { type: 'string' }, blocks: { type: 'array' } }, ['channel', 'text'])),
    ],
    triggers: [trigger('slack.message.posted', 'Slack message posted', ['channels:read'])],
    metadata: { source: 'canonical-launch', supportTier: 'setupReady' },
  }
}

function readAction(id: string, title: string, scopes: string[], inputSchema: unknown): IntegrationConnectorAction {
  return { id, title, risk: 'read', requiredScopes: scopes, dataClass: 'private', inputSchema }
}

function writeAction(id: string, title: string, scopes: string[], inputSchema: unknown): IntegrationConnectorAction {
  return { id, title, risk: 'write', requiredScopes: scopes, dataClass: 'private', approvalRequired: true, inputSchema }
}

function trigger(id: string, title: string, scopes: string[]): IntegrationConnectorTrigger {
  return { id, title, requiredScopes: scopes, dataClass: 'private' }
}

function providerPassthroughAction(connectorId: string): IntegrationConnectorAction {
  return {
    id: CANONICAL_INTEGRATION_ACTIONS.providerHttpRequest,
    title: 'Provider HTTP request',
    risk: 'write',
    requiredScopes: [],
    dataClass: 'sensitive',
    approvalRequired: true,
    description: `Controlled provider-native passthrough for ${connectorId}. Disabled by default by platform policy.`,
    inputSchema: objectSchema({
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      path: { type: 'string' },
      query: { type: 'object' },
      body: { type: 'object' },
    }, ['method', 'path']),
  }
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, required }
}
