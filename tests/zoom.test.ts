import { describe, expect, it } from 'vitest'
import { zoomConnector } from '../src/connectors/adapters/zoom.js'

describe('zoom adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the zoom kind', () => {
    expect(zoomConnector.manifest.kind).toBe('zoom')
    expect(zoomConnector.manifest.displayName).toBe('Zoom')
    expect(zoomConnector.manifest.category).toBe('calendar')
    expect(zoomConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented Zoom endpoints and env-var names', () => {
    const auth = zoomConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://zoom.us/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://zoom.us/oauth/token')
    expect(auth.clientIdEnv).toBe('ZOOM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ZOOM_OAUTH_CLIENT_SECRET')
  })

  it('uses Zoom granular scopes (resource:action:scope) covering meeting, webinar, user, recording', () => {
    const auth = zoomConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toContain('user:read:user')
    expect(auth.scopes).toContain('meeting:read:meeting')
    expect(auth.scopes).toContain('meeting:write:meeting')
    expect(auth.scopes).toContain('meeting:update:meeting')
    expect(auth.scopes).toContain('meeting:delete:meeting')
    expect(auth.scopes).toContain('webinar:read:webinar')
    expect(auth.scopes).toContain('webinar:write:webinar')
    expect(auth.scopes).toContain('recording:read:recording')
    // Granular scopes are mandatory for new Zoom apps — reject the legacy 2-segment form.
    for (const scope of auth.scopes) {
      expect(scope.split(':').length).toBe(3)
    }
  })

  it('covers users + meetings + registrants + webinars + recordings with a read/mutation split', () => {
    const names = zoomConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.get',
        'users.list',
        'meetings.list',
        'meetings.get',
        'meetings.create',
        'meetings.update',
        'meetings.delete',
        'meetings.list-registrants',
        'meetings.add-registrant',
        'webinars.list',
        'webinars.get',
        'webinars.create',
        'recordings.list',
        'recordings.get',
      ].sort(),
    )
    const reads = zoomConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zoomConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'meetings.get',
        'meetings.list',
        'meetings.list-registrants',
        'recordings.get',
        'recordings.list',
        'users.get',
        'users.list',
        'webinars.get',
        'webinars.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'meetings.add-registrant',
        'meetings.create',
        'meetings.delete',
        'meetings.update',
        'webinars.create',
      ].sort(),
    )
  })

  it('marks side-effectful create/delete as externalEffect and update/delete as native-idempotency', () => {
    const byName = new Map(zoomConnector.manifest.capabilities.map((c) => [c.name, c]))
    const create = byName.get('meetings.create')
    const update = byName.get('meetings.update')
    const remove = byName.get('meetings.delete')
    const webinarCreate = byName.get('webinars.create')
    if (
      !create || create.class !== 'mutation' ||
      !update || update.class !== 'mutation' ||
      !remove || remove.class !== 'mutation' ||
      !webinarCreate || webinarCreate.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(create.cas).toBe('none')
    expect(create.externalEffect).toBe(true)
    expect(update.cas).toBe('native-idempotency')
    expect(remove.cas).toBe('native-idempotency')
    expect(remove.externalEffect).toBe(true)
    expect(webinarCreate.cas).toBe('none')
    expect(webinarCreate.externalEffect).toBe(true)
  })

  it('every capability declares at least one requiredScopes entry from the OAuth grant list', () => {
    const auth = zoomConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    const declared = new Set(auth.scopes)
    for (const cap of zoomConnector.manifest.capabilities) {
      expect(cap.requiredScopes && cap.requiredScopes.length).toBeGreaterThan(0)
      for (const scope of cap.requiredScopes ?? []) {
        expect(declared.has(scope)).toBe(true)
      }
    }
  })
})
