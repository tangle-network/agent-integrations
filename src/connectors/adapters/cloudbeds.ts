import { requestJson, record, ProviderProtocolError } from '../../http/response-json.js'
import {
  type CapabilityMutationResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
  type ResolvedDataSource,
  CredentialsExpired,
  ProviderRateLimited,
} from '../types.js'

// Every operation below is pinned to the Cloudbeds PMS API v1.3 OpenAPI spec:
// https://github.com/cloudbeds/openapi-specs/blob/main/src/pms-v1.3-openapi.yaml
const API = 'https://api.cloudbeds.com/api/v1.3'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PROPERTY_ID = /^[1-9]\d{0,19}$/
const OPERATION_ID = /^[A-Za-z0-9:._-]{1,128}$/
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,64}$/
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/
const STATUSES = new Set(['not_confirmed', 'confirmed', 'canceled', 'checked_in', 'checked_out', 'no_show'])
const ROOM_CONDITIONS = new Set(['clean', 'dirty'])
// getHousekeepingStatus documents clean/dirty; postHousekeepingStatus also
// documents `inspected` for properties with that feature, so reads accept it.
const REPORTED_ROOM_CONDITIONS = new Set(['clean', 'dirty', 'inspected'])
const FRONTDESK_STATUSES = new Set(['check-in', 'check-out', 'stayover', 'turnover', 'unused'])

/**
 * Webhook events the connector subscribes to and the Cloudbeds webhook provider
 * parses. All five are `read:reservation` events in the Cloudbeds webhook guide.
 * `reservation/status_changed` carries created-to-confirmed, `canceled`,
 * `checked_in`, and `checked_out` transitions.
 */
export const CLOUDBEDS_WEBHOOK_EVENTS = [
  { object: 'reservation', action: 'created' },
  { object: 'reservation', action: 'status_changed' },
  { object: 'reservation', action: 'dates_changed' },
  { object: 'reservation', action: 'accommodation_changed' },
  { object: 'reservation', action: 'deleted' },
] as const

function boundedString(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`cloudbeds: invalid ${name}`)
  }
  return value
}

function providerId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !PROVIDER_ID.test(value)) throw new Error(`cloudbeds: invalid ${name}`)
  return value
}

function providerText(value: unknown, max = 256): string | null {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    (max > 256 || !/[\n\r\t]/.test(value)) ? value : null
}

function providerNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function providerCount(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : value
  return Number.isSafeInteger(parsed) && (parsed as number) >= 0 ? parsed as number : null
}

function malformed(what: string): never {
  throw new ProviderProtocolError(`Cloudbeds returned malformed ${what}`, 'invalid_response')
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
  if (value.kind !== 'api-key' || !value.apiKey || /[\u0000- \u007f]/.test(value.apiKey)) {
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

const form = (body: URLSearchParams): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(),
})

function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`cloudbeds: invalid ${label}`)
  }
  return value
}

function providerDate(value: unknown): string {
  try {
    return date(value, 'provider date')
  } catch {
    throw new ProviderProtocolError('Cloudbeds returned an invalid reservation date', 'invalid_response')
  }
}

function nights(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
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

function pagination(result: Record<string, unknown>, pageSize: number, what: string): unknown[] {
  if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || !Number.isSafeInteger(result.total) ||
      (result.count as number) < 0 || (result.total as number) < 0 || result.count !== result.data.length ||
      (result.total as number) < (result.count as number) || (result.count as number) > pageSize) {
    malformed(`${what} pagination`)
  }
  return result.data
}

function distinct(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))]
}

// GET /getReservations (security read:reservation).
function reservationQuery(args: Record<string, unknown>, property: string): URLSearchParams {
  const query = new URLSearchParams({ propertyID: property })
  const pairs = [['checkInFrom', 'checkInTo'], ['checkOutFrom', 'checkOutTo']] as const
  let found = false
  for (const [fromKey, toKey] of pairs) {
    if (args[fromKey] === undefined && args[toKey] === undefined) continue
    const from = date(args[fromKey], fromKey)
    const to = date(args[toKey], toKey)
    const days = nights(from, to)
    if (days < 0 || days > 31) throw new Error('cloudbeds: reservation date range must be at most 31 days')
    query.set(fromKey, from)
    query.set(toKey, to)
    found = true
  }
  if (args.status !== undefined) {
    if (typeof args.status !== 'string' || !STATUSES.has(args.status)) throw new Error('cloudbeds: invalid status')
    query.set('status', args.status)
  }
  // In-house guests are bounded by the property's rooms, so `checked_in` alone is allowed.
  if (!found && args.status !== 'checked_in') {
    throw new Error('cloudbeds: an arrival or departure date range is required unless status is checked_in')
  }
  query.set('includeAllRooms', 'true')
  query.set('pageNumber', String(page(args.pageNumber, 'pageNumber', 1, 100_000)))
  query.set('pageSize', String(page(args.pageSize, 'pageSize', 100, 100)))
  return query
}

