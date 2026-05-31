import { describe, expect, it } from 'vitest'
import { ampecoConnector } from '../src/connectors/adapters/ampeco.js'

describe('ampeco adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the ampeco kind', () => {
    expect(ampecoConnector.manifest.kind).toBe('ampeco')
    expect(ampecoConnector.manifest.category).toBe('webhook')
    expect(ampecoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = ampecoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the AMPECO domains: charge-points, evses, sessions, locations, tariffs, users, notifications', () => {
    const names = ampecoConnector.manifest.capabilities.map((c) => c.name)
    // Spot-check at least one capability per AMPECO domain present in the piece.
    expect(names).toEqual(expect.arrayContaining([
      'charge.points.list',
      'charge.point.read',
      'charge.point.change.availability',
      'charge.point.reset',
      'charge.point.start.charging.session',
      'charge.point.stop.charging.session',
      'evses.list',
      'evse.read',
      'sessions.list',
      'session.read',
      'locations.list',
      'location.read',
      'location.create',
      'location.update',
      'location.delete',
      'tariffs.list',
      'tariff.read',
      'tariff.create',
      'tariff.update',
      'tariff.delete',
      'users.list',
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'notifications.list',
      'notifications.subscribe',
      'notifications.unsubscribe',
    ]))
  })

  it('partitions read vs mutation capabilities correctly', () => {
    const reads = ampecoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = ampecoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)

    // List/get endpoints must be reads.
    expect(reads).toEqual(expect.arrayContaining([
      'charge.points.list',
      'charge.point.read',
      'evses.list',
      'sessions.list',
      'locations.list',
      'tariffs.list',
      'users.list',
      'notifications.list',
    ]))

    // Lifecycle + remote-control endpoints must be mutations.
    expect(mutations).toEqual(expect.arrayContaining([
      'charge.point.change.availability',
      'charge.point.reset',
      'charge.point.start.charging.session',
      'charge.point.stop.charging.session',
      'location.create',
      'location.update',
      'location.delete',
      'tariff.create',
      'tariff.update',
      'tariff.delete',
      'user.create',
      'user.update',
      'user.delete',
      'notifications.subscribe',
      'notifications.unsubscribe',
    ]))
  })
})
