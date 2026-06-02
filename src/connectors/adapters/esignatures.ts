import { declarativeRestConnector } from './declarative-rest.js'

export const esignaturesConnector = declarativeRestConnector({
  kind: 'esignatures',
  displayName: 'eSignatures',
  description: 'Create contracts on eSignatures.io and send them to signers from a template.',
  auth: { kind: 'api-key', hint: 'eSignatures.io API token (sent as HTTP basic / bearer).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://esignatures.io/api',
  test: { method: 'GET', path: '/templates' },
  capabilities: [
    {
      name: 'create.contract',
      class: 'mutation',
      description: 'Create a contract from a template and send it to the listed signers.',
      parameters: {
        type: 'object',
        properties: {
          templateId: { type: 'string', description: 'ID of the template to use for the contract.' },
          title: { type: 'string', description: 'Unique title for the contract (defaults to template title).' },
          locale: { type: 'string', description: 'Language setting for the signer page and emails.' },
          metadata: { type: 'string', description: 'Custom data to attach to the contract.' },
          expiresInHours: { type: 'number', description: 'Sets the expiry time (in hours) for the contract.' },
          customWebhookUrl: { type: 'string', description: 'Custom URL for webhook notifications.' },
          assignedUserEmail: { type: 'string', description: 'Email to assign management of the contract.' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels to assign to the contract.' },
          test: { type: 'boolean', description: 'Mark as test/demo contract with no fees charged.' },
          saveAsDraft: { type: 'boolean', description: 'Save as draft instead of sending to signers.' },
          signers: {
            type: 'array',
            description: 'List of individuals required to sign (name, email, and/or mobile).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
                mobile: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['templateId', 'signers'],
      },
      request: {
        method: 'POST',
        path: '/contracts',
        body: {
          template_id: '{templateId}',
          title: '{title}',
          locale: '{locale}',
          metadata: '{metadata}',
          expires_in_hours: '{expiresInHours}',
          custom_webhook_url: '{customWebhookUrl}',
          assigned_user_email: '{assignedUserEmail}',
          labels: '{labels}',
          test: '{test}',
          save_as_draft: '{saveAsDraft}',
          signers: '{signers}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'contract.cancel',
      class: 'mutation',
      description: 'Withdraw / cancel an in-progress contract.',
      parameters: {
        type: 'object',
        properties: {
          contractId: { type: 'string', description: 'ID of the contract to cancel.' },
          voidedBy: {
            type: 'string',
            description: 'Name of the user voiding the contract (recorded in audit trail).',
          },
        },
        required: ['contractId'],
      },
      request: {
        method: 'POST',
        path: '/contracts/{contractId}/withdraw',
        body: {
          voided_by: '{voidedBy}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'contract.delete',
      class: 'mutation',
      description: 'Delete a contract permanently.',
      parameters: {
        type: 'object',
        properties: {
          contractId: { type: 'string', description: 'ID of the contract to delete.' },
        },
        required: ['contractId'],
      },
      request: {
        method: 'DELETE',
        path: '/contracts/{contractId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