function reservationRooms(raw: unknown): { roomTypeIds: string[]; roomIds: string[]; roomNames: string[] } {
  if (raw === undefined || raw === null) return { roomTypeIds: [], roomIds: [], roomNames: [] }
  if (!Array.isArray(raw)) malformed('reservation rooms')
  const rooms = raw.map((room: unknown) => {
    if (!record(room) || typeof room.roomTypeID !== 'string' || !PROVIDER_ID.test(room.roomTypeID) ||
        (room.roomID !== undefined && room.roomID !== null && (typeof room.roomID !== 'string' || !PROVIDER_ID.test(room.roomID))) ||
        (room.roomName !== undefined && room.roomName !== null && providerText(room.roomName) === null)) {
      malformed('reservation rooms')
    }
    return { roomTypeId: room.roomTypeID, roomId: typeof room.roomID === 'string' ? room.roomID : null,
      roomName: providerText(room.roomName) }
  })
  return { roomTypeIds: distinct(rooms.map(room => room.roomTypeId)), roomIds: distinct(rooms.map(room => room.roomId)),
    roomNames: distinct(rooms.map(room => room.roomName)) }
}

function reservations(result: Record<string, unknown>, property: string, query: URLSearchParams): Record<string, unknown> {
  const pageSize = Number(query.get('pageSize'))
  const items = pagination(result, pageSize, 'reservation').map((raw: unknown) => {
    if (!record(raw) || raw.propertyID !== property || typeof raw.reservationID !== 'string' || !raw.reservationID ||
        typeof raw.status !== 'string' || !STATUSES.has(raw.status)) {
      throw new ProviderProtocolError('Cloudbeds returned a reservation outside the connected property or with invalid fields', 'invalid_response')
    }
    return {
      propertyId: property,
      reservationId: raw.reservationID,
      status: raw.status,
      arrivalDate: providerDate(raw.startDate),
      departureDate: providerDate(raw.endDate),
      guestId: typeof raw.guestID === 'string' && PROVIDER_ID.test(raw.guestID) ? raw.guestID : null,
      guestName: providerText(raw.guestName),
      balance: providerNumber(raw.balance),
      ...reservationRooms(raw.rooms),
    }
  })
  const pageNumber = Number(query.get('pageNumber'))
  return { reservations: items, pageNumber, pageSize, total: result.total, hasMore: pageNumber * pageSize < (result.total as number) }
}

async function readReservation(source: ResolvedDataSource, property: string, reservationId: string): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ propertyID: property, reservationID: reservationId })
  const result = await call(source, `getReservation?${query}`, { method: 'GET' })
  if (!record(result.data) || result.data.propertyID !== property || result.data.reservationID !== reservationId) {
    throw new ProviderProtocolError('Cloudbeds could not verify the reservation belongs to the connected property', 'invalid_response')
  }
  return result.data
}

function reservationRoom(raw: unknown, assigned: boolean): Record<string, unknown> {
  if (!record(raw) || typeof raw.roomTypeID !== 'string' || !PROVIDER_ID.test(raw.roomTypeID) ||
      (assigned && (typeof raw.roomID !== 'string' || !PROVIDER_ID.test(raw.roomID)))) {
    malformed('reservation rooms')
  }
  return {
    ...(assigned ? { roomId: raw.roomID, roomName: providerText(raw.roomName) } : {}),
    roomTypeId: raw.roomTypeID,
    roomTypeName: providerText(raw.roomTypeName),
    startDate: providerDate(raw.startDate),
    endDate: providerDate(raw.endDate),
    adults: providerCount(raw.adults),
    children: providerCount(raw.children),
  }
}

