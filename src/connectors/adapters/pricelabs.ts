import { requestJson, record, ProviderProtocolError } from '../../http/response-json.js'
import { type ConnectorAdapter, type ResolvedDataSource, CredentialsExpired, ProviderRateLimited } from '../types.js'

const API = 'https://api.pricelabs.co/v1'
const DATE = /^\d{4}-\d{2}-\d{2}$/

interface Listing { id: string; pms: string }

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`pricelabs: invalid ${name}`)
  }
  return value
}

function providerText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) {
    throw new ProviderProtocolError('PriceLabs returned malformed text', 'invalid_response')
  }
  return value
}

function selectedListings(source: ResolvedDataSource): Listing[] {
  const value = source.metadata.listings
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('pricelabs: connection requires one or more pinned listings')
  }
  const seen = new Set<string>()
  return value.map((raw: unknown) => {
    if (!record(raw)) throw new Error('pricelabs: invalid pinned listing')
    const id = identifier(raw.id, 'pinned listing id')
    const pms = identifier(raw.pms, 'pinned listing pms')
    const key = JSON.stringify([id, pms])
    if (seen.has(key)) throw new Error('pricelabs: duplicate pinned listing')
    seen.add(key)
    return { id, pms }
  })
}

function apiKey(source: ResolvedDataSource): string {
  const value = source.credentials
  if (value.kind !== 'api-key' || !value.apiKey || /[\u0000-\u0020\u007f]/.test(value.apiKey)) {
    throw new Error('pricelabs: connection requires an API key')
  }
  return value.apiKey
}

async function call(source: ResolvedDataSource, path: string, init: RequestInit): Promise<unknown> {
  const key = apiKey(source)
  try {
    return await requestJson(`${API}/${path}`, { ...init,
      headers: { accept: 'application/json', 'X-API-Key': key, ...init.headers },
    }, { maxResponseBytes: 4_000_000 })
  } catch (error) {
    if (error instanceof ProviderProtocolError && error.status === 401) {
      throw new CredentialsExpired('PriceLabs rejected the API key', source.id)
    }
    if (error instanceof ProviderProtocolError && error.status === 429) {
      throw new ProviderRateLimited('PriceLabs rate limit (429)', source.id,
        { status: 429, retryAfterMs: error.retryAfterMs })
    }
    throw error
  }
}

function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`pricelabs: invalid ${label}`)
  }
  return value
}

function readPrice(row: unknown, from: string, to: string): Record<string, unknown> {
  // PriceLabs describes min_stay as a double, but it counts whole nights. A
  // fractional stay has no safe interpretation for a booking recommendation.
  if (!record(row) || typeof row.date !== 'string' || !DATE.test(row.date) || row.date < from || row.date > to ||
      typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0 ||
      (row.min_stay !== undefined && (!Number.isSafeInteger(row.min_stay) || (row.min_stay as number) < 1)) ||
      (row.unbookable !== undefined && row.unbookable !== 0 && row.unbookable !== 1 &&
        row.unbookable !== true && row.unbookable !== false)) {
    throw new ProviderProtocolError('PriceLabs returned a malformed daily price', 'invalid_response')
  }
  try {
    date(row.date, 'provider date')
  } catch {
    throw new ProviderProtocolError('PriceLabs returned a malformed daily price', 'invalid_response')
  }
  return {
    date: row.date,
    price: row.price,
    minStay: typeof row.min_stay === 'number' && Number.isSafeInteger(row.min_stay) ? row.min_stay : null,
    bookingStatus: providerText(row.booking_status, 100),
    unbookable: row.unbookable === 1 || row.unbookable === true,
  }
}

export const pricelabsConnector: ConnectorAdapter = {
  manifest: {
    kind: 'pricelabs',
    displayName: 'PriceLabs',
    description: 'Read recommended nightly prices for listings pinned to this connection. No pricing changes are exposed.',
    auth: { kind: 'api-key', hint: 'PriceLabs Customer API key. Pin the allowed listing ID and PMS pairs in connection metadata.' },
    category: 'market-intelligence',
    defaultConsistencyModel: 'advisory',
    capabilities: [{
      name: 'listing-prices.get', class: 'read',
      description: 'Read nightly recommended prices for one pinned listing and a bounded date range.',
      parameters: { type: 'object', properties: {
        listingId: { type: 'string', minLength: 1 },
        pms: { type: 'string', minLength: 1 },
        dateFrom: { type: 'string', format: 'date' },
        dateTo: { type: 'string', format: 'date' },
      }, required: ['listingId', 'pms', 'dateFrom', 'dateTo'] },
    }],
  },

  async executeRead(inv) {
    if (inv.capabilityName !== 'listing-prices.get') throw new Error(`pricelabs: unknown read ${inv.capabilityName}`)
    const id = identifier(inv.args.listingId, 'listingId')
    const pms = identifier(inv.args.pms, 'pms')
    if (!selectedListings(inv.source).some(listing => listing.id === id && listing.pms === pms)) {
      throw new Error('pricelabs: listing is not pinned to this connection')
    }
    const dateFrom = date(inv.args.dateFrom, 'dateFrom')
    const dateTo = date(inv.args.dateTo, 'dateTo')
    const days = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000
    if (days < 0 || days > 31) throw new Error('pricelabs: price date range must be at most 31 days')
    const result = await call(inv.source, 'listing_prices', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ listings: [{ id, pms, dateFrom, dateTo }] }) })
    if (!Array.isArray(result) || result.length !== 1 || !record(result[0]) || result[0].id !== id || result[0].pms !== pms) {
      throw new ProviderProtocolError('PriceLabs returned malformed or mismatched listing prices', 'invalid_response')
    }
    const listing = result[0]
    const failures: Record<string, string> = {
      LISTING_NOT_PRESENT: 'PriceLabs listing is no longer present',
      LISTING_NO_DATA: 'PriceLabs has not fetched prices for this listing',
      LISTING_TOGGLE_OFF: 'PriceLabs price sync is off for this listing',
    }
    if (typeof listing.error_status === 'string') {
      throw new ProviderProtocolError(failures[listing.error_status] ?? 'PriceLabs reported an unavailable listing',
        'listing_unavailable', 409, true)
    }
    if (typeof listing.error === 'string') {
      throw new ProviderProtocolError('PriceLabs cannot return prices for this listing', 'listing_unavailable', 409, true)
    }
    if (!Array.isArray(listing.data) || typeof listing.currency !== 'string' || !/^[A-Z]{3}$/.test(listing.currency)) {
      throw new ProviderProtocolError('PriceLabs returned malformed or mismatched listing prices', 'invalid_response')
    }
    return { data: { listingId: id, pms, currency: listing.currency,
      lastRefreshedAt: providerText(listing.last_refreshed_at, 256),
      prices: listing.data.map(row => readPrice(row, dateFrom, dateTo)) }, fetchedAt: Date.now() }
  },

  async test(source) {
    try {
      const listings = selectedListings(source)
      const result = await call(source, 'listings', { method: 'GET' })
      if (!record(result) || !Array.isArray(result.listings)) {
        throw new ProviderProtocolError('PriceLabs returned malformed listing inventory', 'invalid_response')
      }
      const available = new Set(result.listings.filter(record).map(row => JSON.stringify([row.id, row.pms])))
      if (listings.some(listing => !available.has(JSON.stringify([listing.id, listing.pms])))) {
        throw new Error('pricelabs: a pinned listing is unavailable to this API key')
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'PriceLabs connection failed' }
    }
  },
}
