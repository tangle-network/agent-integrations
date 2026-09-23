import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudbedsConnector } from '../src/connectors/adapters/cloudbeds.js'
import { pricelabsConnector } from '../src/connectors/adapters/pricelabs.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

const source = (kind: string, metadata: Record<string, unknown>): ResolvedDataSource => ({
  id: 'connection-1', projectId: 'business-1', publishedAgentId: null, kind, label: kind,
  consistencyModel: kind === 'cloudbeds' ? 'authoritative' : 'advisory',
  scopes: kind === 'cloudbeds' ? ['read:reservation', 'write:item'] : [],
  metadata, credentials: { kind: 'api-key', apiKey: 'fixture-secret' }, status: 'active',
})
const cloudbeds = source('cloudbeds', { propertyId: '1234' })
const pricelabs = source('pricelabs', { listings: [{ id: 'listing-1', pms: 'cloudbeds' }] })
const invoke = (connection: ResolvedDataSource, capabilityName: string, args: Record<string, unknown>, idempotencyKey = 'charge:business-1:ledger-1'): ConnectorInvocation => ({
  source: connection, capabilityName, args, idempotencyKey,
})
const reservation = { propertyID: '1234', reservationID: 'res-1', status: 'checked_in', startDate: '2026-10-20', endDate: '2026-10-27', guestName: 'Test Guest', balance: 0 }
const charge = { reservationId: 'res-1', appItemId: 'massage', itemName: 'Massage', itemCategoryName: 'Wellness', itemPrice: 50, itemQuantity: 1, taxes: [{ taxName: 'Sales tax', taxValue: 5 }] }

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
  })

  it('posts one unpaid item with explicit tax and a stable provider reference', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: true, data: { soldProductID: 'sold-1', transactionID: 'txn-1' } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))
    expect(result).toMatchObject({ status: 'committed', data: { referenceId: 'charge:business-1:ledger-1', soldProductId: 'sold-1', duplicate: false } })
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { notice: 'referenceID already posted' } })))
    const result = await cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))
    expect(result).toMatchObject({ status: 'committed', data: { soldProductId: null, duplicate: true } })
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
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ success: false, message: 'denied' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toThrow('unsuccessful')
    fetcher.mockImplementationOnce(async () => Response.json({ success: true, data: {} }))
    await expect(cloudbedsConnector.executeMutation!(invoke(cloudbeds, 'folio-items.post', charge))).rejects.toThrow('receipt')
  })

  it('does not leak the key in a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fixture-secret', { status: 403 })))
    await expect(cloudbedsConnector.executeRead!(invoke(cloudbeds, 'reservations.list', { checkInFrom: '2026-10-20', checkInTo: '2026-10-20' }))).rejects.toThrow('HTTP 403')
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