function balanceDetailed(raw: unknown): Record<string, number | null> | null {
  // The spec declares balanceDetailed as an object or an array of that object.
  const value = Array.isArray(raw) ? (raw.length === 0 ? null : raw.length === 1 ? raw[0] : malformed('balance detail')) : raw
  if (value === null || value === undefined) return null
  if (!record(value)) malformed('balance detail')
  const suggested = typeof value.suggestedDeposit === 'string' && /^-?\d+(\.\d+)?$/.test(value.suggestedDeposit)
    ? Number(value.suggestedDeposit) : providerNumber(value.suggestedDeposit)
  return {
    subTotal: providerNumber(value.subTotal), additionalItems: providerNumber(value.additionalItems),
    taxesFees: providerNumber(value.taxesFees), grandTotal: providerNumber(value.grandTotal),
    paid: providerNumber(value.paid), suggestedDeposit: suggested,
  }
}

// GET /getReservation (security read:reservation). v1.3 has no payments or
// transactions read, so balance and balanceDetailed are the paid/owed source.
function reservationDetail(raw: Record<string, unknown>, property: string): Record<string, unknown> {
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status)) malformed('reservation status')
  if ((raw.assigned !== undefined && !Array.isArray(raw.assigned)) || (raw.unassigned !== undefined && !Array.isArray(raw.unassigned)) ||
      (raw.guestList !== undefined && raw.guestList !== null && !record(raw.guestList))) {
    malformed('reservation detail')
  }
  const assignedRooms = ((raw.assigned ?? []) as unknown[]).map(room => reservationRoom(room, true))
  const unassignedRooms = ((raw.unassigned ?? []) as unknown[]).map(room => reservationRoom(room, false))
  const guests = record(raw.guestList) ? Object.values(raw.guestList) : []
  const mainGuest = guests.find(guest => record(guest) && guest.isMainGuest === true)
  const guestId = record(mainGuest) && typeof mainGuest.guestID === 'string' && PROVIDER_ID.test(mainGuest.guestID)
    ? mainGuest.guestID : null
  const rooms = [...assignedRooms, ...unassignedRooms]
  const sum = (field: 'adults' | 'children') => rooms.every(room => typeof room[field] === 'number')
    ? rooms.reduce((total, room) => total + (room[field] as number), 0) : null
  return {
    propertyId: property,
    reservationId: raw.reservationID,
    status: raw.status,
    arrivalDate: providerDate(raw.startDate),
    departureDate: providerDate(raw.endDate),
    guestId,
    guestName: providerText(raw.guestName),
    adults: sum('adults'),
    children: sum('children'),
    assignedRooms,
    unassignedRooms,
    total: providerNumber(raw.total),
    balance: providerNumber(raw.balance),
    balanceDetailed: balanceDetailed(raw.balanceDetailed),
    source: providerText(raw.source),
    sourceId: providerText(raw.sourceID),
  }
}

// GET /getGuest (security read:guest). The response carries no property or
// guest ID, so the pinned propertyID request parameter is the property bound.
function guestDetail(result: Record<string, unknown>, property: string, guestId: string): Record<string, unknown> {
  const raw = result.data
  if (!record(raw) || (raw.firstName !== undefined && typeof raw.firstName !== 'string') ||
      (raw.lastName !== undefined && typeof raw.lastName !== 'string')) {
    malformed('guest')
  }
  const text = (value: unknown) => providerText(value) || null
  return {
    propertyId: property, guestId,
    firstName: text(raw.firstName), lastName: text(raw.lastName),
    email: text(raw.email), phone: text(raw.phone), cellPhone: text(raw.cellPhone),
    country: text(raw.country), nationality: text(raw.guestNationality),
    isAnonymized: raw.isAnonymized === true,
    mergedIntoGuestId: raw.isMerged === true && typeof raw.newGuestID === 'string' && PROVIDER_ID.test(raw.newGuestID)
      ? raw.newGuestID : null,
  }
}

// GET /getGuestNotes (security read:guest).
function guestNotes(result: Record<string, unknown>, property: string, guestId: string): Record<string, unknown> {
  if (!Array.isArray(result.data)) malformed('guest notes')
  const notes = result.data.map((raw: unknown) => {
    if (!record(raw) || typeof raw.guestNoteID !== 'string' || !PROVIDER_ID.test(raw.guestNoteID) ||
        typeof raw.guestNote !== 'string') {
      malformed('guest notes')
    }
    return { noteId: raw.guestNoteID, note: providerText(raw.guestNote, 4_000), author: providerText(raw.userName),
      createdAt: providerText(raw.dateCreated), modifiedAt: providerText(raw.dateModified) }
  })
  return { propertyId: property, guestId, notes }
}

