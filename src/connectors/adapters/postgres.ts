import type { ConnectorAdapter } from '../types.js'
import {
  createPostgresWireReadConnector,
  type PostgresWireReadConnectorOptions,
  type PostgresWireReadProviderDefinition,
} from './redshift.js'

const POSTGRES_PROVIDER: PostgresWireReadProviderDefinition = {
  kind: 'postgres',
  displayName: 'PostgreSQL',
  description: 'Inspect PostgreSQL schemas and tables and run bounded structured row reads over a verified TLS connection.',
  authHint: 'JSON with a public PostgreSQL host, database, user, password, optional port, and optional TLS CA. Verified TLS is mandatory.',
  defaultPort: 5432,
}

export type PostgresConnectorOptions = PostgresWireReadConnectorOptions

export function createPostgresConnector(options: PostgresConnectorOptions = {}): ConnectorAdapter {
  return createPostgresWireReadConnector(POSTGRES_PROVIDER, options)
}

export const postgresConnector = createPostgresConnector()
