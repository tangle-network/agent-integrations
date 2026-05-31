import { describe, expect, it } from 'vitest'
import { telegramConnector, TELEGRAM_FILE_DOWNLOAD_ROOT } from '../src/connectors/adapters/telegram.js'

describe('telegram adapter manifest', () => {
  it('identifies as the comms / telegram kind with an advisory consistency model', () => {
    expect(telegramConnector.manifest.kind).toBe('telegram')
    expect(telegramConnector.manifest.category).toBe('comms')
    expect(telegramConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth (Telegram has no OAuth — the bot token IS the credential)', () => {
    const auth = telegramConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/BotFather/i)
  })

  it('covers the bot messaging + chat + webhook surface', () => {
    const names = telegramConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'getMe',
        'getChat',
        'getChatAdministrators',
        'getChatMember',
        'getChatMemberCount',
        'getUpdates',
        'getFile',
        'getWebhookInfo',
        'sendMessage',
        'sendPhoto',
        'sendDocument',
        'forwardMessage',
        'editMessageText',
        'deleteMessage',
        'answerCallbackQuery',
        'setWebhook',
        'deleteWebhook',
      ].sort(),
    )

    const reads = telegramConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = telegramConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(
      [
        'getMe',
        'getChat',
        'getChatAdministrators',
        'getChatMember',
        'getChatMemberCount',
        'getUpdates',
        'getFile',
        'getWebhookInfo',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'sendMessage',
        'sendPhoto',
        'sendDocument',
        'forwardMessage',
        'editMessageText',
        'deleteMessage',
        'answerCallbackQuery',
        'setWebhook',
        'deleteWebhook',
      ].sort(),
    )
  })

  it('marks sendMessage as append-only (cas:none), edits as optimistic-read-verify, idempotent ops as native-idempotency', () => {
    const send = telegramConnector.manifest.capabilities.find((c) => c.name === 'sendMessage')
    if (send?.class !== 'mutation') throw new Error('unreachable')
    expect(send.cas).toBe('none')
    expect(send.externalEffect).toBe(true)

    const edit = telegramConnector.manifest.capabilities.find((c) => c.name === 'editMessageText')
    if (edit?.class !== 'mutation') throw new Error('unreachable')
    expect(edit.cas).toBe('optimistic-read-verify')

    const del = telegramConnector.manifest.capabilities.find((c) => c.name === 'deleteMessage')
    if (del?.class !== 'mutation') throw new Error('unreachable')
    expect(del.cas).toBe('native-idempotency')

    const callbackAck = telegramConnector.manifest.capabilities.find((c) => c.name === 'answerCallbackQuery')
    if (callbackAck?.class !== 'mutation') throw new Error('unreachable')
    expect(callbackAck.cas).toBe('native-idempotency')

    const webhook = telegramConnector.manifest.capabilities.find((c) => c.name === 'setWebhook')
    if (webhook?.class !== 'mutation') throw new Error('unreachable')
    expect(webhook.cas).toBe('native-idempotency')
  })

  it('rate-limits the bot under Telegram\'s documented 30 msg/sec ceiling', () => {
    expect(telegramConnector.manifest.rateLimit).toBeDefined()
    expect(telegramConnector.manifest.rateLimit?.requests).toBeLessThanOrEqual(30)
    expect(telegramConnector.manifest.rateLimit?.windowMs).toBe(1_000)
  })

  it('exposes the public file-download root used to assemble getFile URLs', () => {
    expect(TELEGRAM_FILE_DOWNLOAD_ROOT).toBe('https://api.telegram.org/file')
  })

  it('test() rejects malformed bot tokens before hitting the network', async () => {
    const result = await telegramConnector.test({
      id: 'src-test',
      projectId: 'proj',
      publishedAgentId: null,
      kind: 'telegram',
      label: 'test',
      consistencyModel: 'advisory',
      scopes: [],
      metadata: {},
      credentials: { kind: 'api-key', apiKey: 'this-is-not-a-bot-token' },
      status: 'active',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toMatch(/BotFather|token/i)
  })
})
