import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chatwootConnector,
  CONNECTOR_ADAPTER_FACTORIES,
  mattermostConnector,
  matrixConnector,
  resolveConnectorAdapterFactoryOptions,
  telegramConnector,
} from '../src/connectors/adapters/index.js'
import type { ConnectorAdapter, ResolvedDataSource } from '../src/connectors/types.js'

const customerCredentialProviders = [
  'telegram',
  'mattermost',
  'matrix',
  'chatwoot',
] as const

function source(
  kind: string,
  metadata: Record<string, unknown>,
): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials: { kind: 'api-key', apiKey: '' },
    status: 'active',
  }
}

describe('team messaging credential boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [mattermostConnector, 'mattermost', { workspaceUrl: 'https://acme.mattermost.com' }],
    [matrixConnector, 'matrix', { homeserver: 'https://matrix.example.com' }],
    [chatwootConnector, 'chatwoot', { baseUrl: 'https://chat.example.com' }],
  ] as const)('rejects an empty %s API key before making a network request', async (
    adapter: ConnectorAdapter,
    kind,
    metadata,
  ) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(adapter.test(source(kind, metadata))).resolves.toEqual({
      ok: false,
      reason: 'declarative REST connectors require a non-empty API key',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an empty Telegram bot token before making a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(telegramConnector.test(source('telegram', {}))).resolves.toEqual({
      ok: false,
      reason: 'telegram: expected api-key credentials with the bot token as apiKey',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
