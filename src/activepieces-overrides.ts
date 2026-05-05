import type {
  IntegrationActionRisk,
  IntegrationConnectorCategory,
} from './index.js'

export interface ActivepiecesPieceOverride {
  category?: IntegrationConnectorCategory
  actionRisks?: Record<string, IntegrationActionRisk>
  approvalRequired?: Record<string, boolean>
}

export const ACTIVEPIECES_OVERRIDES: Record<string, ActivepiecesPieceOverride> = {
  slack: {
    category: 'chat',
    actionRisks: {
      'slack.send.message': 'write',
      'slack.send.direct.message': 'write',
      'request.action.message': 'write',
      'request.action.direct.message': 'write',
      'request.approval.direct.message': 'write',
      'request.send.approval.message': 'write',
      'upload.file': 'write',
      'search.messages': 'read',
    },
  },
  discord: { category: 'chat' },
  'microsoft-teams': { category: 'chat' },
  whatsapp: { category: 'chat' },
  telegram: { category: 'chat' },

  gmail: {
    category: 'email',
    actionRisks: {
      'gmail.send.email': 'write',
      'gmail.reply.to.email': 'write',
      'gmail.create.draft.reply': 'write',
      'gmail.search.mail': 'read',
      'gmail.get.email': 'read',
      'request.approval.in.email': 'write',
    },
  },
  'microsoft-outlook': { category: 'email' },
  sendgrid: { category: 'email' },
  postmark: { category: 'email' },
  mailchimp: { category: 'email' },
  resend: { category: 'email' },

  'google-calendar': { category: 'calendar' },
  'microsoft-outlook-calendar': { category: 'calendar' },
  cal: { category: 'calendar' },
  calendly: { category: 'calendar' },
  zoom: { category: 'calendar' },

  'google-drive': { category: 'storage' },
  dropbox: { category: 'storage' },
  onedrive: { category: 'storage' },

  'google-sheets': { category: 'database' },
  'google-docs': { category: 'docs' },
  airtable: { category: 'database' },
  notion: { category: 'docs' },

  hubspot: { category: 'crm' },
  salesforce: { category: 'crm' },
  pipedrive: { category: 'crm' },
  intercom: { category: 'crm' },
  zendesk: { category: 'crm' },

  stripe: {
    category: 'crm',
    actionRisks: {
      'stripe.create.customer': 'write',
      'stripe.update.customer': 'write',
      'stripe.retrieve.customer': 'read',
      'stripe.search.customer': 'read',
      'stripe.search.subscriptions': 'read',
      'stripe.create.invoice': 'write',
      'stripe.retrieve.invoice': 'read',
      'stripe.find.invoice': 'read',
      'stripe.create.subscription': 'write',
      'stripe.cancel.subscription': 'destructive',
      'stripe.create.payment.intent': 'write',
      'stripe.retrieve.payment.intent': 'read',
      'stripe.create.refund': 'destructive',
      'stripe.create.product': 'write',
      'stripe.create.price': 'write',
      'stripe.create.payment.link': 'write',
      'stripe.deactivate.payment.link': 'destructive',
      'stripe.retrieve.payout': 'read',
    },
    approvalRequired: {
      'stripe.create.refund': true,
      'stripe.cancel.subscription': true,
      'stripe.deactivate.payment.link': true,
    },
  },

  twilio: {
    category: 'chat',
    actionRisks: {
      'send.sms': 'write',
      'send.whatsapp.message': 'write',
      'make.phone.call': 'write',
    },
  },

  shopify: { category: 'crm' },
  square: { category: 'crm' },
}

export function getActivepiecesOverride(id: string): ActivepiecesPieceOverride | undefined {
  return ACTIVEPIECES_OVERRIDES[id]
}