// GET /getHousekeepingStatus (security read:housekeeping).
function housekeepingQuery(args: Record<string, unknown>, property: string): URLSearchParams {
  const query = new URLSearchParams({ propertyID: property })
  if (args.roomId !== undefined) query.set('roomIDs', providerId(args.roomId, 'roomId'))
  if (args.roomCondition !== undefined) {
    if (typeof args.roomCondition !== 'string' || !ROOM_CONDITIONS.has(args.roomCondition)) throw new Error('cloudbeds: invalid roomCondition')
    query.set('roomCondition', args.roomCondition)
  }
  query.set('pageNumber', String(page(args.pageNumber, 'pageNumber', 1, 100_000)))
  query.set('pageSize', String(page(args.pageSize, 'pageSize', 100, 500)))
  return query
}

function housekeepingRoom(raw: unknown): Record<string, unknown> {
  if (!record(raw) || typeof raw.roomID !== 'string' || !PROVIDER_ID.test(raw.roomID) ||
      typeof raw.roomCondition !== 'string' || !REPORTED_ROOM_CONDITIONS.has(raw.roomCondition) ||
      typeof raw.roomOccupied !== 'boolean' ||
      (raw.doNotDisturb !== undefined && typeof raw.doNotDisturb !== 'boolean') ||
      (raw.roomBlocked !== undefined && typeof raw.roomBlocked !== 'boolean')) {
    malformed('housekeeping status')
  }
  return {
    roomId: raw.roomID,
    roomName: providerText(raw.roomName),
    roomTypeId: typeof raw.roomTypeID === 'string' && PROVIDER_ID.test(raw.roomTypeID) ? raw.roomTypeID : null,
    roomTypeName: providerText(raw.roomTypeName),
    roomCondition: raw.roomCondition,
    roomOccupied: raw.roomOccupied,
    doNotDisturb: raw.doNotDisturb === true,
    roomBlocked: raw.roomBlocked === true,
    frontdeskStatus: typeof raw.frontdeskStatus === 'string' && FRONTDESK_STATUSES.has(raw.frontdeskStatus) ? raw.frontdeskStatus : null,
    housekeeperId: typeof raw.housekeeperID === 'string' && PROVIDER_ID.test(raw.housekeeperID) ? raw.housekeeperID : null,
    housekeeper: providerText(raw.housekeeper) || null,
    conditionDate: typeof raw.date === 'string' && DATE.test(raw.date) ? raw.date : null,
  }
}

function housekeeping(result: Record<string, unknown>, property: string, query: URLSearchParams): Record<string, unknown> {
  const pageSize = Number(query.get('pageSize'))
  const rooms = pagination(result, pageSize, 'housekeeping').map(housekeepingRoom)
  const roomId = query.get('roomIDs')
  if (roomId && rooms.some(room => room.roomId !== roomId)) malformed('housekeeping status for another room')
  const pageNumber = Number(query.get('pageNumber'))
  return { propertyId: property, rooms, pageNumber, pageSize, total: result.total, hasMore: pageNumber * pageSize < (result.total as number) }
}

// GET /getRatePlans (security read:rate).
function ratePlanQuery(args: Record<string, unknown>, property: string): URLSearchParams {
  const startDate = date(args.startDate, 'startDate')
  const endDate = date(args.endDate, 'endDate')
  const days = nights(startDate, endDate)
  if (days < 1 || days > 31) throw new Error('cloudbeds: stay must be between 1 and 31 nights')
  const query = new URLSearchParams({ propertyIDs: property, startDate, endDate, detailedRates: 'false' })
  if (args.roomTypeId !== undefined) query.set('roomTypeID', providerId(args.roomTypeId, 'roomTypeId'))
  return query
}

