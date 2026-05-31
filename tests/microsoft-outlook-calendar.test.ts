import { describe, expect, it } from 'vitest'
import { microsoftOutlookCalendarConnector } from '../src/connectors/adapters/microsoft-outlook-calendar.js'

describe('microsoft-outlook-calendar adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the microsoft-outlook-calendar kind', () => {
    expect(microsoftOutlookCalendarConnector.manifest.kind).toBe('microsoft-outlook-calendar')
    expect(microsoftOutlookCalendarConnector.manifest.category).toBe('calendar')
    expect(microsoftOutlookCalendarConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth against the Microsoft identity platform v2.0 endpoints', () => {
    const auth = microsoftOutlookCalendarConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') {
      expect(auth.authorizationUrl).toBe(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      )
      expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
      expect(auth.scopes).toContain('offline_access')
      expect(auth.scopes).toContain('Calendars.ReadWrite')
    }
  })

  it('covers the full activepieces action set (create/delete/list events)', () => {
    const names = microsoftOutlookCalendarConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create.event', 'delete.event', 'list.events'].sort())
    const reads = microsoftOutlookCalendarConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = microsoftOutlookCalendarConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['list.events'])
    expect(mutations).toEqual(['create.event', 'delete.event'].sort())
  })
})
