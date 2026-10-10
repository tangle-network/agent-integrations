import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudbedsConnector } from '../src/connectors/adapters/cloudbeds.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'
import { validateConnectorManifest } from '../src/connectors/types.js'
import { CLOUDBEDS_WEBHOOK_AUTH_HEADER, cloudbedsWebhookProvider } from '../src/webhooks/index.js'

// Fixtures follow the Cloudbeds PMS v1.3 OpenAPI response schemas and the
// webhook guide's documented payloads.
const source: ResolvedDataSource = {
  id: 'connection-1', projectId: 'business-1', publishedAgentId: null, kind: 'cloudbeds', label: 'cloudbeds',
  consistencyModel: 'authoritative',
  scopes: ['read:reservation', 'read:room', 'read:guest', 'read:housekeeping', 'write:housekeeping', 'read:rate', 'write:item'],
  metadata: { propertyId: '1234' }, credentials: { kind: 'api-key', apiKey: 'fixture-secret' }, status: 'active',
}
const invoke = (capabilityName: string, args: Record<string, unknown>, idempotencyKey = 'op:business-1:1'): ConnectorInvocation => ({
  source, capabilityName, args, idempotencyKey,
})
const read = (name: string, args: Record<string, unknown> = {}) => cloudbedsConnector.executeRead!(invoke(name, args))
const mutate = (name: string, args: Record<string, unknown>) => cloudbedsConnector.executeMutation!(invoke(name, args))
const stub = (...bodies: unknown[]) => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(bodies.length > 1 ? bodies.shift() : bodies[0]))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const url = (fetcher: ReturnType<typeof stub>, index = 0) => new URL(String(fetcher.mock.calls[index]![0]))

afterEach(() => vi.unstubAllGlobals())

const reservationRow = { propertyID: '1234', reservationID: 'res-1', status: 'checked_in', guestID: 'g-1', guestName: 'Test Guest',
  startDate: '2026-10-20', endDate: '2026-10-22', adults: '2', children: '0', balance: 120,
  rooms: [
    { roomTypeID: '501', roomTypeName: 'King', roomID: '501-1', roomName: '101', roomStatus: 'in_house' },
    { roomTypeID: '501', roomTypeName: 'King', roomID: '501-2', roomName: '102', roomStatus: 'in_house' },
    { roomTypeID: '502', roomTypeName: 'Suite', roomID: null, roomStatus: 'not_checked_in' },
  ] }

const reservationDetail = { success: true, data: {
  propertyID: '1234', reservationID: 'res-1', status: 'confirmed', guestName: 'Test Guest', source: 'Website', sourceID: 's-1',
  startDate: '2026-10-20', endDate: '2026-10-22', total: 300, balance: 120,
  balanceDetailed: { suggestedDeposit: '60.00', subTotal: 250, additionalItems: 20, taxesFees: 30, grandTotal: 300, paid: 180 },
  guestList: {
    'g-2': { guestID: 'g-2', isMainGuest: false, guestDocumentNumber: 'never-returned' },
    'g-1': { guestID: 'g-1', isMainGuest: true, guestDocumentNumber: 'never-returned' },
  },
  assigned: [{ roomTypeID: '501', roomTypeName: 'King', roomID: '501-1', roomName: '101', startDate: '2026-10-20', endDate: '2026-10-22', adults: '2', children: '1' }],
  unassigned: [{ roomTypeID: '502', roomTypeName: 'Suite', startDate: '2026-10-20', endDate: '2026-10-22', adults: '1', children: '0' }],
  cardsOnFile: [{ cardID: 'c-1', cardNumber: '4242', cardType: 'visa' }],
} }

describe('Cloudbeds manifest', () => {
  it('declares every capability with its spec scope and a valid manifest', () => {
    expect(validateConnectorManifest(cloudbedsConnector.manifest)).toEqual({ ok: true, issues: [] })
    const scopes = Object.fromEntries(cloudbedsConnector.manifest.capabilities.map(c => [c.name, c.requiredScopes]))
    expect(scopes).toEqual({
      'reservations.list': ['read:reservation'], 'reservations.get': ['read:reservation'],
      'guests.get': ['read:guest'], 'guests.notes': ['read:guest'],
      'housekeeping.status': ['read:housekeeping'], 'housekeeping.update': ['read:housekeeping', 'write:housekeeping'],
      'rate-plans.list': ['read:rate'], 'room-types.available': ['read:room'],
      'folio-items.post': ['read:reservation', 'write:item'],
      'webhooks.subscribe': ['read:reservation'], 'webhooks.list': ['read:reservation'], 'webhooks.delete': ['read:reservation'],
    })
    expect((cloudbedsConnector.manifest.auth as { hint?: string }).hint).toContain('read:reservation, read:room, read:guest, read:housekeeping, write:housekeeping, read:rate and write:item')
  })
})