function ratePlans(result: Record<string, unknown>, property: string, query: URLSearchParams): Record<string, unknown> {
  if (!Array.isArray(result.data) || result.data.length > 2_000) malformed('rate plans')
  const roomTypeId = query.get('roomTypeID')
  const rates = result.data.map((raw: unknown) => {
    if (!record(raw) || (raw.propertyID !== undefined && raw.propertyID !== null && String(raw.propertyID) !== property)) {
      throw new ProviderProtocolError('Cloudbeds returned a rate outside the connected property', 'invalid_response')
    }
    if (typeof raw.rateID !== 'string' || !PROVIDER_ID.test(raw.rateID) ||
        (raw.roomRate !== undefined && providerNumber(raw.roomRate) === null) ||
        (raw.totalRate !== undefined && providerNumber(raw.totalRate) === null) ||
        (raw.roomsAvailable !== undefined && (!Number.isSafeInteger(raw.roomsAvailable) || (raw.roomsAvailable as number) < 0))) {
      malformed('rate plans')
    }
    const rowRoomType = typeof raw.roomTypeID === 'string' && PROVIDER_ID.test(raw.roomTypeID) ? raw.roomTypeID : roomTypeId
    if (roomTypeId && rowRoomType !== roomTypeId) malformed('rate plans for another room type')
    return {
      rateId: raw.rateID,
      ratePlanId: typeof raw.ratePlanID === 'string' && PROVIDER_ID.test(raw.ratePlanID) ? raw.ratePlanID : null,
      ratePlanName: providerText(raw.ratePlanNamePublic) || null,
      roomTypeId: rowRoomType,
      // The spec types roomTypeName as an integer; accept the string providers send.
      roomTypeName: providerText(typeof raw.roomTypeName === 'number' ? String(raw.roomTypeName) : raw.roomTypeName),
      roomRate: providerNumber(raw.roomRate),
      totalRate: providerNumber(raw.totalRate),
      roomsAvailable: typeof raw.roomsAvailable === 'number' ? raw.roomsAvailable : null,
      isDerived: raw.isDerived === true,
    }
  })
  return { propertyId: property, startDate: query.get('startDate'), endDate: query.get('endDate'), rates }
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

// POST /postCustomItem (security write:item), after GET /getReservation.
async function postFolioItem(inv: ConnectorInvocation, property: string): Promise<CapabilityMutationResult> {
  const body = formForItem(inv, property)
  await readReservation(inv.source, property, body.get('reservationID')!)
  const result = await call(inv.source, 'postCustomItem', form(body))
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
}

// POST /postHousekeepingStatus (security write:housekeeping), after GET
// /getHousekeepingStatus proves the room belongs to the connected property.
// Cloudbeds toggles the condition when none is sent, so one is always required.
async function updateHousekeeping(inv: ConnectorInvocation, property: string): Promise<CapabilityMutationResult> {
  const roomId = providerId(inv.args.roomId, 'roomId')
  const roomCondition = inv.args.roomCondition
  if (typeof roomCondition !== 'string' || !ROOM_CONDITIONS.has(roomCondition)) throw new Error('cloudbeds: invalid roomCondition')
  if (inv.args.doNotDisturb !== undefined && typeof inv.args.doNotDisturb !== 'boolean') throw new Error('cloudbeds: invalid doNotDisturb')
  const query = new URLSearchParams({ propertyID: property, roomIDs: roomId, pageNumber: '1', pageSize: '1' })
  const current = housekeeping(await call(inv.source, `getHousekeepingStatus?${query}`, { method: 'GET' }), property, query)
  const before = (current.rooms as Array<Record<string, unknown>>)[0]
  if (!before) throw new Error('cloudbeds: room is not part of the connected property')
  const body = new URLSearchParams({ propertyID: property, roomID: roomId, roomCondition })
  if (typeof inv.args.doNotDisturb === 'boolean') body.set('doNotDisturb', String(inv.args.doNotDisturb))
  const result = await call(inv.source, 'postHousekeepingStatus', form(body))
  if (!record(result.data) || result.data.roomID !== roomId || result.data.roomCondition !== roomCondition ||
      (typeof inv.args.doNotDisturb === 'boolean' && result.data.doNotDisturb !== undefined && result.data.doNotDisturb !== null &&
        result.data.doNotDisturb !== inv.args.doNotDisturb)) {
    throw new ProviderProtocolError('Cloudbeds returned an indeterminate housekeeping receipt', 'capability_outcome_indeterminate')
  }
  return { status: 'committed', committedAt: Date.now(), idempotentReplay: false, data: {
    propertyId: property, roomId, roomCondition, previousCondition: before.roomCondition,
    doNotDisturb: typeof result.data.doNotDisturb === 'boolean' ? result.data.doNotDisturb : before.doNotDisturb,
  } }
}

// GET /getWebhooks. Webhook endpoints declare no scope; the subscribed event's
// object scope applies (read:reservation for every allowed event).
async function listWebhooks(source: ResolvedDataSource, property: string): Promise<Array<Record<string, unknown>>> {
  const result = await call(source, `getWebhooks?${new URLSearchParams({ propertyID: property })}`, { method: 'GET' })
  if (!Array.isArray(result.data) || result.data.length > 1_000) malformed('webhook subscriptions')
  return result.data.map((raw: unknown) => {
    if (!record(raw) || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.id) || !record(raw.event) ||
        (raw.key !== undefined && raw.key !== null && !record(raw.key))) {
      malformed('webhook subscriptions')
    }
    if (record(raw.key) && raw.key.type === 'property' && String(raw.key.id) !== property) {
      throw new ProviderProtocolError('Cloudbeds returned a webhook subscription outside the connected property', 'invalid_response')
    }
    const data = record(raw.subscriptionData) ? raw.subscriptionData : {}
    return {
      subscriptionId: raw.id,
      object: providerText(raw.event.entity),
      action: providerText(raw.event.action),
      endpointUrl: providerText(data.endpoint ?? data.url, 2_048),
      authHeaderName: record(raw.authHeader) ? providerText(raw.authHeader.name) : null,
    }
  })
}

