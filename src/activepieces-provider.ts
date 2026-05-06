import {
  buildActivepiecesConnectors,
  listActivepiecesCatalogEntries,
  type ActivepiecesCatalogEntry,
} from './activepieces-catalog.js'
import { createCatalogExecutorProvider } from './catalog-executor.js'
import type {
  CompleteAuthRequest,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationProvider,
  StartAuthRequest,
  StartAuthResult,
} from './index.js'
import { IntegrationError } from './index.js'

export interface ActivepiecesExecutorInvocation {
  connection: IntegrationConnection
  request: IntegrationActionRequest
  connector: IntegrationConnector
  catalogEntry: ActivepiecesCatalogEntry
  piece: {
    id: string
    npmPackage?: string
    version?: string
    actionId: string
    upstreamActionName?: string
  }
}

export interface ActivepiecesExecutorProviderOptions {
  id?: string
  connectors?: IntegrationConnector[]
  startAuth?: (request: StartAuthRequest) => Promise<StartAuthResult> | StartAuthResult
  completeAuth?: (request: CompleteAuthRequest) => Promise<IntegrationConnection> | IntegrationConnection
  executeAction: (invocation: ActivepiecesExecutorInvocation) => Promise<IntegrationActionResult> | IntegrationActionResult
}

export function createActivepiecesExecutorProvider(options: ActivepiecesExecutorProviderOptions): IntegrationProvider {
  const providerId = options.id ?? 'activepieces'
  const connectors = options.connectors ?? buildActivepiecesConnectors({
    providerId,
    includeCatalogActions: true,
    executable: true,
  })
  const byEntry = new Map(listActivepiecesCatalogEntries().map((entry) => [entry.id, entry]))

  return createCatalogExecutorProvider({
    id: providerId,
    kind: 'activepieces',
    connectors,
    startAuth: options.startAuth,
    completeAuth: options.completeAuth,
    executeAction: async ({ connection, request, connector, action }) => {
      const catalogEntry = byEntry.get(connector.id)
      if (!catalogEntry) {
        throw new IntegrationError(`Activepieces catalog entry ${connector.id} not found.`, 'connector_not_found')
      }
      const catalogAction = catalogEntry.actions.find((candidate) => candidate.id === action.id)
      return options.executeAction({
        connection,
        request,
        connector,
        catalogEntry,
        piece: {
          id: catalogEntry.id,
          npmPackage: catalogEntry.npmPackage,
          version: catalogEntry.version,
          actionId: action.id,
          upstreamActionName: catalogAction?.upstreamName,
        },
      })
    },
  })
}
