import { describe, expect, it } from 'vitest'
import { notionConnector } from '../notion.js'

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
  })
})
