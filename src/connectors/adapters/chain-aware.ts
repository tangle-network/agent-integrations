import { declarativeRestConnector } from './declarative-rest.js'

export const chainAwareConnector = declarativeRestConnector({
  kind: 'chain-aware',
  displayName: 'ChainAware.AI',
  description: 'Detect risky wallet behavior across blockchain networks.',
  auth: { kind: 'api-key', hint: 'ChainAware.AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chainaware.ai/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'wallet.audit',
      class: 'read',
      description: 'Audit a wallet address for risky behavior.',
      parameters: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Blockchain network (e.g., ethereum, polygon, bsc)' },
          walletAddress: { type: 'string', description: 'Wallet address to audit' },
          contractAddress: { type: 'string', description: 'Smart contract address to check' },
          onlyFraud: { type: 'boolean', description: 'Return only fraud-flagged results' },
        },
        required: ['network', 'walletAddress', 'contractAddress'],
      },
      request: {
        method: 'GET',
        path: '/audit/wallet',
        query: {
          network: '{network}',
          walletAddress: '{walletAddress}',
          contractAddress: '{contractAddress}',
          onlyFraud: '{onlyFraud}',
        },
      },
    },
    {
      name: 'wallet.creditScore',
      class: 'read',
      description: 'Calculate credit score for a wallet address.',
      parameters: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Blockchain network' },
          walletAddress: { type: 'string', description: 'Wallet address' },
        },
        required: ['network', 'walletAddress'],
      },
      request: {
        method: 'GET',
        path: '/credit/score',
        query: { network: '{network}', walletAddress: '{walletAddress}' },
      },
    },
    {
      name: 'wallet.fraudCheck',
      class: 'read',
      description: 'Check if a wallet has fraud indicators.',
      parameters: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Blockchain network' },
          walletAddress: { type: 'string', description: 'Wallet address' },
          contractAddress: { type: 'string', description: 'Smart contract address' },
        },
        required: ['network', 'walletAddress', 'contractAddress'],
      },
      request: {
        method: 'GET',
        path: '/fraud/check',
        query: { network: '{network}', walletAddress: '{walletAddress}', contractAddress: '{contractAddress}' },
      },
    },
    {
      name: 'wallet.rugPullCheck',
      class: 'read',
      description: 'Detect rug pull patterns in a smart contract.',
      parameters: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Blockchain network' },
          contractAddress: { type: 'string', description: 'Smart contract address' },
        },
        required: ['network', 'contractAddress'],
      },
      request: {
        method: 'GET',
        path: '/rug-pull/check',
        query: { network: '{network}', contractAddress: '{contractAddress}' },
      },
    },
    {
      name: 'wallet.segment',
      class: 'read',
      description: 'Classify wallet into risk segment.',
      parameters: {
        type: 'object',
        properties: {
          network: { type: 'string', description: 'Blockchain network' },
          walletAddress: { type: 'string', description: 'Wallet address' },
        },
        required: ['network', 'walletAddress'],
      },
      request: {
        method: 'GET',
        path: '/wallet/segment',
        query: { network: '{network}', walletAddress: '{walletAddress}' },
      },
    },
  ],
})
