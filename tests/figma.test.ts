import { afterEach, describe, expect, it, vi } from 'vitest'
import { figmaConnector } from '../src/connectors/adapters/figma'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types'

describe('figma adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('declares kind, category, and OAuth2 auth', () => {
    expect(figmaConnector.manifest.kind).toBe('figma')
    expect(figmaConnector.manifest.category).toBe('doc')
    expect(figmaConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('uses real Figma OAuth endpoints', () => {
    const auth = figmaConnector.manifest.auth
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
      'file_dev_resources:read',
      'file_versions:read',
      'library_content:read',
      'project_metadata:read',
      'team_library_content:read',
      'webhooks:write',
    ])
    expect(auth.scopes).not.toContain('files:read')
    expect(auth.scopes).not.toContain('projects:read')
    expect(auth.scopes).not.toContain('file_variables:read')
    expect(auth.scopes).not.toContain('library_analytics:read')
  })

  it('exposes a non-trivial set of capabilities including reads and at least one mutation', () => {
    const caps = figmaConnector.manifest.capabilities
    expect(caps.length).toBeGreaterThanOrEqual(10)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.get')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'files.comments.list')).toBe(true)
    expect(caps.some((c) => c.class === 'read' && c.name === 'projects.metadata.get')).toBe(true)
    expect(caps.some((c) => c.class === 'mutation' && c.name === 'files.comments.create')).toBe(true)
  })

  it('only advertises capabilities covered by the configured no-cost OAuth scopes', () => {
    const auth = figmaConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    const authScopes = new Set(auth.scopes)

    for (const capability of figmaConnector.manifest.capabilities) {
      for (const scope of capability.requiredScopes ?? []) {
        expect(authScopes.has(scope), `${capability.name} requires unconfigured scope ${scope}`).toBe(true)
      }
    }

    const names = figmaConnector.manifest.capabilities.map((capability) => capability.name)
    expect(names).not.toContain('files.variables.local')
    expect(names).not.toContain('files.variables.published')
    expect(names).not.toContain('analytics.library.component_usages')
    expect(names).not.toContain('teams.projects.list')
    expect(names).not.toContain('projects.files.list')

    const projectMetadata = figmaConnector.manifest.capabilities.find(
      (capability) => capability.name === 'projects.metadata.get',
    )
    expect(projectMetadata).toMatchObject({
      class: 'read',
      requiredScopes: ['project_metadata:read'],
    })
  })

  it('routes project metadata through the public-OAuth-compatible endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.figma.com/v1/projects/12345/meta')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer figma-token')
      return new Response(JSON.stringify({ id: '12345', name: 'Product' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const source: ResolvedDataSource = {
      id: 'figma_1',
      projectId: 'project_1',
      publishedAgentId: null,
      kind: 'figma',
      label: 'Figma',
      consistencyModel: 'authoritative',
      scopes: ['project_metadata:read'],
      metadata: {},
      credentials: { kind: 'oauth2', accessToken: 'figma-token' },
      status: 'active',
    }

    await expect(figmaConnector.executeRead!({
      source,
      capabilityName: 'projects.metadata.get',
      args: { project_id: '12345' },
      idempotencyKey: 'figma-meta-1',
    })).resolves.toMatchObject({ data: { id: '12345', name: 'Product' } })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(figmaConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = figmaConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = figmaConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(figmaConnector.executeRead)).toBe(hasReads)
    expect(Boolean(figmaConnector.executeMutation)).toBe(hasMutations)
  })
})
