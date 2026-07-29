import { describe, expect, it } from 'vitest'
import { getIntegrationSpec, resolveConnectorAuthSpec } from '../src/specs/index.js'
import { buildDefaultIntegrationRegistry } from '../src/registry.js'

describe('Google Workspace and Microsoft 365 provider packs', () => {
  it.each([
    'google-contacts',
    'google-slides',
    'googlechat',
    'google-tasks',
    'microsoft-excel-365',
    'microsoft-365-people',
    'microsoft-365-planner',
    'microsoft-todo',
    'microsoft-onenote',
    'microsoft-dynamics-crm',
    'microsoft-dynamics-365-business-central',
    'microsoft-power-bi',
  ])('%s is executable from its shipped adapter', (kind) => {
    const spec = getIntegrationSpec(kind)
    expect(spec?.status).toBe('executable')
    expect(spec?.actions.length).toBeGreaterThan(0)
  })

  it('uses the shared Google and Microsoft OAuth applications', () => {
    expect(resolveConnectorAuthSpec('google-contacts')).toMatchObject({
      authKind: 'oauth2',
      clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    })
    expect(resolveConnectorAuthSpec('microsoft-excel-365')).toMatchObject({
      authKind: 'oauth2',
      clientIdEnv: 'MS_OAUTH_CLIENT_ID',
      clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
    })
  })

  it.each(['microsoft-forms', 'microsoft-word'])('%s remains contract-only without invented actions', (kind) => {
    const spec = getIntegrationSpec(kind)
    expect(spec?.status).toBe('catalog')
    expect(spec?.auth.mode).toBe('custom')
    expect(spec?.actions).toEqual([])
  })

  it('keeps the previous Microsoft Excel id as a registry alias', () => {
    const registry = buildDefaultIntegrationRegistry()
    expect(registry.byId.get('microsoft-excel')).toBe(registry.byId.get('microsoft-excel-365'))
  })

  it('declares shared relationship events across CRM and work-management providers', () => {
    expect(getIntegrationSpec('microsoft-dynamics-crm')?.triggers?.map((trigger) => trigger.id)).toEqual([
      'person.changed',
      'company.changed',
      'opportunity.changed',
      'stage.changed',
      'owner.changed',
      'record.deleted',
    ])
    expect(getIntegrationSpec('google-tasks')?.triggers?.map((trigger) => trigger.id)).toEqual([
      'task.changed',
      'task.overdue',
    ])
  })
})
