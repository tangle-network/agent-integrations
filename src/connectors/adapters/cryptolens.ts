import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Cryptolens adapter — Software Licensing as a Service (SLaaS).
 *
 * Auth: API key (Cryptolens access token), forwarded as the `token` form
 * parameter on every Web API call. The Cryptolens Web API is form-encoded
 * (not JSON) and exposes endpoints under https://api.cryptolens.io/api/.
 *
 * Actions mirror the activepieces catalog entry for `cryptolens`:
 *   - add.customer  → POST /api/customer/AddCustomer
 *   - block.key     → POST /api/key/BlockKey
 *   - create.key    → POST /api/key/CreateKey
 *
 * The catalog also lists a `new.api.event` trigger; triggers are out of
 * scope for declarative-REST adapters (the connector contract is action
 * surface, not webhook intake), so it is omitted here.
 */
export const cryptolensConnector = declarativeRestConnector({
  kind: 'cryptolens',
  displayName: 'Cryptolens',
  description: 'Manage Cryptolens customers and software license keys.',
  auth: { kind: 'api-key', hint: 'Cryptolens access token with the relevant key/customer scopes.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cryptolens.io/api',
  credentialPlacement: { kind: 'query', parameter: 'token' },
  test: {
    method: 'POST',
    path: '/auth/GetTokens',
  },
  capabilities: [
    {
      name: 'customer.add',
      class: 'mutation',
      description: 'Create a customer record, optionally enabling the customer portal with activation management.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          companyName: { type: 'string' },
          notes: { type: 'string' },
          enableCustomerAssociation: { type: 'boolean' },
          allowActivationManagement: { type: 'boolean' },
          allowMultipleUserAssociation: { type: 'boolean' },
        },
        required: ['name', 'email', 'companyName'],
      },
      request: {
        method: 'POST',
        path: '/customer/AddCustomer',
        query: {
          Name: '{name}',
          Email: '{email}',
          CompanyName: '{companyName}',
          Notes: '{notes}',
          EnableCustomerAssociation: '{enableCustomerAssociation}',
          AllowActivationManagement: '{allowActivationManagement}',
          AllowMultipleUserAssociation: '{allowMultipleUserAssociation}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'key.block',
      class: 'mutation',
      description: 'Block a license key so the Activation method will reject it until the key is unblocked.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'number' },
          key: { type: 'string' },
        },
        required: ['productId', 'key'],
      },
      request: {
        method: 'POST',
        path: '/key/BlockKey',
        query: {
          ProductId: '{productId}',
          Key: '{key}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'key.create',
      class: 'mutation',
      description: 'Create one or more license keys for a product with optional feature flags, machine limits, and customer/reseller binding.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'number' },
          period: { type: 'number' },
          f1: { type: 'boolean' },
          f2: { type: 'boolean' },
          f3: { type: 'boolean' },
          f4: { type: 'boolean' },
          f5: { type: 'boolean' },
          f6: { type: 'boolean' },
          f7: { type: 'boolean' },
          f8: { type: 'boolean' },
          notes: { type: 'string' },
          block: { type: 'boolean' },
          customerId: { type: 'number' },
          newCustomer: { type: 'boolean' },
          trialActivation: { type: 'boolean' },
          maxNoOfMachines: { type: 'number' },
          allowedMachines: { type: 'string' },
          resellerId: { type: 'number' },
          noOfKeys: { type: 'number' },
        },
        required: ['productId'],
      },
      request: {
        method: 'POST',
        path: '/key/CreateKey',
        query: {
          ProductId: '{productId}',
          Period: '{period}',
          F1: '{f1}',
          F2: '{f2}',
          F3: '{f3}',
          F4: '{f4}',
          F5: '{f5}',
          F6: '{f6}',
          F7: '{f7}',
          F8: '{f8}',
          Notes: '{notes}',
          Block: '{block}',
          CustomerId: '{customerId}',
          NewCustomer: '{newCustomer}',
          TrialActivation: '{trialActivation}',
          MaxNoOfMachines: '{maxNoOfMachines}',
          AllowedMachines: '{allowedMachines}',
          ResellerId: '{resellerId}',
          NoOfKeys: '{noOfKeys}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
