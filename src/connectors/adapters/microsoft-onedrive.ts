import { declarativeRestConnector } from './declarative-rest.js'

export const microsoftOnedriveConnector = declarativeRestConnector({
  kind: 'microsoft-onedrive',
  displayName: 'Microsoft OneDrive',
  description: 'Upload, download, list files and folders in Microsoft OneDrive.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Files.ReadWrite'],
    clientIdEnv: 'MICROSOFT_ONEDRIVE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_ONEDRIVE_OAUTH_CLIENT_SECRET',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0/me/drive',
  test: { method: 'GET', path: '/root' },
  capabilities: [
    {
      name: 'files.list',
      class: 'read',
      description: 'List files in OneDrive.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: 'Folder ID to list files from (optional, defaults to root)' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/items/{folderId}/children', query: { $select: 'id,name,size,webUrl,folder,file' } },
    },
    {
      name: 'folders.list',
      class: 'read',
      description: 'List folders in OneDrive.',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: 'Parent folder ID (optional, defaults to root)' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/items/{parentId}/children', query: { $filter: 'folder ne null', $select: 'id,name,webUrl' } },
    },
    {
      name: 'files.download',
      class: 'read',
      description: 'Download a file from OneDrive.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
        },
        required: ['fileId'],
      },
      request: { method: 'GET', path: '/items/{fileId}/content' },
    },
    {
      name: 'files.upload',
      class: 'mutation',
      description: 'Upload a file to OneDrive.',
      parameters: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: 'Destination folder ID (optional, defaults to root)' },
          fileName: { type: 'string', description: 'Name of the file to upload' },
          fileContent: { type: 'string', description: 'File content (base64-encoded or raw)' },
        },
        required: ['fileName', 'fileContent'],
      },
      request: { method: 'PUT', path: '/items/{folderId}:/{fileName}:/content', body: '{fileContent}' },
      cas: 'native-idempotency',
    },
  ],
})
