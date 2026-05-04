import { describe, expect, it } from 'vitest'
import {
  buildIntegrationToolCatalog,
  importGraphqlConnector,
  importMcpConnector,
  importOpenApiConnector,
  searchIntegrationTools,
} from '../src/index'

describe('catalog importers', () => {
  it('imports OpenAPI operations into connector actions with risk and scopes', () => {
    const connector = importOpenApiConnector({
      openapi: '3.1.0',
      paths: {
        '/messages': {
          get: {
            operationId: 'listMessages',
            summary: 'List messages',
            security: [{ oauth: ['messages.read'] }],
          },
          post: {
            operationId: 'sendMessage',
            summary: 'Send a message',
            security: [{ oauth: ['messages.write'] }],
          },
        },
        '/messages/{id}': {
          delete: {
            operationId: 'deleteMessage',
            summary: 'Delete a message',
            security: [{ oauth: ['messages.delete'] }],
          },
        },
      },
    }, {
      providerId: 'openapi',
      connectorId: 'mail',
      connectorTitle: 'Mail API',
      category: 'email',
      auth: 'oauth2',
    })

    expect(connector.actions.map((action) => [action.id, action.risk])).toEqual([
      ['listMessages', 'read'],
      ['sendMessage', 'write'],
      ['deleteMessage', 'destructive'],
    ])
    expect(connector.scopes).toEqual(['messages.read', 'messages.write', 'messages.delete'])
  })

  it('imports GraphQL operations into searchable tools', () => {
    const connector = importGraphqlConnector([
      { kind: 'query', name: 'searchContacts', requiredScopes: ['contacts.read'] },
      { kind: 'mutation', name: 'createContact', requiredScopes: ['contacts.write'] },
    ], {
      providerId: 'graphql',
      connectorId: 'crm',
      connectorTitle: 'CRM GraphQL',
      category: 'crm',
      auth: 'oauth2',
    })

    const tools = buildIntegrationToolCatalog([connector])
    const results = searchIntegrationTools(tools, 'search contacts', { maxRisk: 'read' })

    expect(results[0].tool.action.id).toBe('searchContacts')
    expect(connector.actions.find((action) => action.id === 'createContact')?.approvalRequired).toBe(true)
  })

  it('imports MCP tools and respects read-only/destructive annotations', () => {
    const connector = importMcpConnector({
      tools: [
        { name: 'github_search_issues', annotations: { readOnlyHint: true } },
        { name: 'github_delete_issue', annotations: { destructiveHint: true } },
      ],
    }, {
      providerId: 'mcp',
      connectorId: 'github',
      connectorTitle: 'GitHub MCP',
      category: 'other',
      auth: 'custom',
    })

    expect(connector.actions.map((action) => [action.id, action.risk, action.approvalRequired])).toEqual([
      ['github_search_issues', 'read', false],
      ['github_delete_issue', 'destructive', true],
    ])
  })
})
