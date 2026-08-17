import { declarativeRestConnector } from './declarative-rest.js'

const pagination = { page: { type: 'integer', minimum: 1 }, perPage: { type: 'integer', minimum: 1, maximum: 200 } }
const paginationQuery = { page: '{page}', per_page: '{perPage}' }

export const digitalOceanConnector = declarativeRestConnector({
  kind: 'digital-ocean',
  displayName: 'DigitalOcean',
  description: 'Inspect and manage DigitalOcean projects, Droplets, volumes, databases, and App Platform apps.',
  auth: { kind: 'api-key', hint: 'DigitalOcean personal access token with the minimum required scopes.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.digitalocean.com',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/v2/account' },
  capabilities: [
    { name: 'account.get', class: 'read', description: 'Read the current account and status.', parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/v2/account' } },
    { name: 'projects.list', class: 'read', description: 'List projects.', parameters: { type: 'object', properties: pagination }, request: { method: 'GET', path: '/v2/projects', query: paginationQuery } },
    { name: 'projects.get', class: 'read', description: 'Read one project.', parameters: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] }, request: { method: 'GET', path: '/v2/projects/{projectId}' } },
    { name: 'projects.create', class: 'mutation', description: 'Create a project.', parameters: { type: 'object', properties: { project: { type: 'object' } }, required: ['project'] }, request: { method: 'POST', path: '/v2/projects', body: '{project}' }, cas: 'none', externalEffect: true },
    { name: 'projects.update', class: 'mutation', description: 'Update a project.', parameters: { type: 'object', properties: { projectId: { type: 'string' }, project: { type: 'object' } }, required: ['projectId', 'project'] }, request: { method: 'PATCH', path: '/v2/projects/{projectId}', body: '{project}' }, cas: 'optimistic-read-verify', externalEffect: true },
    { name: 'projects.delete', class: 'mutation', description: 'Delete a project.', parameters: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] }, request: { method: 'DELETE', path: '/v2/projects/{projectId}' }, cas: 'optimistic-read-verify', externalEffect: true },
    { name: 'droplets.list', class: 'read', description: 'List Droplets.', parameters: { type: 'object', properties: { ...pagination, tagName: { type: 'string' }, name: { type: 'string' } } }, request: { method: 'GET', path: '/v2/droplets', query: { ...paginationQuery, tag_name: '{tagName}', name: '{name}' } } },
    { name: 'droplets.get', class: 'read', description: 'Read one Droplet.', parameters: { type: 'object', properties: { dropletId: { type: 'integer' } }, required: ['dropletId'] }, request: { method: 'GET', path: '/v2/droplets/{dropletId}' } },
    { name: 'droplets.create', class: 'mutation', description: 'Create one or more Droplets.', parameters: { type: 'object', properties: { droplet: { type: 'object' } }, required: ['droplet'] }, request: { method: 'POST', path: '/v2/droplets', body: '{droplet}' }, cas: 'none', externalEffect: true },
    { name: 'droplets.action', class: 'mutation', description: 'Run a provider-native Droplet action such as power_on, shutdown, snapshot, resize, or rebuild.', parameters: { type: 'object', properties: { dropletId: { type: 'integer' }, action: { type: 'object' } }, required: ['dropletId', 'action'] }, request: { method: 'POST', path: '/v2/droplets/{dropletId}/actions', body: '{action}' }, cas: 'none', externalEffect: true },
    { name: 'droplets.delete', class: 'mutation', description: 'Delete a Droplet.', parameters: { type: 'object', properties: { dropletId: { type: 'integer' } }, required: ['dropletId'] }, request: { method: 'DELETE', path: '/v2/droplets/{dropletId}' }, cas: 'optimistic-read-verify', externalEffect: true },
    { name: 'volumes.list', class: 'read', description: 'List block-storage volumes.', parameters: { type: 'object', properties: { ...pagination, region: { type: 'string' }, name: { type: 'string' } } }, request: { method: 'GET', path: '/v2/volumes', query: { ...paginationQuery, region: '{region}', name: '{name}' } } },
    { name: 'volumes.create', class: 'mutation', description: 'Create a block-storage volume.', parameters: { type: 'object', properties: { volume: { type: 'object' } }, required: ['volume'] }, request: { method: 'POST', path: '/v2/volumes', body: '{volume}' }, cas: 'none', externalEffect: true },
    { name: 'volumes.delete', class: 'mutation', description: 'Delete a block-storage volume.', parameters: { type: 'object', properties: { volumeId: { type: 'string' } }, required: ['volumeId'] }, request: { method: 'DELETE', path: '/v2/volumes/{volumeId}' }, cas: 'optimistic-read-verify', externalEffect: true },
    { name: 'databases.list', class: 'read', description: 'List managed database clusters.', parameters: { type: 'object', properties: { ...pagination, tagName: { type: 'string' } } }, request: { method: 'GET', path: '/v2/databases', query: { ...paginationQuery, tag_name: '{tagName}' } } },
    { name: 'databases.get', class: 'read', description: 'Read a managed database cluster.', parameters: { type: 'object', properties: { databaseId: { type: 'string' } }, required: ['databaseId'] }, request: { method: 'GET', path: '/v2/databases/{databaseId}' } },
    { name: 'databases.create', class: 'mutation', description: 'Create a managed database cluster.', parameters: { type: 'object', properties: { database: { type: 'object' } }, required: ['database'] }, request: { method: 'POST', path: '/v2/databases', body: '{database}' }, cas: 'none', externalEffect: true },
    { name: 'databases.delete', class: 'mutation', description: 'Delete a managed database cluster.', parameters: { type: 'object', properties: { databaseId: { type: 'string' } }, required: ['databaseId'] }, request: { method: 'DELETE', path: '/v2/databases/{databaseId}' }, cas: 'optimistic-read-verify', externalEffect: true },
    { name: 'apps.list', class: 'read', description: 'List App Platform apps.', parameters: { type: 'object', properties: pagination }, request: { method: 'GET', path: '/v2/apps', query: paginationQuery } },
    { name: 'apps.get', class: 'read', description: 'Read an App Platform app.', parameters: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] }, request: { method: 'GET', path: '/v2/apps/{appId}' } },
    { name: 'apps.create', class: 'mutation', description: 'Create an App Platform app.', parameters: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] }, request: { method: 'POST', path: '/v2/apps', body: { spec: '{spec}' } }, cas: 'none', externalEffect: true },
    { name: 'apps.update', class: 'mutation', description: 'Update an App Platform app specification.', parameters: { type: 'object', properties: { appId: { type: 'string' }, spec: { type: 'object' } }, required: ['appId', 'spec'] }, request: { method: 'PUT', path: '/v2/apps/{appId}', body: { spec: '{spec}' } }, cas: 'optimistic-read-verify', externalEffect: true },
    { name: 'apps.delete', class: 'mutation', description: 'Delete an App Platform app.', parameters: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] }, request: { method: 'DELETE', path: '/v2/apps/{appId}' }, cas: 'optimistic-read-verify', externalEffect: true },
  ],
})
