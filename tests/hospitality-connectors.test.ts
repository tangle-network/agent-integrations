import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudbedsConnector } from '../src/connectors/adapters/cloudbeds.js'
import { pricelabsConnector } from '../src/connectors/adapters/pricelabs.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

const source = (kind: string, metadata: Record<string, unknown>): ResolvedDataSource => ({
  id: 'connection-1', projectId: 'business-1', publishedAgentId: null, kind, label: kind,
  consistencyModel: kind === 'cloudbeds' ? 'authoritative' : 'advisory',
  scopes: kind === 'cloudbeds' ? ['read:reservation', 'read:room', 'write:item'] : [],
  metadata, credentials: { kind: 'api-key', apiKey: 'fixture-secret' }, status: 'active',
})
const cloudbeds = source('cloudbeds', { propertyId: '1234' })
const pricelabs = source('pricelabs', { listings: [{ id: 'listing-1', pms: 'cloudbeds' }] })
const invoke = (connection: ResolvedDataSource, capabilityName: string, args: Record<string, unknown>, idempotencyKey = 'charge:business-1:ledger-1'): ConnectorInvocation => ({
  source: connection, capabilityName, args, idempotencyKey,
})
const reservation = { propertyID: '1234', reservationID: 'res-1', status: 'checked_in', startDate: '2026-10-20', endDate: '2026-10-27', guestName: 'Test Guest', balance: 0 }
const charge = { reservationId: 'res-1', appItemId: 'massage', itemName: 'Massage', itemCategoryName: 'Wellness', itemPrice: 50, itemQuantity: 1, taxes: [{ taxName: 'Sales tax', taxValue: 5 }] }
const reservationDetail = { success: true, data: { propertyID: '1234', reservationID: 'res-1' } }

afterEach(() => vi.unstubAllGlobals())

