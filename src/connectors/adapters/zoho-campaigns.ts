import {
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
  CredentialsExpired,
  ProviderRateLimited,
  type ResolvedDataSource,
} from '../types.js'

const scopes = ['ZohoCampaigns.campaign.ALL', 'ZohoCampaigns.contact.ALL']

export const zohoCampaignsConnector: ConnectorAdapter = {
  manifest: {
    kind: 'zoho-campaigns',
    displayName: 'Zoho Campaigns',
    description: 'Manage Zoho Campaigns mailing lists, contacts, campaign drafts, and sends.',
    auth: {
      kind: 'oauth2',
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes,
      scopeSeparator: ',',
      clientIdEnv: 'ZOHO_OAUTH_CLIENT_ID',
      clientSecretEnv: 'ZOHO_OAUTH_CLIENT_SECRET',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
    category: 'comms',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'campaigns.list',
        class: 'read',
        description: 'List recent campaigns with optional status and pagination filters.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            fromindex: { type: 'integer', minimum: 1 },
            range: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
        requiredScopes: ['ZohoCampaigns.campaign.ALL'],
      },
      {
        name: 'mailing-lists.list',
        class: 'read',
        description: 'List mailing lists in Zoho Campaigns.',
        parameters: {
          type: 'object',
          properties: {
            fromindex: { type: 'integer', minimum: 1 },
            range: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
        requiredScopes: ['ZohoCampaigns.contact.ALL'],
      },
      {
        name: 'contacts.list',
        class: 'read',
        description: 'List contacts subscribed to one mailing list.',
        parameters: {
          type: 'object',
          properties: {
            listkey: { type: 'string' },
            status: { type: 'string' },
            fromindex: { type: 'integer', minimum: 1 },
            range: { type: 'integer', minimum: 1, maximum: 200 },
          },
          required: ['listkey'],
        },
        requiredScopes: ['ZohoCampaigns.contact.ALL'],
      },
      {
        name: 'contacts.upsert',
        class: 'mutation',
        description: 'Add or update a contact in a mailing list, keyed by email address.',
        parameters: {
          type: 'object',
          properties: {
            listkey: { type: 'string' },
            contactinfo: {
              type: 'object',
              description: 'Contact fields. Email Address is required by Zoho Campaigns.',
            },
            source: { type: 'string' },
            topic_id: { type: 'string' },
          },
          required: ['listkey', 'contactinfo'],
        },
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: ['ZohoCampaigns.contact.ALL'],
      },
      {
        name: 'contacts.unsubscribe',
        class: 'mutation',
        description: 'Unsubscribe a contact from a mailing list.',
        parameters: {
          type: 'object',
          properties: {
            listkey: { type: 'string' },
            contactinfo: {
              type: 'object',
              description: 'Contact identifier fields, normally Email Address.',
            },
            topic_id: { type: 'string' },
          },
          required: ['listkey', 'contactinfo'],
        },
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: ['ZohoCampaigns.contact.ALL'],
      },
      {
        name: 'campaigns.create',
        class: 'mutation',
        description: 'Create a draft campaign targeting one or more mailing lists.',
        parameters: {
          type: 'object',
          properties: {
            campaignname: { type: 'string' },
            subject: { type: 'string' },
            from_name: { type: 'string' },
            from_email: { type: 'string' },
            reply_to: { type: 'string' },
            list_details: {
              type: 'object',
              description: 'Map of mailing-list key to segment keys; use an empty array for the full list.',
            },
            topicId: { type: 'string' },
            content_url: { type: 'string' },
            email_content: { type: 'string' },
          },
          required: ['campaignname', 'subject', 'from_name', 'from_email', 'list_details'],
        },
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: ['ZohoCampaigns.campaign.ALL'],
      },
      {
        name: 'campaigns.clone',
        class: 'mutation',
        description: 'Clone an existing campaign into a new draft.',
        parameters: {
          type: 'object',
          properties: {
            campaigninfo: {
              type: 'object',
              description: 'Zoho clone payload, including campaign key and new campaign name.',
            },
          },
          required: ['campaigninfo'],
        },
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: ['ZohoCampaigns.campaign.ALL'],
      },
      {
        name: 'campaigns.send',
        class: 'mutation',
        description: 'Send an existing draft campaign to its configured recipients.',
        parameters: {
          type: 'object',
          properties: { campaignkey: { type: 'string' } },
          required: ['campaignkey'],
        },
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: ['ZohoCampaigns.campaign.ALL'],
      },
    ],
  },

  async executeRead(inv): Promise<CapabilityReadResult> {
    const query = new URLSearchParams({ resfmt: 'JSON' })
    let path: string
    switch (inv.capabilityName) {
      case 'campaigns.list':
        path = '/recentcampaigns'
        append(query, inv.args, ['status', 'fromindex', 'range'])
        break
      case 'mailing-lists.list':
        path = '/getmailinglists'
        append(query, inv.args, ['fromindex', 'range'])
        break
      case 'contacts.list':
        path = '/getlistsubscribers'
        requireString(inv.args, 'listkey')
        append(query, inv.args, ['listkey', 'status', 'fromindex', 'range'])
        break
      default:
        throw new Error(`zoho-campaigns: unknown read capability ${inv.capabilityName}`)
    }
    return {
      data: await request(inv.source, path, { method: 'GET', query }),
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    const form = new URLSearchParams({ resfmt: 'JSON' })
    let path: string
    switch (inv.capabilityName) {
      case 'contacts.upsert':
        path = '/json/listsubscribe'
        form.set('listkey', requireString(inv.args, 'listkey'))
        form.set('contactinfo', JSON.stringify(requireObject(inv.args, 'contactinfo')))
        append(form, inv.args, ['source', 'topic_id'])
        break
      case 'contacts.unsubscribe':
        path = '/json/listunsubscribe'
        form.set('listkey', requireString(inv.args, 'listkey'))
        form.set('contactinfo', JSON.stringify(requireObject(inv.args, 'contactinfo')))
        append(form, inv.args, ['topic_id'])
        break
      case 'campaigns.create':
        path = '/createCampaign'
        for (const key of ['campaignname', 'subject', 'from_name', 'from_email'] as const) {
          form.set(key, requireString(inv.args, key))
        }
        form.set('list_details', JSON.stringify(requireObject(inv.args, 'list_details')))
        append(form, inv.args, ['reply_to', 'topicId', 'content_url', 'email_content'])
        break
      case 'campaigns.clone':
        path = '/json/clonecampaign'
        form.set('campaigninfo', JSON.stringify(requireObject(inv.args, 'campaigninfo')))
        break
      case 'campaigns.send':
        path = '/sendcampaign'
        form.set('campaignkey', requireString(inv.args, 'campaignkey'))
        break
      default:
        throw new Error(`zoho-campaigns: unknown mutation capability ${inv.capabilityName}`)
    }
    const response = await request(inv.source, path, { method: 'POST', body: form })
    return {
      status: 'committed',
      data: response,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      const query = new URLSearchParams({ resfmt: 'JSON', range: '1' })
      await request(source, '/recentcampaigns', { method: 'GET', query })
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
    }
  },
}

const locations = new Set([
  'zoho.com',
  'zoho.eu',
  'zoho.in',
  'zoho.com.au',
  'zoho.jp',
  'zoho.com.cn',
  'zohocloud.ca',
])

function baseUrl(source: ResolvedDataSource): string {
  const requested = typeof source.metadata.zohoLocation === 'string'
    ? source.metadata.zohoLocation
    : 'zoho.com'
  if (!locations.has(requested)) {
    throw new Error('zoho-campaigns: zohoLocation is not an allowed Zoho data center')
  }
  return `https://campaigns.${requested}/api/v1.1`
}

function accessToken(source: ResolvedDataSource): string {
  if (source.credentials.kind !== 'oauth2' || !source.credentials.accessToken) {
    throw new Error('zoho-campaigns: OAuth2 credentials required')
  }
  return source.credentials.accessToken
}

async function request(
  source: ResolvedDataSource,
  path: string,
  options: { method: 'GET'; query: URLSearchParams } | { method: 'POST'; body: URLSearchParams },
): Promise<unknown> {
  const url = new URL(`${baseUrl(source)}${path}`)
  if ('query' in options) url.search = options.query.toString()
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken(source)}`,
      ...('body' in options ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: 'body' in options ? options.body : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const responseBody = await readBody(response)
  if (response.status === 401) {
    throw new CredentialsExpired('Zoho Campaigns rejected OAuth credentials (401)', source.id, {
      status: 401,
      body: responseBody,
    })
  }
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    throw new ProviderRateLimited('Zoho Campaigns rate limit (429)', source.id, {
      status: 429,
      body: responseBody,
      retryAfterMs,
    })
  }
  if (!response.ok) {
    throw new Error(`zoho-campaigns ${options.method} ${path} HTTP ${response.status}`)
  }
  return responseBody
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function append(query: URLSearchParams, args: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const value = args[key]
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`zoho-campaigns: ${key} is required`)
  return value
}

function requireObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`zoho-campaigns: ${key} must be an object`)
  }
  return value as Record<string, unknown>
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 60_000
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 60_000
}
