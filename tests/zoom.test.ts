import { afterEach, describe, expect, it, vi } from 'vitest'
import { zoomConnector } from '../src/connectors/adapters/zoom.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function zoomSource(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zoom_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zoom',
    label: 'Zoom test',
    consistencyModel: 'authoritative',
    scopes: ['meeting:update:meeting', 'webinar:update:webinar', 'webinar:delete:webinar', 'recording:write:recording', 'user:write:user'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'zoom_tok' },
    status: 'active',
    ...overrides,
  }
}

function zoomJson(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

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
        'users.create',
        'meetings.list',
        'meetings.get',
        'meetings.create',
        'meetings.update',
        'meetings.delete',
        'meetings.end',
        'meetings.list-registrants',
        'meetings.add-registrant',
        'webinars.list',
        'webinars.get',
        'webinars.create',
        'webinars.update',
        'webinars.delete',
        'recordings.list',
        'recordings.get',
        'recordings.delete',
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
        'meetings.end',
        'meetings.update',
        'recordings.delete',
        'users.create',
        'webinars.create',
        'webinars.delete',
        'webinars.update',
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

  it('marks the new write-side mutations as native-idempotency external effect', () => {
    const byName = new Map(zoomConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const name of ['meetings.end', 'webinars.update', 'webinars.delete', 'recordings.delete', 'users.create']) {
      const cap = byName.get(name)
      if (!cap || cap.class !== 'mutation') throw new Error(`expected mutation ${name}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('zoom new mutations', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ends a live meeting with PUT /status action=end', async () => {
    let url: string | undefined
    let method: string | undefined
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        method = init?.method
        body = init?.body as string | undefined
        return zoomJson(null, { status: 204 })
      }),
    )

    const result = await zoomConnector.executeMutation!({
      source: zoomSource(),
      capabilityName: 'meetings.end',
      args: { meetingId: '99887766' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(method).toBe('PUT')
    expect(url).toBe('https://api.zoom.us/v2/meetings/99887766/status')
    expect(JSON.parse(body ?? '{}')).toEqual({ action: 'end' })
  })

  it('updates a webinar with PATCH and an optional body subset', async () => {
    let url: string | undefined
    let method: string | undefined
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        method = init?.method
        body = init?.body as string | undefined
        return zoomJson(null, { status: 204 })
      }),
    )

    await zoomConnector.executeMutation!({
      source: zoomSource(),
      capabilityName: 'webinars.update',
      args: { webinarId: 'WBN1', topic: 'Renamed', duration: 45 },
      idempotencyKey: 'k-1',
    })

    expect(method).toBe('PATCH')
    expect(url).toContain('/v2/webinars/WBN1')
    // The body template carries optional fields; unset ones resolve to
    // undefined under renderValue's exact-match branch, leaving the key with
    // undefined → JSON.stringify drops them.
    const parsed = JSON.parse(body ?? '{}') as Record<string, unknown>
    expect(parsed.topic).toBe('Renamed')
    expect(parsed.duration).toBe(45)
  })

  it('deletes a webinar with DELETE + optional query flags', async () => {
    let url: string | undefined
    let method: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        method = init?.method
        return zoomJson(null, { status: 204 })
      }),
    )

    await zoomConnector.executeMutation!({
      source: zoomSource(),
      capabilityName: 'webinars.delete',
      args: { webinarId: 'WBN2', cancel_webinar_reminder: true },
      idempotencyKey: 'k-1',
    })

    expect(method).toBe('DELETE')
    expect(url).toContain('/v2/webinars/WBN2')
    expect(url).toContain('cancel_webinar_reminder=true')
  })

  it('deletes a cloud recording via DELETE /meetings/{id}/recordings with action query', async () => {
    let url: string | undefined
    let method: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        method = init?.method
        return zoomJson(null, { status: 204 })
      }),
    )

    await zoomConnector.executeMutation!({
      source: zoomSource(),
      capabilityName: 'recordings.delete',
      args: { meetingId: 'M_REC_1', action: 'trash' },
      idempotencyKey: 'k-1',
    })

    expect(method).toBe('DELETE')
    expect(url).toContain('/v2/meetings/M_REC_1/recordings')
    expect(url).toContain('action=trash')
  })

  it('creates a user via POST /users with action + user_info', async () => {
    let url: string | undefined
    let method: string | undefined
    let body: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        method = init?.method
        body = init?.body as string | undefined
        return zoomJson({ id: 'USR_1', email: 'new@example.com' }, { status: 201 })
      }),
    )

    await zoomConnector.executeMutation!({
      source: zoomSource(),
      capabilityName: 'users.create',
      args: {
        action: 'create',
        user_info: { email: 'new@example.com', type: 1, first_name: 'Ada', last_name: 'Lovelace' },
      },
      idempotencyKey: 'k-1',
    })

    expect(method).toBe('POST')
    expect(url).toBe('https://api.zoom.us/v2/users')
    expect(JSON.parse(body ?? '{}')).toEqual({
      action: 'create',
      user_info: { email: 'new@example.com', type: 1, first_name: 'Ada', last_name: 'Lovelace' },
    })
  })

  it('surfaces CredentialsExpired on 401 for the new mutations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      zoomConnector.executeMutation!({
        source: zoomSource(),
        capabilityName: 'meetings.end',
        args: { meetingId: '99887766' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
