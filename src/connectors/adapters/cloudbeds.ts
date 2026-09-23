import { requestJson, record, ProviderProtocolError } from '../../http/response-json.js'
import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type ResolvedDataSource,
  CredentialsExpired,
  ProviderRateLimited,
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

function providerText(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
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
    if (error instanceof ProviderProtocolError && error.status === 429) {
      throw new ProviderRateLimited('Cloudbeds rate limit (429)', source.id,
        { status: 429, retryAfterMs: error.retryAfterMs })
    }
    throw error
  }
  if (record(result) && result.success === false) {
    throw new ProviderProtocolError('Cloudbeds rejected the request', 'provider_rejected', 422, true)
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
    try {
      date(raw.startDate, 'provider startDate')
      date(raw.endDate, 'provider endDate')
    } catch {
      throw new ProviderProtocolError('Cloudbeds returned an invalid reservation date', 'invalid_response')
    }
    return {
      propertyId: property,
      reservationId: raw.reservationID,
      status: raw.status,
      arrivalDate: raw.startDate,
      departureDate: raw.endDate,
      guestName: providerText(raw.guestName),
      balance: typeof raw.balance === 'number' && Number.isFinite(raw.balance) ? raw.balance : null,
    }
  })
  const pageNumber = Number(query.get('pageNumber'))
  const pageSize = Number(query.get('pageSize'))
  return { reservations: items, pageNumber, pageSize, total: result.total, hasMore: pageNumber * pageSize < (result.total as number) }
}

function roomAvailabilityQuery(args: Record<string, unknown>, property: string): URLSearchParams {
  const startDate = date(args.startDate, 'startDate')
  const endDate = date(args.endDate, 'endDate')
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
  if (days < 1 || days > 31) throw new Error('cloudbeds: stay must be between 1 and 31 nights')
  const children = args.children ?? 0
  if (!Number.isSafeInteger(children) || (children as number) < 0 || (children as number) > 20) {
    throw new Error('cloudbeds: invalid children')
  }
  return new URLSearchParams({ propertyIDs: property, startDate, endDate,
    rooms: String(page(args.rooms, 'rooms', 1, 10)), adults: String(page(args.adults, 'adults', 1, 20)),
    children: String(children), pageNumber: String(page(args.pageNumber, 'pageNumber', 1, 100_000)),
    pageSize: String(page(args.pageSize, 'pageSize', 100, 100)), detailedRates: 'false', includeSharedRooms: 'false' })
}