describe('Cloudbeds property and folio contract', () => {
  it('reads one bounded page for the pinned property and reports the next page', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true, data: [reservation], count: 1, total: 3 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', {
      checkInFrom: '2026-10-20', checkInTo: '2026-10-20', pageNumber: 1, pageSize: 1,
    }))
    expect(result.data).toEqual({ reservations: [{ propertyId: '1234', reservationId: 'res-1', status: 'checked_in', arrivalDate: '2026-10-20', departureDate: '2026-10-27', guestName: 'Test Guest', balance: 0 }], pageNumber: 1, pageSize: 1, total: 3, hasMore: true })
    const url = new URL(fetcher.mock.calls[0]![0] as string)
    expect(url.origin).toBe('https://api.cloudbeds.com')
    expect(url.searchParams.get('propertyID')).toBe('1234')
    expect(url.searchParams.get('includeGuestsDetails')).toBeNull()
    expect(url.searchParams.get('pageSize')).toBe('1')
  })

  it('rejects broad reads, invalid pages, cross-property rows and malformed counts', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true, data: [reservation], count: 1, total: 1 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', {}))).rejects.toThrow('date range')
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkOutFrom: '2026-10-01', checkOutTo: '2026-11-15' }))).rejects.toThrow('31 days')
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkInFrom: '2026-10-20', checkInTo: '2026-10-20', pageSize: 101 }))).rejects.toThrow('pageSize')
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: [{ ...reservation, propertyID: '9999' }], count: 1, total: 1 }))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkInFrom: '2026-10-20', checkInTo: '2026-10-20' }))).rejects.toThrow('outside the connected property')
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: [reservation], count: 2, total: 2 }))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkInFrom: '2026-10-20', checkInTo: '2026-10-20' }))).rejects.toThrow('pagination')
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: [{ ...reservation, startDate: '2026-02-30' }], count: 1, total: 1 }))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkInFrom: '2026-10-20', checkInTo: '2026-10-20' }))).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reads provider room-type availability for one bounded stay and pinned property', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true, count: 1, total: 1,
      roomCount: 2, data: [{ propertyID: '1234', propertyRooms: [
        { roomTypeID: 'room-1', roomTypeName: 'King', roomsAvailable: 2, roomRate: 150 },
        { roomTypeID: 'room-2', roomTypeName: 'Twin', roomsAvailable: 0, roomRate: 100 },
      ] }] }))
    vi.stubGlobal('fetch', fetcher)
    const result = await cloudbedsConnector.executeRead!(invoke(cloudbeds, 'room-types.available', {
      startDate: '2026-10-20', endDate: '2026-10-22', adults: 2, pageSize: 1,
    }))
    expect(result.data).toEqual({ propertyId: '1234', startDate: '2026-10-20', endDate: '2026-10-22', rooms: 1,
      adults: 2, children: 0, roomTypes: [
        { roomTypeId: 'room-1', roomTypeName: 'King', roomsAvailable: 2, roomRate: 150 },
        { roomTypeId: 'room-2', roomTypeName: 'Twin', roomsAvailable: 0, roomRate: 100 },
      ], pageNumber: 1, pageSize: 1, mayHaveMore: false })
    const query = new URL(fetcher.mock.calls[0]![0])
    expect(query.pathname).toBe('/api/v1.3/getAvailableRoomTypes')
    expect(query.searchParams.get('propertyIDs')).toBe('1234')
    expect(query.searchParams.get('includeSharedRooms')).toBe('false')
  })

  it('fails closed on invalid stays and cross-property or inconsistent availability', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true, count: 1, total: 1,
      roomCount: 1, data: [{ propertyID: '9999', propertyRooms: [{ roomTypeID: 'room-1', roomsAvailable: 1 }] }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'room-types.available', { startDate: '2026-10-20', endDate: '2026-10-20' }))).rejects.toThrow('stay')
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'room-types.available', { startDate: '2026-10-20', endDate: '2026-10-22', children: -1 }))).rejects.toThrow('children')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'room-types.available', { startDate: '2026-10-20', endDate: '2026-10-22' }))).rejects.toThrow('outside the connected property')
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, count: 1, total: 1, roomCount: 2,
      data: [{ propertyID: '1234', propertyRooms: [{ roomTypeID: 'room-1', roomsAvailable: 1 }] }] }))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'room-types.available', { startDate: '2026-10-20', endDate: '2026-10-22' }))).rejects.toThrow('room-type count')
  })

  it('posts one unpaid item with explicit tax and a stable provider reference', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.includes('/getReservation?')
      ? reservationDetail : { success: true, data: { soldProductID: 'sold-1', transactionID: 'txn-1' } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))
    expect(result).toMatchObject({ status: 'committed', data: { referenceId: 'charge:business-1:ledger-1', soldProductId: 'sold-1', duplicate: false } })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const lookup = new URL(fetcher.mock.calls[0]![0])
    expect(lookup.pathname).toBe('/api/v1.3/getReservation')
    expect(lookup.searchParams.get('propertyID')).toBe('1234')
    expect(lookup.searchParams.get('reservationID')).toBe('res-1')
    const [url, init] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://api.cloudbeds.com/api/v1.3/postCustomItem')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('propertyID')).toBe('1234')
    expect(body.get('referenceID')).toBe('charge:business-1:ledger-1')
    expect(body.get('items[0][appItemID]')).toBe('massage')
    expect(body.get('items[0][itemPrice]')).toBe('50.00')
    expect(body.get('items[0][itemTaxes][0][taxValue]')).toBe('5.00')
    expect(body.get('itemPaid')).toBe('false')
    expect(body.has('payments')).toBe(false)
  })

  it('accepts a provider duplicate notice but never claims a new item was created', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/getReservation?')
      ? reservationDetail : { success: true, data: { notice: 'referenceID exists; nothing was created' } })))
    const result = await cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))
    expect(result).toMatchObject({ status: 'committed', data: { soldProductId: null, duplicate: true }, idempotentReplay: true })
  })

  it('keeps non-duplicate notices from masking a new or uncertain folio posting', async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.includes('/getReservation?')
      ? reservationDetail : { success: true, data: { soldProductID: 'sold-1', notice: 'Posting completed' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).resolves.toMatchObject({
      data: { soldProductId: 'sold-1', duplicate: false }, idempotentReplay: false,
    })
    fetcher.mockImplementationOnce(async () => Response.json(reservationDetail))
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: { notice: 'Please contact support' } }))
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toMatchObject({
      code: 'capability_outcome_indeterminate', definitive: false,
    })
    fetcher.mockImplementationOnce(async () => Response.json(reservationDetail))
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: { notice: 'referenceID exists for another reservation' } }))
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toMatchObject({
      code: 'capability_outcome_indeterminate', definitive: false,
    })
  })

  it('refuses a cross-property or mismatched reservation before posting a folio item', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: { propertyID: '9999', reservationID: 'res-1' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: { propertyID: '1234', reservationID: 'other' } }))
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fails closed before writing on invalid amounts, missing tax decisions and missing property binding', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true, data: { soldProductID: 'sold-1' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', { ...charge, itemPrice: -10 }))).rejects.toThrow('itemPrice')
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', { ...charge, taxes: undefined }))).rejects.toThrow('taxes')
    await expect(cloudbedsConnector.executeMutation!(invoke(source('cloudbeds', {}), 'folio-items.post', charge))).rejects.toThrow('propertyId')
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge, 'bad key'))).rejects.toThrow('idempotencyKey')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects provider soft failures and malformed write receipts', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.includes('/getReservation?')
      ? reservationDetail : { success: false, message: 'denied' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toMatchObject({
      code: 'provider_rejected', definitive: true,
    })
    fetcher.mockImplementationOnce(async () => Response.json(reservationDetail))
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: {} }))
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toThrow('receipt')
    fetcher.mockImplementationOnce(async () => Response.json({ success: 'unexpected' }))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', {
      checkInFrom: '2026-10-20', checkInTo: '2026-10-20',
    }))).rejects.toMatchObject({ code: 'invalid_response', definitive: false })
  })

  it('does not leak the key in a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fixture-secret', { status: 403 })))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkInFrom: '2026-10-20', checkInTo: '2026-10-20' }))).rejects.toThrow('HTTP 403')
  })

  it('surfaces throttling as retryable with the provider delay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '7' } })))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', {
      checkInFrom: '2026-10-20', checkInTo: '2026-10-20',
    }))).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 429, retryAfterMs: 7_000 })
  })

  it('tests a pinned property with the reservation read grant', async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await cloudbedsConnector.test!(cloudbeds)).toEqual({ ok: true })
    expect(String(fetcher.mock.calls[0]![0])).toContain('propertyID=1234')
    fetcher.mockImplementationOnce(async () => new Response('fixture-secret', { status: 401 }))
    expect(await cloudbedsConnector.test!(cloudbeds)).toMatchObject({ ok: false, reason: expect.stringContaining('rejected the API key') })
  })
})

