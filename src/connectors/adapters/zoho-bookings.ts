import {
  type CapabilityMutationResult,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
  CredentialsExpired,
  ProviderRateLimited,
  type ResolvedDataSource,
} from '../types.js'

export const zohoBookingsConnector: ConnectorAdapter = {
  manifest: {
    kind: 'zoho-bookings',
    displayName: 'Zoho Bookings',
    description: 'Discover services and staff, check availability, and manage Zoho Bookings appointments.',
    auth: {
      kind: 'oauth2',
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['zohobookings.data.CREATE', 'zohobookings.data.READ'],
      scopeSeparator: ',',
      clientIdEnv: 'ZOHO_OAUTH_CLIENT_ID',
      clientSecretEnv: 'ZOHO_OAUTH_CLIENT_SECRET',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
    category: 'calendar',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      readCapability('workspaces.list', 'List Zoho Bookings workspaces.', {}),
      readCapability('services.list', 'List services, optionally within one workspace.', {
        workspace_id: { type: 'string' },
      }),
      readCapability('resources.list', 'List bookable resources, optionally for one service.', {
        service_id: { type: 'string' },
      }),
      readCapability('staff.list', 'List staff, optionally for one service.', {
        service_id: { type: 'string' },
      }),
      readCapability('appointments.list', 'List appointments from a required start time.', {
        from_time: {
          type: 'string',
          description: 'Zoho timestamp in dd-MMM-yyyy HH:mm:ss format.',
        },
        to_time: { type: 'string' },
        service_id: { type: 'string' },
        staff_id: { type: 'string' },
        status: { type: 'string' },
      }, ['from_time']),
      readCapability('appointments.get', 'Read one appointment by booking id.', {
        booking_id: { type: 'string' },
      }, ['booking_id']),
      readCapability('availability.fetch', 'Fetch open time slots for a service and date.', {
        service_id: { type: 'string' },
        selected_date: { type: 'string', description: 'Date in YYYY-MM-DD format.' },
        staff_id: { type: 'string' },
        group_id: { type: 'string' },
        resource_id: { type: 'string' },
      }, ['service_id', 'selected_date']),
      mutationCapability('appointments.book', 'Book an appointment for a customer.', {
        service_id: { type: 'string' },
        from_time: { type: 'string', description: 'Zoho timestamp in dd-MMM-yyyy HH:mm:ss format.' },
        customer_details: {
          type: 'object',
          description: 'Customer name, email, and phone_number.',
        },
        staff_id: { type: 'string' },
        resource_id: { type: 'string' },
        group_id: { type: 'string' },
        to_time: { type: 'string' },
        timezone: { type: 'string' },
        notes: { type: 'string' },
        additional_fields: { type: 'object' },
        payment_info: { type: 'object' },
      }, ['service_id', 'from_time', 'customer_details']),
      mutationCapability('appointments.reschedule', 'Move an appointment to a new time, staff member, or group.', {
        booking_id: { type: 'string' },
        start_time: { type: 'string', description: 'Zoho timestamp in dd-MMM-yyyy HH:mm:ss format.' },
        staff_id: { type: 'string' },
        group_id: { type: 'string' },
      }, ['booking_id']),
      mutationCapability('appointments.cancel', 'Cancel an appointment by booking id.', {
        booking_id: { type: 'string' },
      }, ['booking_id']),
    ],
  },

  async executeRead(inv): Promise<CapabilityReadResult> {
    let data: unknown
    switch (inv.capabilityName) {
      case 'workspaces.list':
        data = await request(inv.source, '/workspaces', { method: 'GET' })
        break
      case 'services.list':
        data = await request(inv.source, '/services', {
          method: 'GET',
          query: query(inv.args, ['workspace_id']),
        })
        break
      case 'resources.list':
        data = await request(inv.source, '/resources', {
          method: 'GET',
          query: query(inv.args, ['service_id']),
        })
        break
      case 'staff.list':
        data = await request(inv.source, '/staffs', {
          method: 'GET',
          query: query(inv.args, ['service_id']),
        })
        break
      case 'appointments.list': {
        requireString(inv.args, 'from_time')
        const filters = pick(inv.args, ['from_time', 'to_time', 'service_id', 'staff_id', 'status'])
        data = await request(inv.source, '/fetchappointment', {
          method: 'POST',
          body: form({ data: JSON.stringify(filters) }),
        })
        break
      }
      case 'appointments.get':
        data = await request(inv.source, '/getappointment', {
          method: 'GET',
          query: query(inv.args, ['booking_id'], ['booking_id']),
        })
        break
      case 'availability.fetch': {
        requireString(inv.args, 'service_id')
        requireString(inv.args, 'selected_date')
        exactlyOne(inv.args, ['staff_id', 'group_id', 'resource_id'], 'availability target')
        data = await request(inv.source, '/availableslots', {
          method: 'GET',
          query: query(inv.args, ['service_id', 'selected_date', 'staff_id', 'group_id', 'resource_id']),
        })
        break
      }
      default:
        throw new Error(`zoho-bookings: unknown read capability ${inv.capabilityName}`)
    }
    return { data, fetchedAt: Date.now() }
  },

  async executeMutation(inv): Promise<CapabilityMutationResult> {
    let data: unknown
    switch (inv.capabilityName) {
      case 'appointments.book': {
        for (const key of ['service_id', 'from_time'] as const) requireString(inv.args, key)
        const customer = requireObject(inv.args, 'customer_details')
        exactlyOne(inv.args, ['staff_id', 'resource_id', 'group_id'], 'booking assignment')
        const fields = pick(inv.args, [
          'service_id',
          'from_time',
          'staff_id',
          'resource_id',
          'group_id',
          'to_time',
          'timezone',
          'notes',
        ])
        fields.customer_details = JSON.stringify(customer)
        for (const key of ['additional_fields', 'payment_info'] as const) {
          if (inv.args[key] !== undefined) fields[key] = JSON.stringify(requireObject(inv.args, key))
        }
        data = await request(inv.source, '/appointment', { method: 'POST', body: form(fields) })
        break
      }
      case 'appointments.reschedule': {
        requireString(inv.args, 'booking_id')
        exactlyOne(inv.args, ['start_time', 'staff_id', 'group_id'], 'reschedule target')
        data = await request(inv.source, '/rescheduleappointment', {
          method: 'POST',
          body: form(pick(inv.args, ['booking_id', 'start_time', 'staff_id', 'group_id'])),
        })
        break
      }
      case 'appointments.cancel':
        data = await request(inv.source, '/updateappointment', {
          method: 'POST',
          body: form({ booking_id: requireString(inv.args, 'booking_id'), action: 'cancel' }),
        })
        break
      default:
        throw new Error(`zoho-bookings: unknown mutation capability ${inv.capabilityName}`)
    }
    return {
      status: 'committed',
      data,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      await request(source, '/workspaces', { method: 'GET' })
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' }
    }
  },
}

function readCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    requiredScopes: ['zohobookings.data.READ'],
  }
}

function mutationCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: { type: 'object', properties, required },
    cas: 'native-idempotency' as const,
    externalEffect: true,
    requiredScopes: ['zohobookings.data.CREATE'],
  }
}

const locations = new Map([
  ['zoho.com', 'com'],
  ['zoho.eu', 'eu'],
  ['zoho.in', 'in'],
  ['zoho.com.au', 'com.au'],
  ['zoho.jp', 'jp'],
  ['zoho.com.cn', 'com.cn'],
  ['zohocloud.ca', 'ca'],
])

function baseUrl(source: ResolvedDataSource): string {
  const location = typeof source.metadata.zohoLocation === 'string'
    ? source.metadata.zohoLocation
    : 'zoho.com'
  const tld = locations.get(location)
  if (!tld) throw new Error('zoho-bookings: zohoLocation is not an allowed Zoho data center')
  return `https://www.zohoapis.${tld}/bookings/v1/json`
}

function accessToken(source: ResolvedDataSource): string {
  if (source.credentials.kind !== 'oauth2' || !source.credentials.accessToken) {
    throw new Error('zoho-bookings: OAuth2 credentials required')
  }
  return source.credentials.accessToken
}

async function request(
  source: ResolvedDataSource,
  path: string,
  options:
    | { method: 'GET'; query?: URLSearchParams }
    | { method: 'POST'; body: URLSearchParams },
): Promise<unknown> {
  const url = new URL(`${baseUrl(source)}${path}`)
  if ('query' in options && options.query) url.search = options.query.toString()
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
    throw new CredentialsExpired('Zoho Bookings rejected OAuth credentials (401)', source.id, {
      status: 401,
      body: responseBody,
    })
  }
  if (response.status === 429) {
    throw new ProviderRateLimited('Zoho Bookings rate limit (429)', source.id, {
      status: 429,
      body: responseBody,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    })
  }
  if (!response.ok) throw new Error(`zoho-bookings ${options.method} ${path} HTTP ${response.status}`)
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

function query(
  args: Record<string, unknown>,
  keys: readonly string[],
  required: readonly string[] = [],
): URLSearchParams {
  for (const key of required) requireString(args, key)
  return form(pick(args, keys))
}

function form(values: Record<string, unknown>): URLSearchParams {
  const result = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') result.set(key, String(value))
  }
  return result
}

function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]))
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) throw new Error(`zoho-bookings: ${key} is required`)
  return value
}

function requireObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`zoho-bookings: ${key} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactlyOne(args: Record<string, unknown>, keys: readonly string[], label: string): void {
  const present = keys.filter((key) => args[key] !== undefined && args[key] !== null && args[key] !== '')
  if (present.length !== 1) throw new Error(`zoho-bookings: exactly one ${label} is required`)
}

function retryAfterMs(value: string | null): number {
  if (!value) return 60_000
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1_000, seconds * 1_000) : 60_000
}
