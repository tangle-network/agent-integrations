import { describe, expect, it } from 'vitest'
import { googleMeetConnector } from '../src/connectors/adapters/google-meet.js'

describe('google-meet adapter manifest', () => {
  it('classifies itself as calendar and exposes the google-meet kind', () => {
    expect(googleMeetConnector.manifest.kind).toBe('google-meet')
    expect(googleMeetConnector.manifest.displayName).toBe('Google Meet')
    expect(googleMeetConnector.manifest.category).toBe('calendar')
    expect(googleMeetConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares Google OAuth2 with the documented endpoints and env-var names', () => {
    const auth = googleMeetConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    // offline access + consent forces refresh-token issuance on first connect.
    expect(auth.extraAuthParams?.access_type).toBe('offline')
    expect(auth.extraAuthParams?.prompt).toBe('consent')
  })

  it('requests the Meet space + Drive readonly scopes', () => {
    const auth = googleMeetConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/meetings.space.created')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/meetings.space.readonly')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/meetings.space.settings')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/drive.readonly')
    // All Google scopes are full URLs, not short ids.
    for (const scope of auth.scopes) {
      expect(scope.startsWith('https://www.googleapis.com/auth/')).toBe(true)
    }
  })

  it('covers spaces + conferenceRecords (participants, recordings, transcripts) with a read/mutation split', () => {
    const names = googleMeetConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'spaces.create',
        'spaces.get',
        'spaces.update',
        'spaces.endActiveConference',
        'conferenceRecords.list',
        'conferenceRecords.get',
        'conferenceRecords.participants.list',
        'conferenceRecords.recordings.list',
        'conferenceRecords.recordings.get',
        'conferenceRecords.transcripts.list',
        'conferenceRecords.transcripts.get',
      ].sort(),
    )
    const reads = googleMeetConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googleMeetConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'spaces.get',
        'conferenceRecords.list',
        'conferenceRecords.get',
        'conferenceRecords.participants.list',
        'conferenceRecords.recordings.list',
        'conferenceRecords.recordings.get',
        'conferenceRecords.transcripts.list',
        'conferenceRecords.transcripts.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      ['spaces.create', 'spaces.update', 'spaces.endActiveConference'].sort(),
    )
  })

  it('marks spaces.create as side-effectful with no upstream idempotency token (Meet has no requestId on this endpoint)', () => {
    const byName = new Map(googleMeetConnector.manifest.capabilities.map((c) => [c.name, c]))
    const create = byName.get('spaces.create')
    const update = byName.get('spaces.update')
    const end = byName.get('spaces.endActiveConference')
    if (
      !create || create.class !== 'mutation' ||
      !update || update.class !== 'mutation' ||
      !end || end.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(create.cas).toBe('none')
    expect(create.externalEffect).toBe(true)
    expect(update.cas).toBe('native-idempotency')
    expect(update.externalEffect).toBe(true)
    expect(end.cas).toBe('native-idempotency')
    expect(end.externalEffect).toBe(true)
  })

  it('every capability declares at least one requiredScopes entry from the OAuth grant list', () => {
    const auth = googleMeetConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    const declared = new Set(auth.scopes)
    for (const cap of googleMeetConnector.manifest.capabilities) {
      expect(cap.requiredScopes && cap.requiredScopes.length).toBeGreaterThan(0)
      for (const scope of cap.requiredScopes ?? []) {
        expect(declared.has(scope)).toBe(true)
      }
    }
  })

  it('contains no TODO/FIXME/placeholder text', () => {
    const json = JSON.stringify(googleMeetConnector.manifest)
    expect(json).not.toMatch(/TODO|FIXME|placeholder|xxx/i)
  })
})