function roomAvailability(result: Record<string, unknown>, property: string, query: URLSearchParams): Record<string, unknown> {
  if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || !Number.isSafeInteger(result.total) ||
      !Number.isSafeInteger(result.roomCount) || (result.count as number) < 0 || (result.count as number) > 1 ||
      (result.total as number) < (result.count as number) || result.count !== result.data.length ||
      (result.roomCount as number) < 0 || (result.count as number) > Number(query.get('pageSize'))) {
    throw new ProviderProtocolError('Cloudbeds returned malformed room availability pagination', 'invalid_response')
  }
  const roomTypes = result.data.flatMap((raw: unknown) => {
    if (!record(raw) || raw.propertyID !== property || !Array.isArray(raw.propertyRooms)) {
      throw new ProviderProtocolError('Cloudbeds returned availability outside the connected property', 'invalid_response')
    }
    return raw.propertyRooms.map((room: unknown) => {
      if (!record(room) || typeof room.roomTypeID !== 'string' || !room.roomTypeID ||
          !Number.isSafeInteger(room.roomsAvailable) || (room.roomsAvailable as number) < 0 ||
          (room.roomRate !== undefined && (typeof room.roomRate !== 'number' || !Number.isFinite(room.roomRate) || room.roomRate < 0))) {
        throw new ProviderProtocolError('Cloudbeds returned malformed room-type availability', 'invalid_response')
      }
      return { roomTypeId: room.roomTypeID, roomTypeName: providerText(room.roomTypeName),
        roomsAvailable: room.roomsAvailable, roomRate: typeof room.roomRate === 'number' ? room.roomRate : null }
    })
  })
  if (roomTypes.length !== result.roomCount) {
    throw new ProviderProtocolError('Cloudbeds returned mismatched room-type count', 'invalid_response')
  }
  return { propertyId: property, startDate: query.get('startDate'), endDate: query.get('endDate'),
    rooms: Number(query.get('rooms')), adults: Number(query.get('adults')), children: Number(query.get('children')),
    roomTypes, pageNumber: Number(query.get('pageNumber')), pageSize: Number(query.get('pageSize')),
    mayHaveMore: Number(query.get('pageNumber')) * Number(query.get('pageSize')) < (result.total as number) }
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
    description: 'Read reservations and room availability for one connected property, then post an approved custom item to a guest folio.',
    auth: { kind: 'api-key', hint: 'Property-scoped Cloudbeds API key with read:reservation, read:room and write:item scopes. Set the connection propertyId.' },
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
        name: 'room-types.available', class: 'read', requiredScopes: ['read:room'],
        description: 'Read provider-reported room-type availability for a stay at the connected property. This does not hold or confirm a booking.',
        parameters: { type: 'object', properties: {
          startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' },
          rooms: { type: 'integer', minimum: 1, maximum: 10 }, adults: { type: 'integer', minimum: 1, maximum: 20 },
          children: { type: 'integer', minimum: 0, maximum: 20 },
          pageNumber: { type: 'integer', minimum: 1, maximum: 100000 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        }, required: ['startDate', 'endDate'] },
      },
      {
        name: 'folio-items.post', class: 'mutation', cas: 'native-idempotency', externalEffect: true,
        requiredScopes: ['read:reservation', 'write:item'],
        description: 'Verify reservation ownership, then post one unpaid custom item to the connected property guest folio. The Hub operation key becomes Cloudbeds referenceID.',
        parameters: { type: 'object', properties: {
          reservationId: { type: 'string', minLength: 1, maxLength: 256 },
          appItemId: { type: 'string', minLength: 1, maxLength: 256 },
          itemName: { type: 'string', minLength: 1, maxLength: 256 },
          itemCategoryName: { type: 'string', minLength: 1, maxLength: 256 },
          itemPrice: { type: 'number', minimum: 0.01, maximum: 1_000_000, multipleOf: 0.01 },
          itemQuantity: { type: 'integer', minimum: 1, maximum: 1000 },
          taxes: { type: 'array', description: 'Explicit tax amounts in the property currency. Use [] only when no tax applies.',
            maxItems: 10, items: { type: 'object', properties: { taxName: { type: 'string', minLength: 1, maxLength: 256 }, taxValue: { type: 'number', minimum: 0, maximum: 1_000_000, multipleOf: 0.01 } }, required: ['taxName', 'taxValue'] } },
        }, required: ['reservationId', 'appItemId', 'itemName', 'itemCategoryName', 'itemPrice', 'taxes'] },
      },
    ],
  },

  async executeRead(inv) {
    const property = propertyId(inv.source)
    if (inv.capabilityName === 'room-types.available') {
      const query = roomAvailabilityQuery(inv.args, property)
      const result = await call(inv.source, `getAvailableRoomTypes?${query}`, { method: 'GET' })
      return { data: roomAvailability(result, property, query), fetchedAt: Date.now() }
    }
    if (inv.capabilityName !== 'reservations.list') throw new Error(`cloudbeds: unknown read ${inv.capabilityName}`)
    const query = reservationQuery(inv.args, property)
    const result = await call(inv.source, `getReservations?${query}`, { method: 'GET' })
    return { data: reservations(result, property, query), fetchedAt: Date.now() }
  },

  async executeMutation(inv) {
    if (inv.capabilityName !== 'folio-items.post') throw new Error(`cloudbeds: unknown mutation ${inv.capabilityName}`)
    const property = propertyId(inv.source)
    const form = formForItem(inv, property)
    const reservationId = form.get('reservationID')!
    const query = new URLSearchParams({ propertyID: property, reservationID: reservationId })
    const reservation = await call(inv.source, `getReservation?${query}`, { method: 'GET' })
    if (!record(reservation.data) || reservation.data.propertyID !== property || reservation.data.reservationID !== reservationId) {
      throw new ProviderProtocolError('Cloudbeds could not verify the reservation belongs to the connected property', 'invalid_response')
    }
    const result = await call(inv.source, 'postCustomItem', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    if (!record(result.data)) {
      throw new ProviderProtocolError('Cloudbeds returned a malformed folio item receipt', 'invalid_response')
    }
    const soldProductId = typeof result.data.soldProductID === 'string' && result.data.soldProductID
      ? result.data.soldProductID : null
    const notice = providerText(result.data.notice)
    const duplicate = soldProductId === null && notice !== null &&
      /referenceid/i.test(notice) && /nothing was created/i.test(notice)
    if (!soldProductId && !duplicate) {
      throw new ProviderProtocolError('Cloudbeds returned an indeterminate folio item receipt', 'capability_outcome_indeterminate')
    }
    return { status: 'committed', data: { referenceId: inv.idempotencyKey,
      soldProductId,
      transactionId: typeof result.data.transactionID === 'string' ? result.data.transactionID : null,
      duplicate, notice },
    committedAt: Date.now(), idempotentReplay: duplicate }
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
