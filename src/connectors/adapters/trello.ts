import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Trello connector.
 *
 * Auth model: Trello's first-party authorization flow issues a per-user token
 * bound to a developer API key. Calls to https://api.trello.com/1/* are
 * authenticated by sending the user token as the `token` query parameter and
 * the developer API key as the `key` query parameter. The framework places
 * the user token via `credentialPlacement: { kind: 'query', parameter: 'token' }`;
 * the developer API key travels on every invocation as the `key` argument
 * (resolve once from connection metadata at the caller and forward).
 *
 * Token minting page (developer): https://trello.com/app-key
 * Authorize a user token:         https://trello.com/1/authorize
 *
 * Trello's authorize endpoint returns a token directly (token-grant style);
 * there is no separate `tokenUrl` to exchange a code at, so this adapter
 * surfaces as `api-key` rather than `oauth2` to avoid implying a refresh-token
 * lifecycle that Trello does not implement.
 *
 * REST reference: https://developer.atlassian.com/cloud/trello/rest/
 */
export const trelloConnector = declarativeRestConnector({
  kind: 'trello',
  displayName: 'Trello',
  description: 'Read and mutate Trello boards, lists, cards, checklists, and comments.',
  auth: {
    kind: 'api-key',
    hint: 'Trello user token. Mint a developer API key at https://trello.com/app-key, then authorize a user token via https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=<KEY>. Pass the developer key as the `key` argument on every invocation.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.trello.com',
  credentialPlacement: { kind: 'query', parameter: 'token' },
  test: { method: 'GET', path: '/1/members/me' },
  capabilities: [
    {
      name: 'boards.list',
      class: 'read',
      description: 'List Trello boards visible to the authenticated member.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Trello developer API key.' },
          memberId: { type: 'string', description: 'Member id or "me".' },
          filter: { type: 'string', enum: ['all', 'open', 'closed', 'members', 'organization', 'public', 'starred'] },
          fields: { type: 'string', description: 'Comma-separated board fields.' },
        },
        required: ['key', 'memberId'],
      },
      request: {
        method: 'GET',
        path: '/1/members/{memberId}/boards',
        query: { key: '{key}', filter: '{filter}', fields: '{fields}' },
      },
    },
    {
      name: 'boards.get',
      class: 'read',
      description: 'Read a single board with optional nested lists/cards.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          boardId: { type: 'string' },
          lists: { type: 'string', enum: ['none', 'open', 'closed', 'all'] },
          cards: { type: 'string', enum: ['none', 'open', 'closed', 'all', 'visible'] },
          fields: { type: 'string' },
        },
        required: ['key', 'boardId'],
      },
      request: {
        method: 'GET',
        path: '/1/boards/{boardId}',
        query: { key: '{key}', lists: '{lists}', cards: '{cards}', fields: '{fields}' },
      },
    },
    {
      name: 'boards.lists',
      class: 'read',
      description: 'List the lists (columns) on a board.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          boardId: { type: 'string' },
          filter: { type: 'string', enum: ['all', 'open', 'closed', 'none'] },
          fields: { type: 'string' },
        },
        required: ['key', 'boardId'],
      },
      request: {
        method: 'GET',
        path: '/1/boards/{boardId}/lists',
        query: { key: '{key}', filter: '{filter}', fields: '{fields}' },
      },
    },
    {
      name: 'lists.cards',
      class: 'read',
      description: 'List cards in a list.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          listId: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
        required: ['key', 'listId'],
      },
      request: {
        method: 'GET',
        path: '/1/lists/{listId}/cards',
        query: { key: '{key}', fields: '{fields}', limit: '{limit}' },
      },
    },
    {
      name: 'cards.get',
      class: 'read',
      description: 'Read a single card by id.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
          fields: { type: 'string' },
          members: { type: 'boolean' },
          checklists: { type: 'string', enum: ['none', 'all'] },
        },
        required: ['key', 'cardId'],
      },
      request: {
        method: 'GET',
        path: '/1/cards/{cardId}',
        query: {
          key: '{key}',
          fields: '{fields}',
          members: '{members}',
          checklists: '{checklists}',
        },
      },
    },
    {
      name: 'search',
      class: 'read',
      description: 'Search across boards, cards, organizations, and members.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          query: { type: 'string' },
          modelTypes: { type: 'string', description: 'Comma-separated: actions,boards,cards,members,organizations.' },
          board_fields: { type: 'string' },
          cards_limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
        required: ['key', 'query'],
      },
      request: {
        method: 'GET',
        path: '/1/search',
        query: {
          key: '{key}',
          query: '{query}',
          modelTypes: '{modelTypes}',
          board_fields: '{board_fields}',
          cards_limit: '{cards_limit}',
        },
      },
    },
    {
      name: 'cards.create',
      class: 'mutation',
      description: 'Create a card in a list. Pass `idList` plus optional `name`, `desc`, `pos`, `due`, `idMembers`, `idLabels`.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          idList: { type: 'string' },
          name: { type: 'string' },
          desc: { type: 'string' },
          pos: { type: 'string', description: 'top, bottom, or a positive float.' },
          due: { type: 'string', description: 'ISO 8601 due date.' },
          idMembers: { type: 'array', items: { type: 'string' } },
          idLabels: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'idList'],
      },
      request: {
        method: 'POST',
        path: '/1/cards',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'cards.update',
      class: 'mutation',
      description: 'Update fields on an existing card.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
          name: { type: 'string' },
          desc: { type: 'string' },
          closed: { type: 'boolean' },
          idList: { type: 'string' },
          idBoard: { type: 'string' },
          pos: { type: 'string' },
          due: { type: 'string' },
          dueComplete: { type: 'boolean' },
        },
        required: ['key', 'cardId'],
      },
      request: {
        method: 'PUT',
        path: '/1/cards/{cardId}',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'cards.move',
      class: 'mutation',
      description: 'Move a card to a different list (and optionally position).',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
          idList: { type: 'string' },
          pos: { type: 'string' },
        },
        required: ['key', 'cardId', 'idList'],
      },
      request: {
        method: 'PUT',
        path: '/1/cards/{cardId}',
        query: { key: '{key}' },
        body: { idList: '{idList}', pos: '{pos}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'cards.archive',
      class: 'mutation',
      description: 'Archive (closed=true) a card without deleting it.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
        },
        required: ['key', 'cardId'],
      },
      request: {
        method: 'PUT',
        path: '/1/cards/{cardId}',
        query: { key: '{key}' },
        body: { closed: true },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'cards.delete',
      class: 'mutation',
      description: 'Permanently delete a card.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
        },
        required: ['key', 'cardId'],
      },
      request: {
        method: 'DELETE',
        path: '/1/cards/{cardId}',
        query: { key: '{key}' },
      },
      cas: 'none',
    },
    {
      name: 'cards.addComment',
      class: 'mutation',
      description: 'Post a comment on a card.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['key', 'cardId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/1/cards/{cardId}/actions/comments',
        query: { key: '{key}', text: '{text}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'cards.addLabel',
      class: 'mutation',
      description: 'Attach an existing label to a card.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
          labelId: { type: 'string' },
        },
        required: ['key', 'cardId', 'labelId'],
      },
      request: {
        method: 'POST',
        path: '/1/cards/{cardId}/idLabels',
        query: { key: '{key}' },
        body: { value: '{labelId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'cards.addMember',
      class: 'mutation',
      description: 'Assign a Trello member to a card.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          cardId: { type: 'string' },
          memberId: { type: 'string' },
        },
        required: ['key', 'cardId', 'memberId'],
      },
      request: {
        method: 'POST',
        path: '/1/cards/{cardId}/idMembers',
        query: { key: '{key}' },
        body: { value: '{memberId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a list on a board.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          idBoard: { type: 'string' },
          pos: { type: 'string' },
        },
        required: ['key', 'name', 'idBoard'],
      },
      request: {
        method: 'POST',
        path: '/1/lists',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.update',
      class: 'mutation',
      description: 'Update a list (rename, archive via closed=true, reposition).',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          listId: { type: 'string' },
          name: { type: 'string' },
          closed: { type: 'boolean' },
          pos: { type: 'string' },
          idBoard: { type: 'string' },
        },
        required: ['key', 'listId'],
      },
      request: {
        method: 'PUT',
        path: '/1/lists/{listId}',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'boards.create',
      class: 'mutation',
      description: 'Create a new Trello board.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          desc: { type: 'string' },
          idOrganization: { type: 'string' },
          defaultLists: { type: 'boolean' },
          prefs_permissionLevel: { type: 'string', enum: ['private', 'org', 'public'] },
        },
        required: ['key', 'name'],
      },
      request: {
        method: 'POST',
        path: '/1/boards',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'checklists.create',
      class: 'mutation',
      description: 'Create a checklist on a card.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          idCard: { type: 'string' },
          name: { type: 'string' },
          pos: { type: 'string' },
        },
        required: ['key', 'idCard'],
      },
      request: {
        method: 'POST',
        path: '/1/checklists',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'checklists.addItem',
      class: 'mutation',
      description: 'Add a check item to an existing checklist.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          checklistId: { type: 'string' },
          name: { type: 'string' },
          pos: { type: 'string' },
          checked: { type: 'boolean' },
        },
        required: ['key', 'checklistId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/1/checklists/{checklistId}/checkItems',
        query: { key: '{key}' },
        body: 'args',
      },
      cas: 'native-idempotency',
    },
  ],
})
