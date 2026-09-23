import { requestJson, record, ProviderProtocolError } from '../../http/response-json.js'
import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type ResolvedDataSource,
  CredentialsExpired,
} from '../types.js'

const API = 'https://api.cloudbeds.com/api/v1.3'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PROPERTY_ID = /^[1-9]\d{0,19}$/
const OPERATION_ID = /^[A-Za-z0-9:._-]{1,128}$/
const STATUSES = new Set(['not_confirmed', 'confirmed', 'canceled', 'checked_in', 'checked_out', 'no_show'])

function boundedString(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`cloudbeds: invalid ${name}`)
  }
  return value
}

function propertyId(source: ResolvedDataSource): string {
  const value = source.metadata.propertyId
  if (typeof value !== 'string' || !PROPERTY_ID.test(value)) {
    throw new Error('cloudbeds: connection requires one numeric propertyId')
  }
  return value
}

function apiKey(source: ResolvedDataSource): string {
  const value = source.credentials
  if (value.kind !== 'api-key' || !value.apiKey || /[\u0000-\u0020\u007f]/.test(value.apiKey)) {
    throw new Error('cloudbeds: connection requires an API key')
  }
  return value.apiKey
}

async function call(source: ResolvedDataSource, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const key = apiKey(source)
  const headers = { 'x-api-key': key, accept: 'application/json', ...init.headers }
  let result: unknown
  try {
    result = await requestJson(`${API}/${path}`, { ...init, headers }, { maxResponseBytes: 2_000_000 })
  } catch (error) {
    if (error instanceof ProviderProtocolError && error.status === 401) {
      throw new CredentialsExpired('Cloudbeds rejected the API key', source.id)
    }
    throw error
  }
  if (!record(result) || result.success !== true) {
    throw new ProviderProtocolError('Cloudbeds returned an unsuccessful or malformed response', 'invalid_response')
  }
  return result
}

function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`cloudbeds: invalid ${label}`)
  }
  return value
}

function page(value: unknown, label: string, fallback: number, max: number): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || (selected as number) < 1 || (selected as number) > max) {
    throw new Error(`cloudbeds: invalid ${label}`)
  }
  return selected as number
}

function money(value: unknown, label: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (allowZero ? 0 : 0.01) ||
      value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new Error(`cloudbeds: invalid ${label}`)
  }
  return value
}

function reservationQuery(args: Record<string, unknown>, property: string): URLSearchParams {
  const query = new URLSearchParams({ propertyID: property })
  const pairs = [['checkInFrom', 'checkInTo'], ['checkOutFrom', 'checkOutTo']] as const
  let found = false
  for (const [fromKey, toKey] of pairs) {
    if (args[fromKey] === undefined && args[toKey] === undefined) continue
    const from = date(args[fromKey], fromKey)
    const to = date(args[toKey], toKey)
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (days < 0 || days > 31) throw new Error('cloudbeds: reservation date range must be at most 31 days')
    query.set(fromKey, from)
    query.set(toKey, to)
    found = true
  }
  if (!found) throw new Error('cloudbeds: an arrival or departure date range is required')
  if (args.status !== undefined) {
    if (typeof args.status !== 'string' || !STATUSES.has(args.status)) throw new Error('cloudbeds: invalid status')
    query.set('status', args.status)
  }
  query.set('pageNumber', String(page(args.pageNumber, 'pageNumber', 1, 100_000)))
  query.set('pageSize', String(page(args.pageSize, 'pageSize', 100, 100)))
  return query
}

function reservations(result: Record<string, unknown>, property: string, query: URLSearchParams): Record<string, unknown> {
  if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || !Number.isSafeInteger(result.total) ||
      (result.count as number) < 0 || (result.total as number) < 0 || result.count !== result.data.length ||
      (result.total as number) < (result.count as number) ||
      (result.count as number) > Number(query.get('pageSize'))) {
    throw new ProviderProtocolError('Cloudbeds returned malformed reservation pagination', 'invalid_response')
  }
  const items = result.data.map((raw: unknown) => {
    if (!record(raw) || raw.propertyID !== property || typeof raw.reservationID !== 'string' || !raw.reservationID ||
        typeof raw.startDate !== 'string' || typeof raw.endDate !== 'string' ||
        typeof raw.status !== 'string' || !STATUSES.has(raw.status)) {
      throw new ProviderProtocolError('Cloudbeds returned a reservation outside the connected property or with invalid fields', 'invalid_response')
    }
    date(raw.startDate, 'provider startDate')
    date(raw.endDate, 'provider endDate')
    return {
      propertyId: property,
      reservationId: raw.reservationID,
      status: raw.status,
      arrivalDate: raw.startDate,
      departureDate: raw.endDate,
      guestName: typeof raw.guestName === 'string' ? raw.guestName : null,
      balance: typeof raw.balance === 'number' && Number.isFinite(raw.balance) ? raw.balance : null,
    }
  })
  const pageNumber = Number(query.get('pageNumber'))
  const pageSize = Number(query.get('pageSize'))
  return { reservations: items, pageNumber, pageSize, total: result.total, hasMore: pageNumber * pageSize < (result.total as number) }
}

