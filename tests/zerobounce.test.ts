import { describe, expect, it } from 'vitest'
import { zerobounceConnector, validateConnectorManifest } from '../src/connectors/index'

describe('zerobounce connector', () => {
  it('ships a valid connector manifest', () => {
    const result = validateConnectorManifest(zerobounceConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('has correct kind, category, and auth kind', () => {
    expect(zerobounceConnector.manifest.kind).toBe('zerobounce')
    expect(zerobounceConnector.manifest.category).toBe('crm')
    expect(zerobounceConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes mutation capabilities', () => {
    const hasMutations = zerobounceConnector.manifest.capabilities.some(
      (capability) => capability.class === 'mutation',
    )
    expect(hasMutations).toBe(true)
    expect(zerobounceConnector.executeMutation).toBeDefined()
  })

  it('has validate.email capability', () => {
    const validateEmailCap = zerobounceConnector.manifest.capabilities.find(
      (cap) => cap.name === 'validate.email',
    )
    expect(validateEmailCap).toBeDefined()
    expect(validateEmailCap?.class).toBe('mutation')
  })
})
