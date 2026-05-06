import type {
  CompleteAuthRequest,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationProvider,
  IntegrationProviderKind,
  IntegrationTriggerEvent,
  IntegrationTriggerSubscription,
  StartAuthRequest,
  StartAuthResult,
} from './index.js'
import { IntegrationError } from './index.js'

export interface CatalogExecutorInvocation {
  connection: IntegrationConnection
  request: IntegrationActionRequest
  connector: IntegrationConnector
  action: IntegrationConnector['actions'][number]
}

export interface CatalogExecutorProviderOptions {
  id: string
  kind: IntegrationProviderKind
  connectors: IntegrationConnector[]
  startAuth?: (request: StartAuthRequest) => Promise<StartAuthResult> | StartAuthResult
  completeAuth?: (request: CompleteAuthRequest) => Promise<IntegrationConnection> | IntegrationConnection
  executeAction: (invocation: CatalogExecutorInvocation) => Promise<IntegrationActionResult> | IntegrationActionResult
  subscribeTrigger?: (
    connection: IntegrationConnection,
    trigger: NonNullable<IntegrationConnector['triggers']>[number],
    targetUrl?: string,
  ) => Promise<IntegrationTriggerSubscription> | IntegrationTriggerSubscription
  unsubscribeTrigger?: (subscriptionId: string) => Promise<void> | void
  normalizeTriggerEvent?: (raw: unknown) => Promise<IntegrationTriggerEvent> | IntegrationTriggerEvent
}

export function createCatalogExecutorProvider(options: CatalogExecutorProviderOptions): IntegrationProvider {
  const byConnector = new Map(options.connectors.map((connector) => [connector.id, connector]))
  return {
    id: options.id,
    kind: options.kind,
    listConnectors: () => options.connectors,
    startAuth: options.startAuth,
    completeAuth: options.completeAuth,
    async invokeAction(connection, request) {
      const connector = byConnector.get(connection.connectorId)
      if (!connector) {
        throw new IntegrationError(`Connector ${connection.connectorId} not found.`, 'connector_not_found')
      }
      const action = connector.actions.find((candidate) => candidate.id === request.action)
      if (!action) {
        throw new IntegrationError(`Action ${request.action} is not defined by connector ${connector.id}.`, 'action_not_found')
      }
      return options.executeAction({ connection, request, connector, action })
    },
    async subscribeTrigger(connection, triggerId, targetUrl) {
      if (!options.subscribeTrigger) {
        throw new IntegrationError(`Provider ${options.id} does not support trigger subscriptions.`, 'action_not_found')
      }
      const connector = byConnector.get(connection.connectorId)
      if (!connector) {
        throw new IntegrationError(`Connector ${connection.connectorId} not found.`, 'connector_not_found')
      }
      const trigger = connector.triggers?.find((candidate) => candidate.id === triggerId)
      if (!trigger) {
        throw new IntegrationError(`Trigger ${triggerId} is not defined by connector ${connector.id}.`, 'action_not_found')
      }
      return options.subscribeTrigger(connection, trigger, targetUrl)
    },
    unsubscribeTrigger: options.unsubscribeTrigger,
    normalizeTriggerEvent: options.normalizeTriggerEvent,
  }
}