describe('PriceLabs read-only listing prices', () => {
  it('reads a pinned listing and returns only pricing fields', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([{ id: 'listing-1', pms: 'cloudbeds', currency: 'USD', last_refreshed_at: '2026-09-23T00:00:00Z', data: [{ date: '2026-10-20', price: 125, min_stay: 2, booking_status: '', unbookable: 0, reason: { private: 'not returned' } }] }]))
    vi.stubGlobal('fetch', fetcher)
    const result = await pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', { listingId: 'listing-1', pms: 'cloudbeds', dateFrom: '2026-10-20', dateTo: '2026-10-20' }))
    expect(result.data).toEqual({ listingId: 'listing-1', pms: 'cloudbeds', currency: 'USD', lastRefreshedAt: '2026-09-23T00:00:00Z', prices: [{ date: '2026-10-20', price: 125, minStay: 2, bookingStatus: '', unbookable: false }] })
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.pricelabs.co/v1/listing_prices')
    expect(JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body))).toEqual({ listings: [{ id: 'listing-1', pms: 'cloudbeds', dateFrom: '2026-10-20', dateTo: '2026-10-20' }] })
  })

  it('refuses an unpinned listing and malformed provider responses', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([{ id: 'different', pms: 'cloudbeds', currency: 'USD', data: [] }]))
    vi.stubGlobal('fetch', fetcher)
    const args = { listingId: 'listing-1', pms: 'cloudbeds', dateFrom: '2026-10-20', dateTo: '2026-10-20' }
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', { ...args, listingId: 'other' }))).rejects.toThrow('not pinned')
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', { ...args, dateTo: '2026-12-20' }))).rejects.toThrow('31 days')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toThrow('mismatched')
    fetcher.mockImplementationOnce(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds', currency: 'USD', data: [{ date: '2026-10-20', price: '125' }] }]))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toThrow('daily price')
    fetcher.mockImplementationOnce(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds', currency: 'USD', data: [{ date: '2026-11-20', price: 125, unbookable: 'yes' }] }]))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toThrow('daily price')
    fetcher.mockImplementationOnce(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds', currency: 'USD', data: [{ date: '2026-02-30', price: 125 }] }]))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', { ...args,
      dateFrom: '2026-02-01', dateTo: '2026-03-01',
    }))).rejects.toThrow('daily price')
    fetcher.mockImplementationOnce(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds', currency: 'USD',
      data: [{ date: '2026-10-20', price: 125, booking_status: 'booked\u0085false' }] }]))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toMatchObject({ code: 'invalid_response' })
    fetcher.mockImplementationOnce(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds', currency: 'USD',
      last_refreshed_at: 'now\u2028then', data: [] }]))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('reports documented per-listing errors without echoing provider text', async () => {
    const args = { listingId: 'listing-1', pms: 'cloudbeds', dateFrom: '2026-10-20', dateTo: '2026-10-20' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds',
      error_status: 'LISTING_NO_DATA', error: 'fixture-secret' }])))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toMatchObject({
      code: 'listing_unavailable', message: 'PriceLabs has not fetched prices for this listing', definitive: true,
    })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ id: 'listing-1', pms: 'cloudbeds',
      error_status: 'LISTING_NEW_ERROR', currency: 'USD', data: [{ date: '2026-10-20', price: 125 }] }])))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', args))).rejects.toMatchObject({
      code: 'listing_unavailable', message: 'PriceLabs reported an unavailable listing', definitive: true,
    })
  })

  it('surfaces a listing API throttle as retryable with the provider delay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '3' } })))
    await expect(pricelabsConnector.executeRead!(invoke(pricelabs, 'listing-prices.get', {
      listingId: 'listing-1', pms: 'cloudbeds', dateFrom: '2026-10-20', dateTo: '2026-10-20',
    }))).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 429, retryAfterMs: 3_000 })
  })

  it('tests pinned listings against the authenticated account inventory', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ listings: [{ id: 'listing-1', pms: 'cloudbeds' }] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await pricelabsConnector.test!(pricelabs)).toEqual({ ok: true })
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.pricelabs.co/v1/listings')
    fetcher.mockImplementationOnce(async () => Response.json({ listings: [] }))
    expect(await pricelabsConnector.test!(pricelabs)).toMatchObject({ ok: false, reason: expect.stringContaining('unavailable') })
    expect(pricelabsConnector.executeMutation).toBeUndefined()
  })
})