function webhookEndpoint(value: unknown): string {
  const text = boundedString(value, 'endpointUrl', 2_048)
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('cloudbeds: invalid endpointUrl')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('cloudbeds: endpointUrl must be an https URL without credentials or fragment')
  }
  return text
}

function redact(error: unknown, secret: string | null): unknown {
  if (secret && error instanceof Error && error.message.includes(secret)) {
    error.message = error.message.split(secret).join('[redacted]')
  }
  return error
}

// POST /postWebhook, after GET /getWebhooks. A matching subscription is reused
// unless an auth header is supplied, which Cloudbeds rotates on re-post.
async function subscribeWebhook(inv: ConnectorInvocation, property: string): Promise<CapabilityMutationResult> {
  const args = inv.args
  const event = CLOUDBEDS_WEBHOOK_EVENTS.find(item => item.object === args.object && item.action === args.action)
  if (!event) throw new Error('cloudbeds: unsupported webhook event')
  const endpointUrl = webhookEndpoint(args.endpointUrl)
  if ((args.authHeaderName === undefined) !== (args.authHeaderValue === undefined)) {
    throw new Error('cloudbeds: authHeaderName and authHeaderValue must be sent together')
  }
  let authHeaderName: string | null = null
  let authHeaderValue: string | null = null
  if (args.authHeaderName !== undefined) {
    if (typeof args.authHeaderName !== 'string' || !HEADER_NAME.test(args.authHeaderName)) throw new Error('cloudbeds: invalid authHeaderName')
    if (typeof args.authHeaderValue !== 'string' || !/^[!-~](?:[ -~]{0,1022}[!-~])?$/.test(args.authHeaderValue)) {
      throw new Error('cloudbeds: invalid authHeaderValue')
    }
    authHeaderName = args.authHeaderName
    authHeaderValue = args.authHeaderValue
  }
  try {
    const existing = (await listWebhooks(inv.source, property)).find(row =>
      row.object === event.object && row.action === event.action && row.endpointUrl === endpointUrl)
    const receipt = { propertyId: property, object: event.object, action: event.action, endpointUrl, authHeaderName }
    if (existing && authHeaderValue === null) {
      return { status: 'committed', committedAt: Date.now(), idempotentReplay: true,
        data: { ...receipt, subscriptionId: existing.subscriptionId, authHeaderName: existing.authHeaderName, existing: true } }
    }
    const body = new URLSearchParams({ propertyID: property, object: event.object, action: event.action, endpointUrl })
    if (authHeaderName && authHeaderValue) {
      body.set('authHeaderName', authHeaderName)
      body.set('authHeaderValue', authHeaderValue)
    }
    const result = await call(inv.source, 'postWebhook', form(body))
    if (!record(result.data) || typeof result.data.subscriptionID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.data.subscriptionID)) {
      throw new ProviderProtocolError('Cloudbeds returned an indeterminate webhook subscription receipt', 'capability_outcome_indeterminate')
    }
    return { status: 'committed', committedAt: Date.now(), idempotentReplay: false,
      data: { ...receipt, subscriptionId: result.data.subscriptionID, existing: existing !== undefined } }
  } catch (error) {
    throw redact(error, authHeaderValue)
  }
}

// DELETE /deleteWebhook, after GET /getWebhooks proves the subscription is visible to this property.
async function deleteWebhook(inv: ConnectorInvocation, property: string): Promise<CapabilityMutationResult> {
  const subscriptionId = inv.args.subscriptionId
  if (typeof subscriptionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(subscriptionId)) throw new Error('cloudbeds: invalid subscriptionId')
  const existing = (await listWebhooks(inv.source, property)).find(row => row.subscriptionId === subscriptionId)
  if (!existing) {
    return { status: 'committed', committedAt: Date.now(), idempotentReplay: true,
      data: { propertyId: property, subscriptionId, deleted: false, alreadyAbsent: true } }
  }
  await call(inv.source, `deleteWebhook?${new URLSearchParams({ propertyIDs: property, subscriptionID: subscriptionId })}`, { method: 'DELETE' })
  return { status: 'committed', committedAt: Date.now(), idempotentReplay: false,
    data: { propertyId: property, subscriptionId, deleted: true, alreadyAbsent: false } }
}

