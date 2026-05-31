import { declarativeRestConnector } from './declarative-rest.js'

// HashiCorp Vault: the Vault address is per-installation (customer-supplied),
// so the base URL is sourced from connection metadata.vaultUrl. Authentication
// uses the X-Vault-Token header — the API key value held by the connector is
// treated as an already-issued client token (the AppRole / token-auth login
// flow runs out-of-band before connection setup).
//
// Capability paths target the KV v2 secrets engine (the default and the only
// engine wired here), which prefixes /v1/{mount}/data/* for CRUD on secret
// payloads, /v1/{mount}/metadata/* for delete and list, and exposes a
// per-secret version on read.
export const hashiCorpVaultConnector = declarativeRestConnector({
  kind: 'hashi-corp-vault',
  displayName: 'HashiCorp Vault',
  description: 'Read, write, list, and delete secrets in a HashiCorp Vault KV v2 secrets engine.',
  auth: { kind: 'api-key', hint: 'Vault client token (X-Vault-Token). For AppRole, exchange role_id+secret_id for a token first.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'vaultUrl' },
  credentialPlacement: { kind: 'header', header: 'X-Vault-Token' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/v1/sys/health' },
  capabilities: [
    {
      name: 'secrets.read',
      class: 'read',
      description: 'Read a secret from a KV v2 secrets engine. Pass version=0 (or omit) for the latest version.',
      parameters: {
        type: 'object',
        properties: {
          secretEngine: { type: 'string', description: 'KV v2 mount path (e.g. "secret").' },
          secretPath: { type: 'string', description: 'Secret path within the engine (e.g. "myapp/database").' },
          version: { type: 'integer', description: 'Optional secret version; omit or 0 for latest.' },
        },
        required: ['secretEngine', 'secretPath'],
      },
      request: {
        method: 'GET',
        path: '/v1/{secretEngine}/data/{secretPath}',
        query: { version: '{version}' },
      },
    },
    {
      name: 'secrets.write',
      class: 'mutation',
      description: 'Create or update a secret in a KV v2 secrets engine.',
      parameters: {
        type: 'object',
        properties: {
          secretEngine: { type: 'string' },
          secretPath: { type: 'string' },
          secretData: { type: 'object', description: 'Key/value payload to persist under data.' },
        },
        required: ['secretEngine', 'secretPath', 'secretData'],
      },
      request: {
        method: 'POST',
        path: '/v1/{secretEngine}/data/{secretPath}',
        body: { data: '{secretData}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'secrets.delete',
      class: 'mutation',
      description: 'Delete a secret and all of its versions from a KV v2 secrets engine.',
      parameters: {
        type: 'object',
        properties: {
          secretEngine: { type: 'string' },
          secretPath: { type: 'string' },
        },
        required: ['secretEngine', 'secretPath'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/{secretEngine}/metadata/{secretPath}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'secrets.list',
      class: 'read',
      description: 'List secret keys under a path in a KV v2 secrets engine.',
      parameters: {
        type: 'object',
        properties: {
          secretEngine: { type: 'string' },
          listPath: { type: 'string', description: 'Path prefix to list (e.g. "myapp/").' },
        },
        required: ['secretEngine', 'listPath'],
      },
      request: {
        method: 'GET',
        path: '/v1/{secretEngine}/metadata/{listPath}',
        query: { list: 'true' },
      },
    },
  ],
})
