import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft 365 People connector backed by Microsoft Graph v1.0.
 *
 * Manages personal contacts and contact folders in the signed-in user's
 * Outlook/Exchange Online mailbox. Authentication uses the Microsoft identity
 * platform v2.0 OAuth endpoints; the `common` tenant lets one app registration
 * serve any work, school, or personal account.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/contact?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/resources/contactfolder?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/permissions-reference#contacts-permissions
 */
export const microsoft365PeopleConnector = declarativeRestConnector({
  kind: 'microsoft-365-people',
  displayName: 'Microsoft 365 People',
  description: 'Manage Microsoft 365 personal contacts and contact folders via Microsoft Graph.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Contacts.ReadWrite', 'User.Read'],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'create.contact',
      class: 'mutation',
      description:
        "Create a personal contact in the signed-in user's default contacts folder, or in a specific folder when contactFolderId is supplied.",
      parameters: {
        type: 'object',
        properties: {
          contactFolderId: { type: 'string' },
          givenName: { type: 'string' },
          surname: { type: 'string' },
          displayName: { type: 'string' },
          middleName: { type: 'string' },
          nickName: { type: 'string' },
          title: { type: 'string' },
          companyName: { type: 'string' },
          department: { type: 'string' },
          jobTitle: { type: 'string' },
          emailAddresses: { type: 'array', items: { type: 'object' } },
          businessPhones: { type: 'array', items: { type: 'string' } },
          homePhones: { type: 'array', items: { type: 'string' } },
          mobilePhone: { type: 'string' },
          businessAddress: { type: 'object' },
          homeAddress: { type: 'object' },
          otherAddress: { type: 'object' },
          personalNotes: { type: 'string' },
          birthday: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/me/contactFolders/{contactFolderId}/contacts',
        body: {
          givenName: '{givenName}',
          surname: '{surname}',
          displayName: '{displayName}',
          middleName: '{middleName}',
          nickName: '{nickName}',
          title: '{title}',
          companyName: '{companyName}',
          department: '{department}',
          jobTitle: '{jobTitle}',
          emailAddresses: '{emailAddresses}',
          businessPhones: '{businessPhones}',
          homePhones: '{homePhones}',
          mobilePhone: '{mobilePhone}',
          businessAddress: '{businessAddress}',
          homeAddress: '{homeAddress}',
          otherAddress: '{otherAddress}',
          personalNotes: '{personalNotes}',
          birthday: '{birthday}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Contacts.ReadWrite'],
    },
    {
      name: 'create.contact.folder',
      class: 'mutation',
      description:
        "Create a new contact folder under the user's default contacts folder, or as a child of parentFolderId when supplied.",
      parameters: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          parentFolderId: { type: 'string' },
        },
        required: ['displayName'],
      },
      request: {
        method: 'POST',
        path: '/me/contactFolders/{parentFolderId}/childFolders',
        body: { displayName: '{displayName}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Contacts.ReadWrite'],
    },
    {
      name: 'delete.contact',
      class: 'mutation',
      description: 'Delete a personal contact by id from the signed-in mailbox.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'DELETE', path: '/me/contacts/{contactId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Contacts.ReadWrite'],
    },
    {
      name: 'get.contact.folder',
      class: 'read',
      description: 'Read a contact folder by id, optionally narrowing fields via $select.',
      parameters: {
        type: 'object',
        properties: {
          contactFolderId: { type: 'string' },
          $select: { type: 'string' },
        },
        required: ['contactFolderId'],
      },
      request: {
        method: 'GET',
        path: '/me/contactFolders/{contactFolderId}',
        query: { $select: '{$select}' },
      },
      requiredScopes: ['Contacts.ReadWrite'],
    },
    {
      name: 'search.contacts',
      class: 'read',
      description:
        'Search the signed-in user contacts using OData $search/$filter with optional $top, $select, and $orderby.',
      parameters: {
        type: 'object',
        properties: {
          $search: { type: 'string' },
          $filter: { type: 'string' },
          $select: { type: 'string' },
          $top: { type: 'integer' },
          $orderby: { type: 'string' },
          contactFolderId: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/contactFolders/{contactFolderId}/contacts',
        query: {
          $search: '{$search}',
          $filter: '{$filter}',
          $select: '{$select}',
          $top: '{$top}',
          $orderby: '{$orderby}',
        },
      },
      requiredScopes: ['Contacts.ReadWrite'],
    },
    {
      name: 'update.contact',
      class: 'mutation',
      description: 'Patch fields on an existing personal contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['contactId', 'patch'],
      },
      request: { method: 'PATCH', path: '/me/contacts/{contactId}', body: '{patch}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Contacts.ReadWrite'],
    },
  ],
})
