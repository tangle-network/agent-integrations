import { afterEach, describe, expect, it, vi } from 'vitest'
import { notion, notionConnector } from '../notion.js'

afterEach(() => vi.unstubAllGlobals())

describe('notionConnector', () => {
  it('exposes the Notion OAuth2 manifest with the /v1/ authorize endpoint', () => {
    expect(notionConnector.manifest.kind).toBe('notion')
    expect(notionConnector.manifest.displayName).toBe('Notion')

    const auth = notionConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    // Regression guard: Notion's authorize endpoint is /v1/oauth/authorize.
    // Dropping the /v1/ segment makes Notion reject the request with
    // `400 invalid_request_url`, so the connect flow never reaches consent.
    expect(auth.authorizationUrl).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.notion.com/v1/oauth/token')
    expect(auth.scopes).toEqual([])
    expect(auth.extraAuthParams).toEqual({ owner: 'user' })
    expect(auth.clientIdEnv).toBe('NOTION_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('NOTION_OAUTH_CLIENT_SECRET')
    expect(auth.tokenClientAuthMethod).toBe('client_secret_basic')
  })

  it('form-encodes Basic credentials and preserves workspace metadata', async () => {
    let request: RequestInit | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init
      return new Response(JSON.stringify({
        access_token: 'notion-access',
        workspace_id: 'workspace-1',
        workspace_name: 'Tangle',
        bot_id: 'bot-1',
      }))
    }))
    const adapter = notion({ clientId: 'client:id', clientSecret: 's+e%cret' })

    const result = await adapter.exchangeOAuth!({
      code: 'notion-code',
      state: 'notion-state',
      redirectUri: 'https://id.tangle.tools/v1/hub/connections/oauth/callback',
      codeVerifier: 'v'.repeat(43),
    })

    const authorization = new Headers(request?.headers).get('authorization')!
    expect(Buffer.from(authorization.slice('Basic '.length), 'base64').toString()).toBe(
      'client%3Aid:s%2Be%25cret',
    )
    const body = request?.body as URLSearchParams
    expect(body.has('client_id')).toBe(false)
    expect(body.has('client_secret')).toBe(false)
    expect(result.metadata).toMatchObject({
      botId: 'bot-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Tangle',
    })
  })

  it('redacts provider-reflected credentials from token failures', async () => {
    const clientSecret = 's"e\\c\nret'
    const encodedSecret = new URLSearchParams({ value: clientSecret })
      .toString()
      .slice('value='.length)
      .toLowerCase()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: clientSecret }), {
        status: 401,
        statusText: encodedSecret,
      })))
    const adapter = notion({ clientId: 'client:id', clientSecret })

    let caught: unknown
    try {
      await adapter.exchangeOAuth!({
        code: 'notion-code',
        state: 'notion-state',
        redirectUri: 'https://id.tangle.tools/v1/hub/connections/oauth/callback',
        codeVerifier: 'v'.repeat(43),
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('[REDACTED]')
    expect((caught as Error).message).not.toContain(encodedSecret)
    expect((caught as Error).message).not.toContain(
      JSON.stringify(clientSecret).slice(1, -1),
    )
  })
})