function formForItem(inv: ConnectorInvocation, property: string): URLSearchParams {
  const args = inv.args
  const reservationId = boundedString(args.reservationId, 'reservationId')
  const appItemId = boundedString(args.appItemId, 'appItemId')
  const itemName = boundedString(args.itemName, 'itemName')
  const itemCategoryName = boundedString(args.itemCategoryName, 'itemCategoryName')
  const itemPrice = money(args.itemPrice, 'itemPrice')
  const itemQuantity = page(args.itemQuantity, 'itemQuantity', 1, 1_000)
  if (!OPERATION_ID.test(inv.idempotencyKey)) throw new Error('cloudbeds: stable bounded idempotencyKey is required')
  if (!Array.isArray(args.taxes) || args.taxes.length > 10) throw new Error('cloudbeds: explicit taxes array is required')
  const form = new URLSearchParams({
    propertyID: property,
    reservationID: reservationId,
    referenceID: inv.idempotencyKey,
    'items[0][appItemID]': appItemId,
    'items[0][itemName]': itemName,
    'items[0][itemCategoryName]': itemCategoryName,
    'items[0][itemPrice]': itemPrice.toFixed(2),
    'items[0][itemQuantity]': String(itemQuantity),
    itemPaid: 'false',
  })
  args.taxes.forEach((tax: unknown, index: number) => {
    if (!record(tax)) throw new Error('cloudbeds: invalid tax')
    form.set(`items[0][itemTaxes][${index}][taxName]`, boundedString(tax.taxName, 'taxName'))
    form.set(`items[0][itemTaxes][${index}][taxValue]`, money(tax.taxValue, 'taxValue', true).toFixed(2))
  })
  return form
}

export const cloudbedsConnector: ConnectorAdapter = {
  manifest: {
    kind: 'cloudbeds',
    displayName: 'Cloudbeds',
    description: 'Read reservations for one connected property and post an approved custom item to a guest folio.',
    auth: { kind: 'api-key', hint: 'Property-scoped Cloudbeds API key with read:reservation and write:item scopes. Set the connection propertyId.' },
    category: 'other',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'reservations.list', class: 'read', requiredScopes: ['read:reservation'],
        description: 'List one page of arrivals or departures for the connected property. Guest requirements are never requested.',
        parameters: { type: 'object', properties: {
          checkInFrom: { type: 'string', format: 'date' }, checkInTo: { type: 'string', format: 'date' },
          checkOutFrom: { type: 'string', format: 'date' }, checkOutTo: { type: 'string', format: 'date' },
          status: { type: 'string', enum: [...STATUSES] },
          pageNumber: { type: 'integer', minimum: 1, maximum: 100000 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        } },
      },
      {
        name: 'folio-items.post', class: 'mutation', cas: 'native-idempotency', externalEffect: true,
        requiredScopes: ['write:item'],
        description: 'Post one unpaid custom item to the connected property guest folio. The Hub operation key becomes Cloudbeds referenceID.',
        parameters: { type: 'object', properties: {
          reservationId: { type: 'string', minLength: 1 },
          appItemId: { type: 'string', minLength: 1 },
          itemName: { type: 'string', minLength: 1 },
          itemCategoryName: { type: 'string', minLength: 1 },
          itemPrice: { type: 'number', exclusiveMinimum: 0 },
          itemQuantity: { type: 'integer', minimum: 1, maximum: 1000 },
          taxes: { type: 'array', description: 'Explicit tax amounts in the property currency. Use [] only when no tax applies.',
            maxItems: 10, items: { type: 'object', properties: { taxName: { type: 'string' }, taxValue: { type: 'number', minimum: 0 } }, required: ['taxName', 'taxValue'] } },
        }, required: ['reservationId', 'appItemId', 'itemName', 'itemCategoryName', 'itemPrice', 'taxes'] },
      },
    ],
  },

  async executeRead(inv) {
    if (inv.capabilityName !== 'reservations.list') throw new Error(`cloudbeds: unknown read ${inv.capabilityName}`)
    const property = propertyId(inv.source)
    const query = reservationQuery(inv.args, property)
    const result = await call(inv.source, `getReservations?${query}`, { method: 'GET' })
    return { data: reservations(result, property, query), fetchedAt: Date.now() }
  },

  async executeMutation(inv) {
    if (inv.capabilityName !== 'folio-items.post') throw new Error(`cloudbeds: unknown mutation ${inv.capabilityName}`)
    const property = propertyId(inv.source)
    const form = formForItem(inv, property)
    const result = await call(inv.source, 'postCustomItem', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    if (!record(result.data) || (typeof result.data.soldProductID !== 'string' && typeof result.data.notice !== 'string')) {
      throw new ProviderProtocolError('Cloudbeds returned a malformed folio item receipt', 'invalid_response')
    }
    return { status: 'committed', data: { referenceId: inv.idempotencyKey,
      soldProductId: typeof result.data.soldProductID === 'string' ? result.data.soldProductID : null,
      transactionId: typeof result.data.transactionID === 'string' ? result.data.transactionID : null,
      duplicate: typeof result.data.notice === 'string', notice: typeof result.data.notice === 'string' ? result.data.notice : null },
    committedAt: Date.now(), idempotentReplay: false }
  },

  async test(source) {
    try {
      const property = propertyId(source)
      const result = await call(source, `getReservations?${new URLSearchParams({ propertyID: property, status: 'checked_in', pageNumber: '1', pageSize: '1' })}`, { method: 'GET' })
      if (!Array.isArray(result.data)) throw new ProviderProtocolError('Cloudbeds returned malformed reservations', 'invalid_response')
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Cloudbeds connection failed' }
    }
  },
}
