import { describe, expect, it } from 'vitest'
import { figjamConnector } from '../src/connectors/adapters/figjam'
import { validateConnectorManifest } from '../src/connectors/types'

describe('figjam adapter', () => {
  it('declares kind, category, and OAuth2 auth', () => {
    expect(figjamConnector.manifest.kind).toBe('figjam')
    expect(figjamConnector.manifest.category).toBe('doc')
    expect(figjamConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Figma OAuth endpoints (FigJam shares the Figma OAuth app)', () => {
    const auth = figjamConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://www.figma.com/oauth')
    expect(auth.tokenUrl).toBe('https://api.figma.com/v1/oauth/token')
    expect(auth.clientIdEnv).toBe('FIGMA_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('FIGMA_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['files:read', 'file_comments:write', 'webhooks:write']),
    )
  })

  it('exposes board read + project listing + comment mutation capabilities', () => {
    const caps = figjamConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(10)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.get')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.nodes')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.images')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.comments.list')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'projects.files.list')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'files.comments.create')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'files.comments.delete')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'webhooks.create')).toBe(true)
  })

  it('does NOT advertise Figma-design-only surfaces (components, styles, variables, dev resources, library analytics)', () => {
    const names = figjamConnector.manifest.capabilities.map((c) => c.name)
    expect(names).not.toContain('files.components.list')
    expect(names).not.toContain('files.component_sets.list')
    expect(names).not.toContain('files.styles.list')
    expect(names).not.toContain('files.variables.local')
    expect(names).not.toContain('files.variables.published')
    expect(names).not.toContain('files.dev_resources.list')
    expect(names).not.toContain('analytics.library.component_usages')
    expect(names).not.toContain('teams.components.list')
    expect(names).not.toContain('teams.styles.list')
  })

  it('all mutation capabilities declare native-idempotency CAS (Figma POSTs reject duplicate writes server-side)', () => {
    const mutations = figjamConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('narrowing')
      expect(m.cas).toBe('native-idempotency')
    }
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(figjamConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = figjamConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = figjamConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(figjamConnector.executeRead)).toBe(hasReads)
    expect(Boolean(figjamConnector.executeMutation)).toBe(hasMutations)
  })
})
