import { describe, expect, it } from 'vitest'
import { canonicalIntegrationKind } from '../src/integration-kind-aliases.js'

describe('integration kind aliases', () => {
  it('uses one canonical provider id across catalog and direct adapters', () => {
    expect(canonicalIntegrationKind('help-scout')).toBe('helpscout')
    expect(canonicalIntegrationKind('microsoft-onedrive')).toBe('onedrive')
    expect(canonicalIntegrationKind('microsoft-outlook')).toBe('outlook-mail')
    expect(canonicalIntegrationKind('microsoft-outlook-calendar')).toBe('microsoft-calendar')
    expect(canonicalIntegrationKind('microsoft-sharepoint')).toBe('sharepoint')
    expect(canonicalIntegrationKind('mycase-piece')).toBe('mycase')
    expect(canonicalIntegrationKind('telegram-bot')).toBe('telegram')
  })

  it('preserves provider ids that are already canonical', () => {
    expect(canonicalIntegrationKind('recurly')).toBe('recurly')
    expect(canonicalIntegrationKind('mycase')).toBe('mycase')
  })
})
