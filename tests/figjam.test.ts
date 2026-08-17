import { afterEach, describe, expect, it, vi } from 'vitest'
import { figjamConnector } from '../src/connectors/adapters/figjam'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types'

describe('figjam adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

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
    expect(auth.scopes).toEqual([
      'current_user:read',
      'file_comments:read',
      'file_comments:write',
      'file_content:read',
      'file_versions:read',
      'project_metadata:read',
      'webhooks:write',
    ])
    expect(auth.scopes).not.toContain('files:read')
    expect(auth.scopes).not.toContain('projects:read')
  })

  it('exposes board read + project metadata + comment mutation capabilities', () => {
    const caps = figjamConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(10)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.get')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.nodes')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.images')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.comments.list')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'projects.metadata.get')).toBe(true)
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
    expect(names).not.toContain('teams.projects.list')
    expect(names).not.toContain('projects.files.list')

    const projectMetadata = figjamConnector.manifest.capabilities.find(
      (capability) => capability.name === 'projects.metadata.get',
    )
    expect(projectMetadata).toMatchObject({
      class: 'read',
      requiredScopes: ['project_metadata:read'],
    })
  })

  it('routes project metadata through the public-OAuth-compatible endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.figma.com/v1/projects/67890/meta')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer figjam-token')
      return new Response(JSON.stringify({ id: '67890', name: 'Workshop' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const source: ResolvedDataSource = {
      id: 'figjam_1',
      projectId: 'project_1',
      publishedAgentId: null,
      kind: 'figjam',
      label: 'FigJam',
      consistencyModel: 'authoritative',
      scopes: ['project_metadata:read'],
      metadata: {},
      credentials: { kind: 'oauth2', accessToken: 'figjam-token' },
      status: 'active',
    }

    await expect(figjamConnector.executeRead!({
      source,
      capabilityName: 'projects.metadata.get',
      args: { project_id: '67890' },
      idempotencyKey: 'figjam-meta-1',
    })).resolves.toMatchObject({ data: { id: '67890', name: 'Workshop' } })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('all mutation capabilities declare native-idempotency CAS (Figma POSTs reject duplicate writes server-side)', () => {
    const mutations = figjamConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('narrowing')
      expect(m.cas).toBe('native-idempotency')
    }
  })

  it('only advertises capabilities covered by the configured OAuth scopes', () => {
    const auth = figjamConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    const authScopes = new Set(auth.scopes)

    for (const capability of figjamConnector.manifest.capabilities) {
      for (const scope of capability.requiredScopes ?? []) {
        expect(authScopes.has(scope), `${capability.name} requires unconfigured scope ${scope}`).toBe(true)
      }
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