const PAGE = {
  pageNumber: { type: 'integer', minimum: 1, maximum: 100000 },
  pageSize: { type: 'integer', minimum: 1, maximum: 100 },
} as const
const ID = { type: 'string', pattern: PROVIDER_ID.source } as const
const STAY = { startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' } } as const

export const cloudbedsConnector: ConnectorAdapter = {
  manifest: {
    kind: 'cloudbeds',
    displayName: 'Cloudbeds',
    description: 'Read reservations, guests, housekeeping, rates and room availability for one connected property, update room condition, manage reservation webhooks, and post an approved custom item to a guest folio.',
    auth: { kind: 'api-key', hint: 'Property-scoped Cloudbeds API key with read:reservation, read:room, read:guest, read:housekeeping, write:housekeeping, read:rate and write:item scopes. Set the connection propertyId.' },
    category: 'other',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'reservations.list', class: 'read', requiredScopes: ['read:reservation'],
        description: 'List one page of arrivals, departures, or in-house guests (status checked_in with no dates) for the connected property, with room type, room ID and room name lists. Guest requirements are never requested.',
        parameters: { type: 'object', properties: {
          checkInFrom: { type: 'string', format: 'date' }, checkInTo: { type: 'string', format: 'date' },
          checkOutFrom: { type: 'string', format: 'date' }, checkOutTo: { type: 'string', format: 'date' },
          status: { type: 'string', enum: [...STATUSES] },
          ...PAGE,
        } },
      },
      {
        name: 'reservations.get', class: 'read', requiredScopes: ['read:reservation'],
        description: 'Read one reservation of the connected property: status, stay dates, main guest, assigned and unassigned rooms, guest counts, source, total, balance and balanceDetailed (paid and owed amounts; Cloudbeds v1.3 has no payments read).',
        parameters: { type: 'object', properties: { reservationId: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['reservationId'] },
      },
      {
        name: 'guests.get', class: 'read', requiredScopes: ['read:guest'],
        description: 'Read one guest\'s name, email, phone, country and nationality at the connected property. Identity documents, address and birth date are never returned.',
        parameters: { type: 'object', properties: { guestId: ID }, required: ['guestId'] },
      },
      {
        name: 'guests.notes', class: 'read', requiredScopes: ['read:guest'],
        description: 'Read staff notes on one guest at the connected property.',
        parameters: { type: 'object', properties: { guestId: ID }, required: ['guestId'] },
      },
      {
        name: 'housekeeping.status', class: 'read', requiredScopes: ['read:housekeeping'],
        description: 'Read today\'s housekeeping status for the connected property: room condition, occupancy, do-not-disturb, front-desk status and housekeeper.',
        parameters: { type: 'object', properties: {
          roomId: ID, roomCondition: { type: 'string', enum: [...ROOM_CONDITIONS] },
          pageNumber: PAGE.pageNumber, pageSize: { type: 'integer', minimum: 1, maximum: 500 },
        } },
      },
      {
        name: 'housekeeping.update', class: 'mutation', cas: 'optimistic-read-verify', externalEffect: false,
        requiredScopes: ['read:housekeeping', 'write:housekeeping'],
        description: 'Verify the room belongs to the connected property, then set today\'s room condition to clean or dirty and optionally do-not-disturb. Setting an explicit condition is idempotent.',
        parameters: { type: 'object', properties: {
          roomId: ID, roomCondition: { type: 'string', enum: [...ROOM_CONDITIONS] }, doNotDisturb: { type: 'boolean' },
        }, required: ['roomId', 'roomCondition'] },
      },
      {
        name: 'rate-plans.list', class: 'read', requiredScopes: ['read:rate'],
        description: 'Read publicly sellable rate plans and stay rates for 1 to 31 nights at the connected property, optionally for one room type. This does not hold or price a booking.',
        parameters: { type: 'object', properties: { ...STAY, roomTypeId: ID }, required: ['startDate', 'endDate'] },
      },
      {
        name: 'room-types.available', class: 'read', requiredScopes: ['read:room'],
        description: 'Read provider-reported room-type availability for a stay at the connected property. This does not hold or confirm a booking.',
        parameters: { type: 'object', properties: {
          ...STAY,
          rooms: { type: 'integer', minimum: 1, maximum: 10 }, adults: { type: 'integer', minimum: 1, maximum: 20 },
          children: { type: 'integer', minimum: 0, maximum: 20 },
          ...PAGE,
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
      {
        name: 'webhooks.subscribe', class: 'mutation', cas: 'optimistic-read-verify', externalEffect: true, requiredScopes: ['read:reservation'],
        description: 'Subscribe an https endpoint to one reservation event for the connected property, reusing a matching subscription. An optional auth header is sent by Cloudbeds on every delivery and is never returned.',
        parameters: { type: 'object', properties: {
          object: { type: 'string', enum: ['reservation'] },
          action: { type: 'string', enum: CLOUDBEDS_WEBHOOK_EVENTS.map(event => event.action) },
          endpointUrl: { type: 'string', format: 'uri', maxLength: 2048 },
          authHeaderName: { type: 'string', pattern: HEADER_NAME.source },
          authHeaderValue: { type: 'string', minLength: 1, maxLength: 1024 },
        }, required: ['object', 'action', 'endpointUrl'] },
      },
      {
        name: 'webhooks.list', class: 'read', requiredScopes: ['read:reservation'],
        description: 'List webhook subscriptions visible to the connected property. Auth header values are never returned.',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'webhooks.delete', class: 'mutation', cas: 'optimistic-read-verify', externalEffect: true, requiredScopes: ['read:reservation'],
        description: 'Delete one webhook subscription after confirming it is visible to the connected property. A missing subscription is reported as already absent.',
        parameters: { type: 'object', properties: { subscriptionId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' } }, required: ['subscriptionId'] },
      },
    ],
  },

  async executeRead(inv) {
    const property = propertyId(inv.source)
    const read = async (path: string) => call(inv.source, path, { method: 'GET' })
    let data: Record<string, unknown>
    switch (inv.capabilityName) {
      case 'reservations.list': {
        const query = reservationQuery(inv.args, property)
        data = reservations(await read(`getReservations?${query}`), property, query)
        break
      }
      case 'reservations.get': {
        const reservationId = boundedString(inv.args.reservationId, 'reservationId')
        data = reservationDetail(await readReservation(inv.source, property, reservationId), property)
        break
      }
      case 'guests.get': {
        const guestId = providerId(inv.args.guestId, 'guestId')
        data = guestDetail(await read(`getGuest?${new URLSearchParams({ propertyID: property, guestID: guestId })}`), property, guestId)
        break
      }
      case 'guests.notes': {
        const guestId = providerId(inv.args.guestId, 'guestId')
        data = guestNotes(await read(`getGuestNotes?${new URLSearchParams({ propertyID: property, guestID: guestId })}`), property, guestId)
        break
      }
      case 'housekeeping.status': {
        const query = housekeepingQuery(inv.args, property)
        data = housekeeping(await read(`getHousekeepingStatus?${query}`), property, query)
        break
      }
      case 'rate-plans.list': {
        const query = ratePlanQuery(inv.args, property)
        data = ratePlans(await read(`getRatePlans?${query}`), property, query)
        break
      }
      case 'room-types.available': {
        const query = roomAvailabilityQuery(inv.args, property)
        data = roomAvailability(await read(`getAvailableRoomTypes?${query}`), property, query)
        break
      }
      case 'webhooks.list':
        data = { propertyId: property, subscriptions: await listWebhooks(inv.source, property) }
        break
      default:
        throw new Error(`cloudbeds: unknown read ${inv.capabilityName}`)
    }
    return { data, fetchedAt: Date.now() }
  },

  async executeMutation(inv) {
    const property = propertyId(inv.source)
    switch (inv.capabilityName) {
      case 'folio-items.post': return postFolioItem(inv, property)
      case 'housekeeping.update': return updateHousekeeping(inv, property)
      case 'webhooks.subscribe': return subscribeWebhook(inv, property)
      case 'webhooks.delete': return deleteWebhook(inv, property)
      default: throw new Error(`cloudbeds: unknown mutation ${inv.capabilityName}`)
    }
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

// GET /getAvailableRoomTypes (security read:room).
function roomAvailabilityQuery(args: Record<string, unknown>, property: string): URLSearchParams {
  const startDate = date(args.startDate, 'startDate')
  const endDate = date(args.endDate, 'endDate')
  const days = nights(startDate, endDate)
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