describe('Cloudbeds reservations', () => {
  it('lists in-house guests with status alone and returns deduped room lists', async () => {
    const fetcher = stub({ success: true, data: [reservationRow], count: 1, total: 1 })
    const result = await read('reservations.list', { status: 'checked_in' })
    expect(url(fetcher).pathname).toBe('/api/v1.3/getReservations')
    expect(url(fetcher).searchParams.get('status')).toBe('checked_in')
    expect(url(fetcher).searchParams.get('includeAllRooms')).toBe('true')
    expect(url(fetcher).searchParams.get('checkInFrom')).toBeNull()
    expect((result.data as { reservations: unknown[] }).reservations[0]).toEqual({
      propertyId: '1234', reservationId: 'res-1', status: 'checked_in', arrivalDate: '2026-10-20', departureDate: '2026-10-22',
      guestId: 'g-1', guestName: 'Test Guest', balance: 120,
      roomTypeIds: ['501', '502'], roomIds: ['501-1', '501-2'], roomNames: ['101', '102'],
    })
  })

  it('requires dates for any other status and rejects malformed rooms', async () => {
    const fetcher = stub({ success: true, data: [{ ...reservationRow, rooms: [{ roomTypeID: 501 }] }], count: 1, total: 1 })
    await expect(read('reservations.list', { status: 'confirmed' })).rejects.toThrow('date range')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(read('reservations.list', { status: 'checked_in' })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reads one reservation with rooms, guest counts, and paid and owed amounts', async () => {
    const fetcher = stub(reservationDetail)
    const result = await read('reservations.get', { reservationId: 'res-1' })
    expect(url(fetcher).pathname).toBe('/api/v1.3/getReservation')
    expect(url(fetcher).searchParams.get('propertyID')).toBe('1234')
    expect(url(fetcher).searchParams.get('includeGuestRequirements')).toBeNull()
    expect(result.data).toEqual({
      propertyId: '1234', reservationId: 'res-1', status: 'confirmed', arrivalDate: '2026-10-20', departureDate: '2026-10-22',
      guestId: 'g-1', guestName: 'Test Guest', adults: 3, children: 1,
      assignedRooms: [{ roomId: '501-1', roomName: '101', roomTypeId: '501', roomTypeName: 'King', startDate: '2026-10-20', endDate: '2026-10-22', adults: 2, children: 1 }],
      unassignedRooms: [{ roomTypeId: '502', roomTypeName: 'Suite', startDate: '2026-10-20', endDate: '2026-10-22', adults: 1, children: 0 }],
      total: 300, balance: 120,
      balanceDetailed: { subTotal: 250, additionalItems: 20, taxesFees: 30, grandTotal: 300, paid: 180, suggestedDeposit: 60 },
      source: 'Website', sourceId: 's-1',
    })
    expect(JSON.stringify(result.data)).not.toContain('never-returned')
    expect(JSON.stringify(result.data)).not.toContain('4242')
  })

  it('refuses a reservation from another property and accepts the array form of balanceDetailed', async () => {
    stub({ success: true, data: { ...reservationDetail.data, propertyID: '9999' } })
    await expect(read('reservations.get', { reservationId: 'res-1' })).rejects.toThrow('connected property')
    stub({ success: true, data: { ...reservationDetail.data, balanceDetailed: [reservationDetail.data.balanceDetailed] } })
    await expect(read('reservations.get', { reservationId: 'res-1' })).resolves.toMatchObject({ data: { balanceDetailed: { paid: 180 } } })
    stub({ success: true, data: { ...reservationDetail.data, assigned: [{ roomTypeID: '501' }] } })
    await expect(read('reservations.get', { reservationId: 'res-1' })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})

describe('Cloudbeds guests', () => {
  it('reads contact fields only and pins the property on the request', async () => {
    const fetcher = stub({ success: true, data: { firstName: 'Ada', lastName: 'Guest', email: 'ada@example.test', phone: '+1 555 0100',
      cellPhone: '', country: 'US', guestNationality: 'US', documentNumber: 'never-returned', birthDate: '1990-01-01', address: 'never-returned' } })
    const result = await read('guests.get', { guestId: 'g-1' })
    expect(url(fetcher).pathname).toBe('/api/v1.3/getGuest')
    expect(url(fetcher).searchParams.get('propertyID')).toBe('1234')
    expect(url(fetcher).searchParams.get('guestID')).toBe('g-1')
    expect(result.data).toEqual({ propertyId: '1234', guestId: 'g-1', firstName: 'Ada', lastName: 'Guest', email: 'ada@example.test',
      phone: '+1 555 0100', cellPhone: null, country: 'US', nationality: 'US', isAnonymized: false, mergedIntoGuestId: null })
    expect(JSON.stringify(result.data)).not.toContain('never-returned')
    await expect(read('guests.get', { guestId: 'g 1' })).rejects.toThrow('guestId')
  })

  it('reads guest notes and rejects malformed rows', async () => {
    const fetcher = stub({ success: true, data: [{ guestNoteID: 'n-1', userName: 'Front Desk', dateCreated: '2026-10-01 10:00:00',
      dateModified: '2026-10-01 10:00:00', guestNote: 'Prefers a high floor.\nAllergic to feathers.' }] })
    const result = await read('guests.notes', { guestId: 'g-1' })
    expect(url(fetcher).pathname).toBe('/api/v1.3/getGuestNotes')
    expect(result.data).toEqual({ propertyId: '1234', guestId: 'g-1', notes: [{ noteId: 'n-1', note: 'Prefers a high floor.\nAllergic to feathers.',
      author: 'Front Desk', createdAt: '2026-10-01 10:00:00', modifiedAt: '2026-10-01 10:00:00' }] })
    stub({ success: true, data: [{ guestNote: 'no id' }] })
    await expect(read('guests.notes', { guestId: 'g-1' })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})

const housekeepingRow = { date: '2026-10-10', roomTypeID: '501', roomTypeName: 'King', roomID: '501-1', roomName: '101',
  roomCondition: 'dirty', roomOccupied: true, roomBlocked: false, frontdeskStatus: 'stayover', housekeeperID: 'h-1',
  housekeeper: 'Maria', doNotDisturb: false, refusedService: false, vacantPickup: false, roomComments: '' }

describe('Cloudbeds housekeeping', () => {
  it('reads one bounded page of room status', async () => {
    const fetcher = stub({ success: true, data: [housekeepingRow], count: 1, total: 4 })
    const result = await read('housekeeping.status', { roomCondition: 'dirty', pageSize: 1 })
    expect(url(fetcher).pathname).toBe('/api/v1.3/getHousekeepingStatus')
    expect(Object.fromEntries(url(fetcher).searchParams)).toEqual({ propertyID: '1234', roomCondition: 'dirty', pageNumber: '1', pageSize: '1' })
    expect(result.data).toEqual({ propertyId: '1234', pageNumber: 1, pageSize: 1, total: 4, hasMore: true, rooms: [{
      roomId: '501-1', roomName: '101', roomTypeId: '501', roomTypeName: 'King', roomCondition: 'dirty', roomOccupied: true,
      doNotDisturb: false, roomBlocked: false, frontdeskStatus: 'stayover', housekeeperId: 'h-1', housekeeper: 'Maria', conditionDate: '2026-10-10',
    }] })
    await expect(read('housekeeping.status', { roomCondition: 'sparkling' })).rejects.toThrow('roomCondition')
    stub({ success: true, data: [{ ...housekeepingRow, roomOccupied: 'yes' }], count: 1, total: 1 })
    await expect(read('housekeeping.status')).rejects.toMatchObject({ code: 'invalid_response' })
    stub({ success: true, data: [{ ...housekeepingRow, roomID: '777-1' }], count: 1, total: 1 })
    await expect(read('housekeeping.status', { roomId: '501-1' })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('verifies the room, then sets an explicit condition', async () => {
    const fetcher = stub({ success: true, data: [housekeepingRow], count: 1, total: 1 },
      { success: true, data: { date: '2026-10-10', roomID: '501-1', roomCondition: 'clean', doNotDisturb: true } })
    const result = await mutate('housekeeping.update', { roomId: '501-1', roomCondition: 'clean', doNotDisturb: true })
    expect(url(fetcher, 0).searchParams.get('roomIDs')).toBe('501-1')
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.cloudbeds.com/api/v1.3/postHousekeepingStatus')
    expect(Object.fromEntries(new URLSearchParams(String(fetcher.mock.calls[1]![1]!.body)))).toEqual({
      propertyID: '1234', roomID: '501-1', roomCondition: 'clean', doNotDisturb: 'true' })
    expect(result).toMatchObject({ status: 'committed', idempotentReplay: false,
      data: { roomId: '501-1', roomCondition: 'clean', previousCondition: 'dirty', doNotDisturb: true } })
  })

  it('never sends a toggle and refuses unknown rooms or mismatched receipts', async () => {
    const fetcher = stub({ success: true, data: [], count: 0, total: 0 })
    await expect(mutate('housekeeping.update', { roomId: '501-1' })).rejects.toThrow('roomCondition')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(mutate('housekeeping.update', { roomId: '501-1', roomCondition: 'clean' })).rejects.toThrow('not part of the connected property')
    expect(fetcher).toHaveBeenCalledTimes(1)
    stub({ success: true, data: [housekeepingRow], count: 1, total: 1 }, { success: true, data: { roomID: '501-1', roomCondition: 'dirty' } })
    await expect(mutate('housekeeping.update', { roomId: '501-1', roomCondition: 'clean' })).rejects.toMatchObject({ code: 'capability_outcome_indeterminate' })
  })
})

describe('Cloudbeds rate plans', () => {
  it('reads rates for a bounded stay and refuses other properties or room types', async () => {
    const rate = { rateID: 'r-1', isDerived: false, roomRate: 150, totalRate: 300, roomsAvailable: 3, roomTypeID: '501',
      roomTypeName: 'King', propertyID: '1234', ratePlanID: 'p-1', ratePlanNamePublic: 'Flexible', ratePlanNamePrivate: 'internal' }
    const fetcher = stub({ success: true, data: [rate] })
    const result = await read('rate-plans.list', { startDate: '2026-10-20', endDate: '2026-10-22', roomTypeId: '501' })
    expect(url(fetcher).pathname).toBe('/api/v1.3/getRatePlans')
    expect(url(fetcher).searchParams.get('propertyIDs')).toBe('1234')
    expect(url(fetcher).searchParams.get('roomTypeID')).toBe('501')
    expect(result.data).toEqual({ propertyId: '1234', startDate: '2026-10-20', endDate: '2026-10-22', rates: [{ rateId: 'r-1',
      ratePlanId: 'p-1', ratePlanName: 'Flexible', roomTypeId: '501', roomTypeName: 'King', roomRate: 150, totalRate: 300,
      roomsAvailable: 3, isDerived: false }] })
    await expect(read('rate-plans.list', { startDate: '2026-10-01', endDate: '2026-11-15' })).rejects.toThrow('31 nights')
    stub({ success: true, data: [{ ...rate, propertyID: '9999' }] })
    await expect(read('rate-plans.list', { startDate: '2026-10-20', endDate: '2026-10-22' })).rejects.toThrow('outside the connected property')
    stub({ success: true, data: [{ ...rate, roomTypeID: '777' }] })
    await expect(read('rate-plans.list', { startDate: '2026-10-20', endDate: '2026-10-22', roomTypeId: '501' })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})

const subscription = { id: 'sub-1', key: { type: 'property', id: '1234' }, event: { entity: 'reservation', action: 'created' },
  subscriptionType: 'webhook', subscriptionData: { endpoint: 'https://hub.example.test/v1/integrations/webhook/c/token' },
  authHeader: { name: CLOUDBEDS_WEBHOOK_AUTH_HEADER } }
const subscribe = { object: 'reservation', action: 'created', endpointUrl: 'https://hub.example.test/v1/integrations/webhook/c/token' }

describe('Cloudbeds webhook subscriptions', () => {
  it('subscribes an allowed event with an auth header and never echoes its value', async () => {
    const fetcher = stub({ success: true, data: [] }, { success: true, data: { subscriptionID: 'sub-2' } })
    const result = await mutate('webhooks.subscribe', { ...subscribe, authHeaderName: CLOUDBEDS_WEBHOOK_AUTH_HEADER, authHeaderValue: 'header-secret' })
    expect(url(fetcher, 0).pathname).toBe('/api/v1.3/getWebhooks')
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.cloudbeds.com/api/v1.3/postWebhook')
    expect(Object.fromEntries(new URLSearchParams(String(fetcher.mock.calls[1]![1]!.body)))).toEqual({ propertyID: '1234',
      ...subscribe, authHeaderName: CLOUDBEDS_WEBHOOK_AUTH_HEADER, authHeaderValue: 'header-secret' })
    expect(result).toMatchObject({ status: 'committed', idempotentReplay: false, data: { subscriptionId: 'sub-2', existing: false } })
    expect(JSON.stringify(result)).not.toContain('header-secret')
  })

  it('reuses a matching subscription when no header rotation is requested', async () => {
    const fetcher = stub({ success: true, data: [subscription] })
    await expect(mutate('webhooks.subscribe', subscribe)).resolves.toMatchObject({ idempotentReplay: true, data: { subscriptionId: 'sub-1', existing: true } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuses unlisted events, non-https endpoints, partial headers, and redacts the header value from errors', async () => {
    const fetcher = stub({ success: true, data: [] })
    await expect(mutate('webhooks.subscribe', { ...subscribe, object: 'guest', action: 'created' })).rejects.toThrow('unsupported webhook event')
    await expect(mutate('webhooks.subscribe', { ...subscribe, action: 'notes_changed' })).rejects.toThrow('unsupported webhook event')
    await expect(mutate('webhooks.subscribe', { ...subscribe, endpointUrl: 'http://hub.example.test/hook' })).rejects.toThrow('https')
    await expect(mutate('webhooks.subscribe', { ...subscribe, endpointUrl: 'https://user:pass@hub.example.test/hook' })).rejects.toThrow('https')
    await expect(mutate('webhooks.subscribe', { ...subscribe, authHeaderValue: 'header-secret' })).rejects.toThrow('together')
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket closed while sending header-secret') }))
    const error: Error = await mutate('webhooks.subscribe', { ...subscribe, authHeaderName: 'x-tangle-webhook-token', authHeaderValue: 'header-secret' }).then(() => new Error('resolved'), (e: Error) => e)
    expect(error.message).not.toContain('header-secret')
    expect(error.message).toContain('[redacted]')
  })

  it('lists subscriptions and refuses another property', async () => {
    stub({ success: true, data: [subscription] })
    await expect(read('webhooks.list')).resolves.toMatchObject({ data: { propertyId: '1234', subscriptions: [{ subscriptionId: 'sub-1',
      object: 'reservation', action: 'created', endpointUrl: subscribe.endpointUrl, authHeaderName: CLOUDBEDS_WEBHOOK_AUTH_HEADER }] } })
    stub({ success: true, data: [{ ...subscription, key: { type: 'property', id: 9999 } }] })
    await expect(read('webhooks.list')).rejects.toThrow('outside the connected property')
  })

  it('deletes only a visible subscription and reports an absent one', async () => {
    const fetcher = stub({ success: true, data: [subscription] }, { success: true })
    await expect(mutate('webhooks.delete', { subscriptionId: 'sub-1' })).resolves.toMatchObject({ idempotentReplay: false, data: { deleted: true } })
    expect(url(fetcher, 1).pathname).toBe('/api/v1.3/deleteWebhook')
    expect(Object.fromEntries(url(fetcher, 1).searchParams)).toEqual({ propertyIDs: '1234', subscriptionID: 'sub-1' })
    expect((fetcher.mock.calls[1]![1] as RequestInit).method).toBe('DELETE')
    const absent = stub({ success: true, data: [] })
    await expect(mutate('webhooks.delete', { subscriptionId: 'sub-9' })).resolves.toMatchObject({ idempotentReplay: true, data: { deleted: false, alreadyAbsent: true } })
    expect(absent).toHaveBeenCalledTimes(1)
  })
})

describe('Cloudbeds webhook provider', () => {
  const headers = { [CLOUDBEDS_WEBHOOK_AUTH_HEADER]: 'per-connection-secret', 'content-type': 'application/json' }

  it('verifies the subscription auth header in constant time', () => {
    const verify = (h: Record<string, string>) => cloudbedsWebhookProvider.verifySignature({ rawBody: '{}', headers: h, secret: 'per-connection-secret' })
    expect(verify(headers)).toEqual({ valid: true })
    expect(verify({ 'X-Tangle-Webhook-Token': 'per-connection-secret' })).toEqual({ valid: true })
    expect(verify({})).toMatchObject({ valid: false, reason: 'missing_cloudbeds_webhook_token' })
    expect(verify({ [CLOUDBEDS_WEBHOOK_AUTH_HEADER]: 'short' })).toMatchObject({ valid: false })
    expect(verify({ [CLOUDBEDS_WEBHOOK_AUTH_HEADER]: 'per-connection-secreT' })).toMatchObject({ valid: false })
  })

  it('emits namespaced hints with normalized IDs and a retry-stable event ID', async () => {
    const body = { version: '1.0', timestamp: 1611758157.431234, event: 'reservation/status_changed', actor: { type: 'user', id: '123' },
      propertyID: 12345, propertyID_str: '12345', reservationID: '31415926', status: 'checked_in' }
    const [envelope] = await cloudbedsWebhookProvider.parse({ rawBody: JSON.stringify(body), headers, now: 7 })
    expect(envelope).toEqual({
      provider: 'cloudbeds', eventType: 'cloudbeds.reservation.status_changed', receivedAt: 7,
      providerEventId: createHash('sha256').update('reservation/status_changed|12345|31415926|1611758157.431234').digest('hex'),
      payload: { ...body, propertyId: '12345', reservationId: '31415926' },
      headers: { 'content-type': 'application/json' },
    })
    const [retry] = await cloudbedsWebhookProvider.parse({ rawBody: JSON.stringify(body), headers, now: 60_007 })
    expect(retry!.providerEventId).toBe(envelope!.providerEventId)
  })

  it('accepts the lower-case ID spelling and acknowledges unsubscribed events as no-ops', async () => {
    const dates = { version: '1.0', reservationId: '31415926', timestamp: 1611758157.431234, event: 'reservation/dates_changed',
      propertyId: 12345, propertyId_str: '12345', startDate: '2020-05-19', endDate: '2020-05-21' }
    const [envelope] = await cloudbedsWebhookProvider.parse({ rawBody: JSON.stringify(dates), headers })
    expect(envelope).toMatchObject({ eventType: 'cloudbeds.reservation.dates_changed', payload: { propertyId: '12345', reservationId: '31415926', startDate: '2020-05-19' } })
    expect(await cloudbedsWebhookProvider.parse({ rawBody: JSON.stringify({ event: 'guest/created', propertyId: 1, guestId: 2 }), headers })).toEqual([])
    expect(() => cloudbedsWebhookProvider.parse({ rawBody: JSON.stringify({ event: 'reservation/created', propertyID: 1 }), headers })).toThrow('reservationId')
    expect(() => cloudbedsWebhookProvider.parse({ rawBody: 'not json', headers })).toThrow('JSON')
  })

  it('declares a closed catalog matching the subscribe allowlist', () => {
    expect(cloudbedsWebhookProvider.eventCatalog).toEqual({ namespace: 'cloudbeds.', closed: true, events: [
      { id: 'cloudbeds.reservation.created' }, { id: 'cloudbeds.reservation.status_changed' },
      { id: 'cloudbeds.reservation.dates_changed' }, { id: 'cloudbeds.reservation.accommodation_changed' },
      { id: 'cloudbeds.reservation.deleted' },
    ] })
    const webhookCapability = cloudbedsConnector.manifest.capabilities.find(c => c.name === 'webhooks.subscribe')!
    const actions = (webhookCapability.parameters as { properties: { action: { enum: string[] } } }).properties.action.enum
    expect(actions.map(action => `cloudbeds.reservation.${action}`)).toEqual(cloudbedsWebhookProvider.eventCatalog!.events.map(e => e.id))
  })
})
