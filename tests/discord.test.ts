import { describe, expect, it } from 'vitest'
import { discordConnector } from '../src/connectors/adapters/discord.js'

describe('discord adapter manifest', () => {
  it('classifies itself as the comms category and exposes the discord kind', () => {
    expect(discordConnector.manifest.kind).toBe('discord')
    expect(discordConnector.manifest.category).toBe('comms')
    expect(discordConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares OAuth2 with the documented Discord endpoints and env-var names', () => {
    const auth = discordConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://discord.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://discord.com/api/oauth2/token')
    expect(auth.clientIdEnv).toBe('DISCORD_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('DISCORD_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('identify')
    expect(auth.scopes).toContain('guilds')
    expect(auth.scopes).toContain('guilds.members.read')
    expect(auth.scopes).toContain('messages.read')
  })

  it('covers the guild / channel / message / thread surface', () => {
    const names = discordConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.me',
        'guilds.list',
        'guilds.get',
        'guilds.channels.list',
        'guilds.members.list',
        'guilds.members.get',
        'channels.get',
        'channels.messages.list',
        'channels.messages.get',
        'channels.messages.create',
        'channels.messages.update',
        'channels.messages.delete',
        'channels.messages.reactions.create',
        'channels.threads.create',
      ].sort(),
    )
    const reads = discordConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = discordConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'channels.get',
        'channels.messages.get',
        'channels.messages.list',
        'guilds.channels.list',
        'guilds.get',
        'guilds.list',
        'guilds.members.get',
        'guilds.members.list',
        'users.me',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'channels.messages.create',
        'channels.messages.delete',
        'channels.messages.reactions.create',
        'channels.messages.update',
        'channels.threads.create',
      ].sort(),
    )
  })

  it('marks send_message as append-only (cas:none) and edits as optimistic-read-verify', () => {
    const cap = discordConnector.manifest.capabilities.find(
      (c) => c.name === 'channels.messages.create',
    )
    expect(cap?.class).toBe('mutation')
    if (cap?.class !== 'mutation') throw new Error('unreachable')
    expect(cap.cas).toBe('none')
    expect(cap.externalEffect).toBe(true)

    const edit = discordConnector.manifest.capabilities.find(
      (c) => c.name === 'channels.messages.update',
    )
    if (edit?.class !== 'mutation') throw new Error('unreachable')
    expect(edit.cas).toBe('optimistic-read-verify')

    const del = discordConnector.manifest.capabilities.find(
      (c) => c.name === 'channels.messages.delete',
    )
    if (del?.class !== 'mutation') throw new Error('unreachable')
    expect(del.cas).toBe('native-idempotency')
  })
})
