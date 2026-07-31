import { describe, expect, it } from 'vitest'
import { getIntegrationSpec } from '../src/specs/index.js'
import { buildDefaultIntegrationRegistry } from '../src/registry.js'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
  rssConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

describe('universal access provider packs', () => {
  it.each([
    'http',
    'rss',
    'amazon-s3',
    'amazon-sns',
    'amazon-sqs',
    'amazon-eventbridge',
    'gcloud-pubsub',
    'azure-service-bus',
    'azure-event-grid',
    'kafka',
    'sftp',
    'csv-files',
    'excel-files',
    'parquet-files',
  ])('%s is executable from a shipped adapter', (kind) => {
    const spec = getIntegrationSpec(kind)
    expect(spec?.status).toBe('executable')
    expect(spec?.actions.length).toBeGreaterThan(0)
  })

  it.each([
    'http',
    'rss',
    'amazon-s3',
    'amazon-sns',
    'amazon-sqs',
    'amazon-eventbridge',
    'gcloud-pubsub',
    'azure-service-bus',
    'azure-event-grid',
    'kafka',
    'sftp',
    'csv-files',
    'excel-files',
    'parquet-files',
  ])(
    '%s is runnable by Hub without a shared deployment secret',
    (kind) => {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition?.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
      expect(definition?.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    },
  )

  it('keeps aws-s3 as an alias for the canonical Amazon S3 adapter', () => {
    const registry = buildDefaultIntegrationRegistry()
    expect(registry.byId.get('aws-s3')).toBe(registry.byId.get('amazon-s3'))
  })

  it('keeps google-pubsub as an alias for the catalog Google Cloud Pub/Sub adapter', () => {
    const registry = buildDefaultIntegrationRegistry()
    expect(registry.byId.get('google-pubsub')).toBe(registry.byId.get('gcloud-pubsub'))
  })

  it('maps universal provider events into the shared event contract', () => {
    expect(getIntegrationSpec('kafka')?.triggers?.map((trigger) => trigger.id)).toEqual(['event.received'])
    expect(getIntegrationSpec('sftp')?.triggers?.map((trigger) => trigger.id)).toEqual(undefined)
  })

  it('rejects a private pinned RSS target before issuing a request', async () => {
    const source: ResolvedDataSource = {
      id: 'rss_private',
      projectId: 'project_1',
      publishedAgentId: null,
      kind: 'rss',
      label: 'Private RSS',
      consistencyModel: 'cache',
      scopes: [],
      metadata: { feedUrl: 'http://169.254.169.254/latest/meta-data' },
      credentials: { kind: 'none' },
      status: 'active',
    }
    await expect(rssConnector.executeRead!({
      source,
      capabilityName: 'feed.fetch',
      args: {},
      idempotencyKey: 'rss_1',
    })).rejects.toThrow(/not a public network target/)
  })
})
