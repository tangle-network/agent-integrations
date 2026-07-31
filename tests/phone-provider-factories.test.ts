import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/index'

describe('phone provider factory pack', () => {
  it('activates six executable phone providers with their exact action surfaces', () => {
    const expected = {
      ringcentral: {
        envNames: ['RINGCENTRAL_OAUTH_CLIENT_ID', 'RINGCENTRAL_OAUTH_CLIENT_SECRET'],
        actions: [
          'callLog.list',
          'extension.get',
          'extensions.list',
          'messages.list',
          'sms.send',
          'subscriptions.create',
        ],
      },
      dialpad: {
        envNames: ['DIALPAD_OAUTH_CLIENT_ID', 'DIALPAD_OAUTH_CLIENT_SECRET'],
        actions: [
          'calls.get',
          'calls.list',
          'contacts.create',
          'contacts.list',
          'sms.send',
          'users.list',
        ],
      },
      aircall: {
        envNames: [],
        actions: [
          'calls.archive',
          'calls.comment',
          'calls.find',
          'calls.get',
          'calls.tag',
          'calls.transfer',
          'contacts.create',
          'contacts.delete',
          'contacts.find',
          'contacts.update',
          'numbers.assign',
        ],
      },
      'open-phone': {
        envNames: [],
        actions: [
          'calls.create',
          'calls.summary',
          'calls.transfer',
          'contacts.create',
          'contacts.delete',
          'contacts.update',
          'messages.list',
          'messages.send',
        ],
      },
      'twilio-sms': {
        envNames: [],
        actions: [
          'find_recent_messages',
          'list_numbers',
          'lookup_number',
          'redact_message',
          'send_mms',
          'send_sms',
          'send_whatsapp',
        ],
      },
      justcall: {
        envNames: [],
        actions: ['calls.get', 'calls.list', 'contacts.create', 'contacts.list', 'sms.send'],
      },
    } as const

    for (const [kind, { envNames, actions }] of Object.entries(expected)) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )
      expect(definition, kind).toBeDefined()
      expect(Object.values(definition!.envMap)).toEqual(envNames)

      const env = Object.fromEntries(envNames.map((name) => [name, `value-${name}`]))
      const options = resolveConnectorAdapterFactoryOptions(definition!, env)
      expect(options, kind).not.toBeNull()
      expect(
        definition!.factory(options ?? {}).manifest.capabilities.map((capability) => capability.name).sort(),
        kind,
      ).toEqual([...actions].sort())
    }
  })

  it('keeps requested phone products without a direct adapter out of the factory inventory', () => {
    for (const kind of ['vonage', '8x8', 'five9', 'talkdesk', 'cloudtalk']) {
      expect(
        CONNECTOR_ADAPTER_FACTORIES.some((candidate) => candidate.kind === kind),
        kind,
      ).toBe(false)
    }
  })

  it('fails closed when either OAuth application setting is missing', () => {
    for (const kind of ['ringcentral', 'dialpad']) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find(
        (candidate) => candidate.kind === kind,
      )!
      const [clientIdEnv] = Object.values(definition.envMap)
      expect(resolveConnectorAdapterFactoryOptions(definition, {
        [String(clientIdEnv)]: 'client-id',
      }), kind).toBeNull()
    }
  })
})
