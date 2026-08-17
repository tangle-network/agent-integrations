import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index.js'

describe('automation bridge provider factories', () => {
  it('registers four customer-credential adapters with exact action surfaces', () => {
    const expected = {
      zapier: ['actions.execute', 'actions.list', 'triggers.catch', 'zaps.get', 'zaps.list'],
      make: [
        'executions.get',
        'executions.list',
        'hooks.trigger',
        'scenarios.activate',
        'scenarios.deactivate',
        'scenarios.get',
        'scenarios.list',
        'scenarios.run',
      ],
      n8n: [
        'executions.delete',
        'executions.get',
        'executions.list',
        'executions.stop',
        'webhooks.trigger',
        'workflows.activate',
        'workflows.create',
        'workflows.deactivate',
        'workflows.delete',
        'workflows.get',
        'workflows.list',
        'workflows.update',
      ],
      pipedream: [
        'http.trigger',
        'sources.create',
        'sources.events',
        'sources.list',
        'subscriptions.create',
        'subscriptions.delete',
        'workflows.deploy',
        'workflows.disable',
        'workflows.get',
        'workflows.list',
      ],
    } as const

    for (const [kind, actions] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
      expect(
        definition!.factory({}).manifest.capabilities.map((capability) => capability.name).sort(),
        kind,
      ).toEqual([...actions].sort())
    }
  })

  it('keeps enterprise bridges without a direct adapter hidden', () => {
    for (const kind of ['workato', 'tray', 'mulesoft', 'boomi', 'celigo']) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })
})
