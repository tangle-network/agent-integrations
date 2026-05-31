import { describe, expect, it } from 'vitest'
import { microsoft365PlannerConnector } from '../src/connectors/adapters/microsoft-365-planner.js'

describe('microsoft-365-planner adapter manifest', () => {
  it('identifies as microsoft-365-planner with an authoritative consistency model', () => {
    expect(microsoft365PlannerConnector.manifest.kind).toBe('microsoft-365-planner')
    // Catalog category is "chat"; chat-shaped Microsoft 365 surfaces map to `comms`
    // in the connector type union (microsoft-teams uses the same mapping).
    expect(microsoft365PlannerConnector.manifest.category).toBe('comms')
    expect(microsoft365PlannerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 against the Microsoft identity platform v2.0 endpoints', () => {
    const auth = microsoft365PlannerConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    )
    expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(auth.clientIdEnv).toBe('MS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MS_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('offline_access')
    expect(auth.scopes).toContain('Tasks.ReadWrite')
  })

  it('covers the catalog action set: plan + bucket + task CRUD', () => {
    const names = microsoft365PlannerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.bucket',
        'create.plan',
        'create.task',
        'delete.bucket',
        'delete.task',
        'find.aplan',
        'find.task',
        'get.abucket',
        'update.bucket',
        'update.plan',
        'update.task',
      ].sort(),
    )
  })

  it('splits reads from mutations consistently with the catalog risk labels', () => {
    const reads = microsoft365PlannerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = microsoft365PlannerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['find.aplan', 'find.task', 'get.abucket'])
    expect(mutations).toEqual(
      [
        'create.bucket',
        'create.plan',
        'create.task',
        'delete.bucket',
        'delete.task',
        'update.bucket',
        'update.plan',
        'update.task',
      ].sort(),
    )
  })

  it('declares If-Match etag concurrency on Planner deletes and patches', () => {
    const mutationCasByName = new Map(
      microsoft365PlannerConnector.manifest.capabilities
        .filter((c): c is typeof c & { class: 'mutation'; cas: string } => c.class === 'mutation')
        .map((c) => [c.name, c.cas]),
    )
    // DELETEs against Planner require the resource etag — etag-if-match models that.
    expect(mutationCasByName.get('delete.bucket')).toBe('etag-if-match')
    expect(mutationCasByName.get('delete.task')).toBe('etag-if-match')
    // PATCHes require an etag-guarded read-then-write loop.
    expect(mutationCasByName.get('update.plan')).toBe('optimistic-read-verify')
    expect(mutationCasByName.get('update.bucket')).toBe('optimistic-read-verify')
    expect(mutationCasByName.get('update.task')).toBe('optimistic-read-verify')
  })
})
