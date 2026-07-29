import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Affinity CRM API v1.
 *
 * Affinity authenticates API requests with a bearer API key. API access and
 * the objects visible to a key depend on the customer's Affinity plan and the
 * permissions of the user who created it.
 */
export const affinityConnector = declarativeRestConnector({
  kind: 'affinity',
  displayName: 'Affinity',
  description: 'Synchronize Affinity people, organizations, opportunities, lists, notes, interactions, and field values.',
  auth: {
    kind: 'api-key',
    hint: 'Affinity API key from Settings > API. Availability depends on the workspace plan and key owner permissions.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.affinity.co',
  test: { method: 'GET', path: '/auth/whoami' },
  capabilities: [
    collectionRead('people.list', 'List or search people.', '/persons', 'person'),
    entityRead('people.get', 'Read one person, including current organizations and opportunities.', '/persons/{personId}', 'personId'),
    entityCreate('people.create', 'Create a person.', '/persons'),
    entityUpdate('people.update', 'Update a person.', '/persons/{personId}', 'personId'),
    entityDelete('people.delete', 'Delete a person.', '/persons/{personId}', 'personId'),
    collectionRead('organizations.list', 'List or search organizations.', '/organizations', 'organization'),
    entityRead('organizations.get', 'Read one organization.', '/organizations/{organizationId}', 'organizationId'),
    entityCreate('organizations.create', 'Create an organization.', '/organizations'),
    entityUpdate('organizations.update', 'Update an organization.', '/organizations/{organizationId}', 'organizationId'),
    entityDelete('organizations.delete', 'Delete an organization.', '/organizations/{organizationId}', 'organizationId'),
    collectionRead('opportunities.list', 'List or search opportunities.', '/opportunities', 'opportunity'),
    entityRead('opportunities.get', 'Read one opportunity.', '/opportunities/{opportunityId}', 'opportunityId'),
    entityCreate('opportunities.create', 'Create an opportunity.', '/opportunities'),
    entityUpdate('opportunities.update', 'Update an opportunity.', '/opportunities/{opportunityId}', 'opportunityId'),
    entityDelete('opportunities.delete', 'Delete an opportunity.', '/opportunities/{opportunityId}', 'opportunityId'),
    collectionRead('lists.list', 'List CRM lists.', '/lists', 'list'),
    entityRead('lists.get', 'Read one CRM list and its field definitions.', '/lists/{listId}', 'listId'),
    {
      name: 'list-entries.list',
      class: 'read',
      description: 'List entries in an Affinity list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'integer' },
          page_size: { type: 'integer', minimum: 1, maximum: 500 },
          page_token: { type: 'string' },
        },
        required: ['listId'],
      },
      request: {
        method: 'GET',
        path: '/lists/{listId}/list-entries',
        query: { page_size: '{page_size}', page_token: '{page_token}' },
      },
    },
    {
      name: 'list-entries.create',
      class: 'mutation',
      description: 'Add an entity to an Affinity list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'integer' },
          entity_id: { type: 'integer' },
        },
        required: ['listId', 'entity_id'],
      },
      request: { method: 'POST', path: '/lists/{listId}/list-entries', body: { entity_id: '{entity_id}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'list-entries.delete',
      class: 'mutation',
      description: 'Remove a list entry.',
      parameters: idParameters('listEntryId'),
      request: { method: 'DELETE', path: '/list-entries/{listEntryId}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'field-values.list',
      class: 'read',
      description: 'Read mapped custom-field values for one person, organization, opportunity, or list entry.',
      parameters: {
        type: 'object',
        properties: {
          person_id: { type: 'integer' },
          organization_id: { type: 'integer' },
          opportunity_id: { type: 'integer' },
          list_entry_id: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/field-values',
        query: {
          person_id: '{person_id}',
          organization_id: '{organization_id}',
          opportunity_id: '{opportunity_id}',
          list_entry_id: '{list_entry_id}',
        },
      },
    },
    entityCreate('field-values.create', 'Create a custom-field value.', '/field-values'),
    entityUpdate('field-values.update', 'Update a custom-field value.', '/field-values/{fieldValueId}', 'fieldValueId'),
    entityDelete('field-values.delete', 'Delete a custom-field value.', '/field-values/{fieldValueId}', 'fieldValueId'),
    {
      name: 'field-value-changes.list',
      class: 'read',
      description: 'Read custom-field change history for synchronization and evidence.',
      parameters: {
        type: 'object',
        properties: {
          field_id: { type: 'integer' },
          action_type: { type: 'integer' },
          page_size: { type: 'integer', minimum: 1, maximum: 500 },
          page_token: { type: 'string' },
        },
        required: ['field_id'],
      },
      request: {
        method: 'GET',
        path: '/field-value-changes',
        query: {
          field_id: '{field_id}',
          action_type: '{action_type}',
          page_size: '{page_size}',
          page_token: '{page_token}',
        },
      },
    },
    {
      name: 'interactions.list',
      class: 'read',
      description: 'List email, meeting, call, and chat interactions for a person or organization.',
      parameters: {
        type: 'object',
        properties: {
          person_id: { type: 'integer' },
          organization_id: { type: 'integer' },
          type: { type: 'integer' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 500 },
          page_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/interactions',
        query: {
          person_id: '{person_id}',
          organization_id: '{organization_id}',
          type: '{type}',
          start_time: '{start_time}',
          end_time: '{end_time}',
          page_size: '{page_size}',
          page_token: '{page_token}',
        },
      },
    },
    {
      name: 'notes.list',
      class: 'read',
      description: 'List notes linked to people, organizations, or opportunities.',
      parameters: {
        type: 'object',
        properties: {
          person_id: { type: 'integer' },
          organization_id: { type: 'integer' },
          opportunity_id: { type: 'integer' },
          page_size: { type: 'integer', minimum: 1, maximum: 500 },
          page_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/notes',
        query: {
          person_id: '{person_id}',
          organization_id: '{organization_id}',
          opportunity_id: '{opportunity_id}',
          page_size: '{page_size}',
          page_token: '{page_token}',
        },
      },
    },
    entityCreate('notes.create', 'Create a note linked to CRM records.', '/notes'),
    entityUpdate('notes.update', 'Update a note.', '/notes/{noteId}', 'noteId'),
    entityDelete('notes.delete', 'Delete a note.', '/notes/{noteId}', 'noteId'),
  ],
})

function collectionRead(name: string, description: string, path: string, entity: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        term: { type: 'string', description: `Search ${entity} names and identifiers.` },
        page_size: { type: 'integer', minimum: 1, maximum: 500 },
        page_token: { type: 'string' },
      },
    },
    request: {
      method: 'GET' as const,
      path,
      query: { term: '{term}', page_size: '{page_size}', page_token: '{page_token}' },
    },
  }
}

function entityRead(name: string, description: string, path: string, id: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: idParameters(id),
    request: { method: 'GET' as const, path },
  }
}

function entityCreate(name: string, description: string, path: string) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: arbitraryBodyParameters(),
    request: { method: 'POST' as const, path, body: 'args' as const },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}

function entityUpdate(name: string, description: string, path: string, id: string) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object',
      properties: { [id]: { type: 'integer' } },
      required: [id],
      additionalProperties: true,
    },
    request: { method: 'PUT' as const, path, body: 'args' as const },
    cas: 'optimistic-read-verify' as const,
    externalEffect: true,
  }
}

function entityDelete(name: string, description: string, path: string, id: string) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: idParameters(id),
    request: { method: 'DELETE' as const, path },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}

function idParameters(id: string) {
  return {
    type: 'object',
    properties: { [id]: { type: 'integer' } },
    required: [id],
  }
}

function arbitraryBodyParameters() {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {},
  }
}
