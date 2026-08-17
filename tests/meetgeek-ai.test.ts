import { afterEach, describe, expect, it, vi } from 'vitest'
import { meetgeekAiConnector } from '../src/connectors/adapters/meetgeek-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_meetgeek_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'meetgeek-ai',
    label: 'MeetGeek test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'meetgeek_secret' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('meetgeek-ai adapter manifest', () => {
  it('classifies itself as the meetgeek-ai kind and falls back to the other category', () => {
    // The catalog tags MeetGeek as `workflow`, which is not in our manifest
    // category union; `other` is the canonical fallback for productivity-ish
    // tools that do not fit calendar/doc/comms cleanly.
    expect(meetgeekAiConnector.manifest.kind).toBe('meetgeek-ai')
    expect(meetgeekAiConnector.manifest.category).toBe('other')
    expect(meetgeekAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = meetgeekAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: list/get/transcript/highlights/insights + upload', () => {
    const names = meetgeekAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'meetings.list',
        'meetings.get',
        'meetings.transcript',
        'meetings.highlights',
        'meetings.summaryInsights',
        'recordings.upload',
      ].sort(),
    )
    const reads = meetgeekAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = meetgeekAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'meetings.list',
        'meetings.get',
        'meetings.transcript',
        'meetings.highlights',
        'meetings.summaryInsights',
      ].sort(),
    )
    expect(mutations).toEqual(['recordings.upload'])
  })
})

describe('meetgeek-ai execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists meetings for a team with bearer auth', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ meetings: [] })
    }))

    await meetgeekAiConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.list',
      args: { teamId: 'team_42' },
      idempotencyKey: 'meetgeek-read-team-42',
    })

    expect(requestUrl).toBe('https://api.meetgeek.ai/v1/teams/team_42/meetings')
    expect(requestHeaders.authorization).toBe('Bearer meetgeek_secret')
  })

  it('gets the summary for one meeting rather than an aggregate insights route', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ summary: 'Renewal agreed' })
    }))

    await meetgeekAiConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.summaryInsights',
      args: { meetingId: 'meeting_7' },
      idempotencyKey: 'meetgeek-read-summary-7',
    })

    expect(requestUrl).toBe('https://api.meetgeek.ai/v1/meetings/meeting_7/summary')
  })

  it('uploads a public recording through /upload with documented body names', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return jsonResponse({ meeting_id: 'meeting_8' }, 201)
    }))

    await meetgeekAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'recordings.upload',
      args: {
        downloadUrl: 'https://media.example.com/meeting.mp4',
        languageCode: 'en-US',
        templateName: 'Customer call',
      },
      idempotencyKey: 'meetgeek-upload-8',
    })

    expect(requestUrl).toBe('https://api.meetgeek.ai/v1/upload')
    expect(requestMethod).toBe('POST')
    expect(requestBody).toEqual({
      download_url: 'https://media.example.com/meeting.mp4',
      language_code: 'en-US',
      template_name: 'Customer call',
    })
  })

  it('surfaces rejected MeetGeek credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    await expect(meetgeekAiConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.get',
      args: { meetingId: 'meeting_7' },
      idempotencyKey: 'meetgeek-rejected-meeting-7',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
