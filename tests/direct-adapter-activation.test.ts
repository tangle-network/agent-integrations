import { describe, expect, it } from 'vitest'
import * as adapters from '../src/connectors/adapters/index.js'

const activated = [
  ['actualbudget', 'actualbudgetConnector'],
  ['aianswer', 'aianswerConnector'],
  ['airparser', 'airparserConnector'],
  ['anyhook-websocket', 'anyhookWebsocketConnector'],
  ['apify', 'apifyConnector'],
  ['ask-handle', 'askHandleConnector'],
  ['bannerbear', 'bannerbearConnector'],
  ['base44', 'base44Connector'],
  ['beehiiv', 'beehiivConnector'],
  ['bika', 'bikaConnector'],
  ['buttondown', 'buttondownConnector'],
  ['camb-ai', 'cambAiConnector'],
  ['cartloom', 'cartloomConnector'],
  ['chain-aware', 'chainAwareConnector'],
  ['chaindesk', 'chaindeskConnector'],
  ['chat-aid', 'chatAidConnector'],
  ['chatsistant', 'chatsistantConnector'],
  ['claude', 'claudeConnector'],
  ['clearoutphone', 'clearoutphoneConnector'],
  ['clickfunnels', 'clickfunnelsConnector'],
  ['cody', 'codyConnector'],
  ['contextual-ai', 'contextualAiConnector'],
  ['contiguity', 'contiguityConnector'],
  ['couchbase', 'couchbaseConnector'],
  ['dappier', 'dappierConnector'],
  ['deepgram', 'deepgramConnector'],
  ['detecting-ai', 'detectingAiConnector'],
  ['digital-pilot', 'digitalPilotConnector'],
  ['docsbot', 'docsbotConnector'],
  ['drip', 'dripConnector'],
  ['echowin', 'echowinConnector'],
  ['elevenlabs', 'elevenlabsConnector'],
  ['everhour', 'everhourConnector'],
  ['feathery', 'featheryConnector'],
  ['fellow', 'fellowConnector'],
  ['flow-parser', 'flowParserConnector'],
  ['gamma', 'gammaConnector'],
  ['gender-api', 'genderApiConnector'],
  ['generatebanners', 'generatebannersConnector'],
  ['giftbit', 'giftbitConnector'],
  ['modelslab', 'modelslabConnector'],
] as const

describe('direct adapter activation inventory', () => {
  it('exports every activated provider and registers one loadable factory', () => {
    const definitions = adapters.CONNECTOR_ADAPTER_FACTORIES
    const factoryKinds = definitions.map((definition) => definition.kind)
    expect(new Set(factoryKinds).size).toBe(factoryKinds.length)

    for (const [kind, exportName] of activated) {
      const adapter = adapters[exportName]
      expect(adapter, exportName).toBeDefined()
      expect(adapter.manifest.kind, exportName).toBe(kind)

      const definition = definitions.find((candidate) => candidate.kind === kind)
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual({})
      expect(adapters.resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
    }
  })

  it('keeps every state-changing operation behind external-effect approval metadata', () => {
    for (const [kind, exportName] of activated) {
      const adapter = adapters[exportName]
      for (const capability of adapter.manifest.capabilities) {
        if (capability.class !== 'mutation') continue
        expect(capability.externalEffect, `${kind}:${capability.name}`).toBe(true)
      }
    }
  })
})
