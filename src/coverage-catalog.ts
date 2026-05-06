import type {
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationConnectorTrigger,
  IntegrationProviderKind,
} from './index.js'

export type IntegrationCoveragePriority = 'tier_0' | 'tier_1' | 'tier_2' | 'long_tail'

export interface IntegrationCoverageSpec {
  id: string
  title: string
  category: IntegrationConnectorCategory
  auth: IntegrationConnector['auth']
  priority: IntegrationCoveragePriority
  providerKinds: IntegrationProviderKind[]
  domains: string[]
  actionPack: IntegrationActionPack
  scopes?: string[]
}

export type IntegrationActionPack =
  | 'email'
  | 'calendar'
  | 'chat'
  | 'crm'
  | 'storage'
  | 'docs'
  | 'database'
  | 'project'
  | 'support'
  | 'marketing'
  | 'sales'
  | 'commerce'
  | 'finance'
  | 'hr'
  | 'dev'
  | 'ai'
  | 'analytics'
  | 'workflow'
  | 'webhook'

type SpecTuple = [
  id: string,
  title: string,
  category: IntegrationConnectorCategory,
  actionPack: IntegrationActionPack,
  priority: IntegrationCoveragePriority,
  domains: string,
  auth?: IntegrationConnector['auth'],
]

const DEFAULT_PROVIDER_KINDS: IntegrationProviderKind[] = ['first_party', 'nango', 'pipedream', 'tangle_catalog', 'custom']

const COVERAGE_SPECS: SpecTuple[] = [
  ['gmail', 'Gmail', 'email', 'email', 'tier_0', 'email,google,workspace,inbox'],
  ['outlook-mail', 'Outlook Mail', 'email', 'email', 'tier_0', 'email,microsoft,office,inbox'],
  ['google-calendar', 'Google Calendar', 'calendar', 'calendar', 'tier_0', 'calendar,google,workspace,scheduling'],
  ['outlook-calendar', 'Outlook Calendar', 'calendar', 'calendar', 'tier_0', 'calendar,microsoft,office,scheduling'],
  ['slack', 'Slack', 'chat', 'chat', 'tier_0', 'chat,collaboration,internal-comms'],
  ['microsoft-teams', 'Microsoft Teams', 'chat', 'chat', 'tier_0', 'chat,microsoft,collaboration'],
  ['google-drive', 'Google Drive', 'storage', 'storage', 'tier_0', 'files,google,workspace,storage'],
  ['onedrive', 'OneDrive', 'storage', 'storage', 'tier_0', 'files,microsoft,office,storage'],
  ['dropbox', 'Dropbox', 'storage', 'storage', 'tier_1', 'files,storage'],
  ['box', 'Box', 'storage', 'storage', 'tier_1', 'files,enterprise,storage'],
  ['google-docs', 'Google Docs', 'docs', 'docs', 'tier_0', 'docs,google,workspace'],
  ['google-sheets', 'Google Sheets', 'database', 'database', 'tier_0', 'sheets,spreadsheet,google,database'],
  ['microsoft-excel', 'Microsoft Excel', 'database', 'database', 'tier_0', 'sheets,spreadsheet,microsoft,database'],
  ['notion', 'Notion', 'docs', 'docs', 'tier_0', 'docs,wiki,knowledge'],
  ['airtable', 'Airtable', 'database', 'database', 'tier_0', 'database,spreadsheet,ops'],
  ['coda', 'Coda', 'docs', 'docs', 'tier_1', 'docs,wiki,ops'],
  ['confluence', 'Confluence', 'docs', 'docs', 'tier_1', 'docs,wiki,atlassian'],
  ['sharepoint', 'SharePoint', 'storage', 'storage', 'tier_1', 'files,microsoft,enterprise'],
  ['hubspot', 'HubSpot', 'crm', 'crm', 'tier_0', 'crm,sales,marketing'],
  ['salesforce', 'Salesforce', 'crm', 'crm', 'tier_0', 'crm,sales,enterprise'],
  ['pipedrive', 'Pipedrive', 'crm', 'crm', 'tier_1', 'crm,sales'],
  ['zoho-crm', 'Zoho CRM', 'crm', 'crm', 'tier_1', 'crm,sales'],
  ['close', 'Close', 'crm', 'crm', 'tier_1', 'crm,sales'],
  ['attio', 'Attio', 'crm', 'crm', 'tier_1', 'crm,sales,startups'],
  ['linear', 'Linear', 'workflow', 'project', 'tier_0', 'project,engineering,tickets'],
  ['jira', 'Jira', 'workflow', 'project', 'tier_0', 'project,engineering,tickets,atlassian'],
  ['github', 'GitHub', 'workflow', 'dev', 'tier_0', 'code,dev,issues,git'],
  ['gitlab', 'GitLab', 'workflow', 'dev', 'tier_1', 'code,dev,issues,git'],
  ['bitbucket', 'Bitbucket', 'workflow', 'dev', 'tier_2', 'code,dev,git,atlassian'],
  ['asana', 'Asana', 'workflow', 'project', 'tier_1', 'project,tasks'],
  ['trello', 'Trello', 'workflow', 'project', 'tier_1', 'project,tasks,atlassian'],
  ['monday', 'monday.com', 'workflow', 'project', 'tier_1', 'project,tasks,ops'],
  ['clickup', 'ClickUp', 'workflow', 'project', 'tier_1', 'project,tasks,ops'],
  ['basecamp', 'Basecamp', 'workflow', 'project', 'tier_2', 'project,tasks'],
  ['zendesk', 'Zendesk', 'crm', 'support', 'tier_0', 'support,tickets,customer-success'],
  ['intercom', 'Intercom', 'crm', 'support', 'tier_0', 'support,chat,customer-success'],
  ['freshdesk', 'Freshdesk', 'crm', 'support', 'tier_1', 'support,tickets'],
  ['helpscout', 'Help Scout', 'crm', 'support', 'tier_1', 'support,tickets'],
  ['front', 'Front', 'email', 'support', 'tier_1', 'support,email,shared-inbox'],
  ['gorgias', 'Gorgias', 'crm', 'support', 'tier_1', 'support,ecommerce'],
  ['stripe', 'Stripe', 'workflow', 'finance', 'tier_0', 'payments,billing,finance'],
  ['quickbooks', 'QuickBooks', 'workflow', 'finance', 'tier_0', 'accounting,finance'],
  ['xero', 'Xero', 'workflow', 'finance', 'tier_1', 'accounting,finance'],
  ['netsuite', 'NetSuite', 'workflow', 'finance', 'tier_1', 'erp,finance,enterprise'],
  ['sage', 'Sage', 'workflow', 'finance', 'tier_2', 'accounting,finance'],
  ['plaid', 'Plaid', 'workflow', 'finance', 'tier_1', 'banking,finance'],
  ['shopify', 'Shopify', 'workflow', 'commerce', 'tier_0', 'ecommerce,orders,commerce'],
  ['woocommerce', 'WooCommerce', 'workflow', 'commerce', 'tier_1', 'ecommerce,orders,wordpress'],
  ['bigcommerce', 'BigCommerce', 'workflow', 'commerce', 'tier_1', 'ecommerce,orders'],
  ['amazon-seller-central', 'Amazon Seller Central', 'workflow', 'commerce', 'tier_1', 'marketplace,ecommerce'],
  ['ebay', 'eBay', 'workflow', 'commerce', 'tier_2', 'marketplace,ecommerce'],
  ['etsy', 'Etsy', 'workflow', 'commerce', 'tier_2', 'marketplace,ecommerce'],
  ['mailchimp', 'Mailchimp', 'workflow', 'marketing', 'tier_0', 'email-marketing,marketing'],
  ['klaviyo', 'Klaviyo', 'workflow', 'marketing', 'tier_0', 'email-marketing,ecommerce,marketing'],
  ['marketo', 'Marketo', 'workflow', 'marketing', 'tier_1', 'marketing,enterprise'],
  ['braze', 'Braze', 'workflow', 'marketing', 'tier_1', 'marketing,lifecycle'],
  ['customer-io', 'Customer.io', 'workflow', 'marketing', 'tier_1', 'marketing,lifecycle'],
  ['sendgrid', 'SendGrid', 'email', 'email', 'tier_1', 'email,transactional'],
  ['postmark', 'Postmark', 'email', 'email', 'tier_1', 'email,transactional'],
  ['twilio', 'Twilio', 'chat', 'chat', 'tier_0', 'sms,voice,communications'],
  ['discord', 'Discord', 'chat', 'chat', 'tier_1', 'chat,community'],
  ['telegram', 'Telegram', 'chat', 'chat', 'tier_1', 'chat,community'],
  ['whatsapp-business', 'WhatsApp Business', 'chat', 'chat', 'tier_1', 'chat,meta,customer-comms'],
  ['facebook-pages', 'Facebook Pages', 'workflow', 'marketing', 'tier_1', 'social,meta,marketing'],
  ['instagram-business', 'Instagram Business', 'workflow', 'marketing', 'tier_1', 'social,meta,marketing'],
  ['linkedin', 'LinkedIn', 'workflow', 'sales', 'tier_1', 'social,sales,gtm'],
  ['x-twitter', 'X / Twitter', 'workflow', 'marketing', 'tier_1', 'social,marketing'],
  ['youtube', 'YouTube', 'storage', 'storage', 'tier_1', 'video,content'],
  ['tiktok', 'TikTok', 'workflow', 'marketing', 'tier_2', 'social,video,marketing'],
  ['google-analytics', 'Google Analytics', 'database', 'analytics', 'tier_0', 'analytics,web,marketing'],
  ['mixpanel', 'Mixpanel', 'database', 'analytics', 'tier_1', 'analytics,product'],
  ['amplitude', 'Amplitude', 'database', 'analytics', 'tier_1', 'analytics,product'],
  ['segment', 'Segment', 'database', 'analytics', 'tier_1', 'analytics,cdp'],
  ['snowflake', 'Snowflake', 'database', 'database', 'tier_0', 'warehouse,data'],
  ['bigquery', 'BigQuery', 'database', 'database', 'tier_0', 'warehouse,google,data'],
  ['redshift', 'Redshift', 'database', 'database', 'tier_1', 'warehouse,aws,data'],
  ['postgres', 'Postgres', 'database', 'database', 'tier_0', 'database,sql'],
  ['mysql', 'MySQL', 'database', 'database', 'tier_1', 'database,sql'],
  ['mongodb', 'MongoDB', 'database', 'database', 'tier_1', 'database,nosql'],
  ['supabase', 'Supabase', 'database', 'database', 'tier_1', 'database,postgres'],
  ['firebase', 'Firebase', 'database', 'database', 'tier_1', 'database,google,app'],
  ['redis', 'Redis', 'database', 'database', 'tier_2', 'database,cache'],
  ['aws-s3', 'Amazon S3', 'storage', 'storage', 'tier_0', 'files,aws,storage'],
  ['aws-lambda', 'AWS Lambda', 'workflow', 'dev', 'tier_1', 'aws,serverless,dev'],
  ['aws-cloudwatch', 'AWS CloudWatch', 'database', 'analytics', 'tier_1', 'aws,logs,observability'],
  ['google-cloud-storage', 'Google Cloud Storage', 'storage', 'storage', 'tier_1', 'files,gcp,storage'],
  ['azure-blob-storage', 'Azure Blob Storage', 'storage', 'storage', 'tier_1', 'files,azure,storage'],
  ['vercel', 'Vercel', 'workflow', 'dev', 'tier_1', 'deployments,dev'],
  ['netlify', 'Netlify', 'workflow', 'dev', 'tier_2', 'deployments,dev'],
  ['cloudflare', 'Cloudflare', 'workflow', 'dev', 'tier_1', 'edge,dev,dns'],
  ['sentry', 'Sentry', 'workflow', 'dev', 'tier_1', 'errors,observability,dev'],
  ['datadog', 'Datadog', 'database', 'analytics', 'tier_1', 'observability,logs,metrics'],
  ['new-relic', 'New Relic', 'database', 'analytics', 'tier_2', 'observability,logs,metrics'],
  ['pagerduty', 'PagerDuty', 'workflow', 'project', 'tier_1', 'incident,on-call'],
  ['opsgenie', 'Opsgenie', 'workflow', 'project', 'tier_2', 'incident,on-call,atlassian'],
  ['okta', 'Okta', 'internal', 'workflow', 'tier_1', 'identity,security'],
  ['auth0', 'Auth0', 'internal', 'workflow', 'tier_1', 'identity,security'],
  ['workday', 'Workday', 'workflow', 'hr', 'tier_1', 'hr,finance,enterprise'],
  ['bamboohr', 'BambooHR', 'workflow', 'hr', 'tier_1', 'hr,people'],
  ['greenhouse', 'Greenhouse', 'workflow', 'hr', 'tier_1', 'recruiting,hr'],
  ['lever', 'Lever', 'workflow', 'hr', 'tier_1', 'recruiting,hr'],
  ['gusto', 'Gusto', 'workflow', 'hr', 'tier_1', 'payroll,hr'],
  ['rippling', 'Rippling', 'workflow', 'hr', 'tier_1', 'hr,it,identity'],
  ['docusign', 'DocuSign', 'docs', 'docs', 'tier_1', 'contracts,signature,legal'],
  ['pandadoc', 'PandaDoc', 'docs', 'docs', 'tier_1', 'contracts,signature,sales'],
  ['hellosign', 'Dropbox Sign', 'docs', 'docs', 'tier_2', 'contracts,signature'],
  ['clio', 'Clio', 'workflow', 'project', 'tier_1', 'legal,practice-management'],
  ['ironclad', 'Ironclad', 'docs', 'docs', 'tier_1', 'legal,contracts'],
  ['lexisnexis', 'LexisNexis', 'docs', 'docs', 'tier_2', 'legal,research'],
  ['calendly', 'Calendly', 'calendar', 'calendar', 'tier_0', 'scheduling,calendar'],
  ['cal-com', 'Cal.com', 'calendar', 'calendar', 'tier_1', 'scheduling,calendar'],
  ['zoom', 'Zoom', 'calendar', 'calendar', 'tier_0', 'meetings,video,calendar'],
  ['google-meet', 'Google Meet', 'calendar', 'calendar', 'tier_1', 'meetings,google,video'],
  ['microsoft-graph', 'Microsoft Graph', 'internal', 'workflow', 'tier_0', 'microsoft,enterprise,identity'],
  ['openai', 'OpenAI', 'workflow', 'ai', 'tier_0', 'ai,llm'],
  ['anthropic', 'Anthropic', 'workflow', 'ai', 'tier_1', 'ai,llm'],
  ['gemini', 'Google Gemini', 'workflow', 'ai', 'tier_1', 'ai,llm,google'],
  ['huggingface', 'Hugging Face', 'workflow', 'ai', 'tier_1', 'ai,models'],
  ['pinecone', 'Pinecone', 'database', 'database', 'tier_1', 'vector,database,ai'],
  ['weaviate', 'Weaviate', 'database', 'database', 'tier_1', 'vector,database,ai'],
  ['qdrant', 'Qdrant', 'database', 'database', 'tier_1', 'vector,database,ai'],
  ['zapier', 'Zapier', 'workflow', 'workflow', 'tier_1', 'automation,workflow'],
  ['make', 'Make', 'workflow', 'workflow', 'tier_1', 'automation,workflow'],
  ['nango', 'Nango', 'workflow', 'workflow', 'tier_1', 'integration-platform,oauth'],
  ['pipedream', 'Pipedream', 'workflow', 'workflow', 'tier_1', 'integration-platform,workflow'],
  ['open-automation-catalog', 'Open Automation Catalog', 'workflow', 'workflow', 'tier_1', 'automation,workflow,open-source'],
  ['webhook', 'Generic Webhook', 'webhook', 'webhook', 'tier_0', 'webhook,http,events', 'none'],
  ['http', 'HTTP Request', 'workflow', 'webhook', 'tier_0', 'http,api,webhook', 'none'],
  ['rss', 'RSS', 'webhook', 'webhook', 'tier_1', 'feeds,content', 'none'],
  ['zapier-transfer', 'Zapier Transfer', 'workflow', 'workflow', 'long_tail', 'automation,migration'],
  ['typeform', 'Typeform', 'workflow', 'marketing', 'tier_1', 'forms,marketing'],
  ['google-forms', 'Google Forms', 'workflow', 'marketing', 'tier_1', 'forms,google'],
  ['jotform', 'Jotform', 'workflow', 'marketing', 'tier_2', 'forms'],
  ['webflow', 'Webflow', 'workflow', 'marketing', 'tier_1', 'cms,website'],
  ['wordpress', 'WordPress', 'workflow', 'marketing', 'tier_1', 'cms,website'],
  ['contentful', 'Contentful', 'docs', 'docs', 'tier_1', 'cms,content'],
  ['sanity', 'Sanity', 'docs', 'docs', 'tier_1', 'cms,content'],
  ['figma', 'Figma', 'docs', 'docs', 'tier_0', 'design,creative'],
  ['canva', 'Canva', 'docs', 'docs', 'tier_1', 'design,creative'],
  ['adobe-creative-cloud', 'Adobe Creative Cloud', 'storage', 'storage', 'tier_1', 'design,creative,files'],
  ['miro', 'Miro', 'docs', 'docs', 'tier_1', 'whiteboard,collaboration'],
  ['figjam', 'FigJam', 'docs', 'docs', 'tier_2', 'whiteboard,design'],
]

export function listIntegrationCoverageSpecs(): IntegrationCoverageSpec[] {
  return COVERAGE_SPECS.map(([id, title, category, actionPack, priority, domains, auth = 'oauth2']) => ({
    id,
    title,
    category,
    actionPack,
    priority,
    auth,
    providerKinds: providerKindsFor(auth),
    domains: domains.split(',').map((domain) => domain.trim()).filter(Boolean),
    scopes: scopesFor(id, actionPack),
  }))
}

export function buildIntegrationCoverageConnectors(options: {
  providerId?: string
  priorities?: IntegrationCoveragePriority[]
  categories?: IntegrationConnectorCategory[]
  actionPacks?: IntegrationActionPack[]
} = {}): IntegrationConnector[] {
  const providerId = options.providerId ?? 'coverage'
  return listIntegrationCoverageSpecs()
    .filter((spec) => !options.priorities || options.priorities.includes(spec.priority))
    .filter((spec) => !options.categories || options.categories.includes(spec.category))
    .filter((spec) => !options.actionPacks || options.actionPacks.includes(spec.actionPack))
    .map((spec) => specToConnector(spec, providerId))
}

export function integrationCoverageChecklistMarkdown(): string {
  const specs = listIntegrationCoverageSpecs()
  const lines = [
    '# Agent Integrations Coverage Checklist',
    '',
    'Generated from `listIntegrationCoverageSpecs()`. Catalog presence means the product can plan/request/connect the integration; native adapters and runtime backends execute behind the same provider contract.',
    '',
    '## Summary',
    '',
    `- Total cataloged integrations: ${specs.length}`,
    `- Tier 0: ${specs.filter((spec) => spec.priority === 'tier_0').length}`,
    `- Tier 1: ${specs.filter((spec) => spec.priority === 'tier_1').length}`,
    `- Tier 2: ${specs.filter((spec) => spec.priority === 'tier_2').length}`,
    `- Long tail: ${specs.filter((spec) => spec.priority === 'long_tail').length}`,
    '',
    '## Checklist',
    '',
  ]
  for (const spec of specs) {
    lines.push(`- [ ] ${spec.priority} / ${spec.category} / ${spec.title} (${spec.id}) - ${spec.domains.join(', ')}`)
  }
  return `${lines.join('\n')}\n`
}

function specToConnector(spec: IntegrationCoverageSpec, providerId: string): IntegrationConnector {
  const actions = actionPack(spec.actionPack, spec.scopes ?? [])
  return {
    id: spec.id,
    providerId,
    title: spec.title,
    category: spec.category,
    auth: spec.auth,
    scopes: spec.scopes ?? [],
    actions,
    triggers: triggersFor(spec.actionPack, spec.scopes ?? []),
    metadata: {
      source: 'coverage-catalog',
      priority: spec.priority,
      domains: spec.domains,
      providerKinds: spec.providerKinds,
      executable: false,
    },
  }
}

function actionPack(pack: IntegrationActionPack, scopes: string[]): IntegrationConnectorAction[] {
  const readScope = scopes.find((scope) => scope.endsWith('.read')) ?? scopes[0]
  const writeScope = scopes.find((scope) => scope.endsWith('.write')) ?? scopes[1] ?? readScope
  const scope = (value?: string) => value ? [value] : []
  const read = (id: string, title: string, description: string): IntegrationConnectorAction => ({
    id,
    title,
    description,
    risk: 'read',
    requiredScopes: scope(readScope),
    dataClass: dataClassFor(pack),
    inputSchema: objectSchema(),
  })
  const write = (id: string, title: string, description: string): IntegrationConnectorAction => ({
    id,
    title,
    description,
    risk: 'write',
    requiredScopes: scope(writeScope),
    dataClass: dataClassFor(pack),
    approvalRequired: true,
    inputSchema: objectSchema(),
  })
  const destructive = (id: string, title: string, description: string): IntegrationConnectorAction => ({
    id,
    title,
    description,
    risk: 'destructive',
    requiredScopes: scope(writeScope),
    dataClass: dataClassFor(pack),
    approvalRequired: true,
    inputSchema: objectSchema(),
  })
  switch (pack) {
    case 'email': return [read('messages.search', 'Search messages', 'Search messages and threads.'), read('messages.read', 'Read message', 'Read a message by id.'), write('drafts.create', 'Create draft', 'Create an email draft.'), write('messages.send', 'Send message', 'Send or reply to an email message.')]
    case 'calendar': return [read('events.search', 'Search events', 'Search calendar events.'), read('availability.read', 'Read availability', 'Read availability windows.'), write('events.create', 'Create event', 'Create a calendar event.'), write('events.update', 'Update event', 'Update a calendar event.'), destructive('events.cancel', 'Cancel event', 'Cancel a calendar event.')]
    case 'chat': return [read('messages.search', 'Search messages', 'Search channel or direct messages.'), read('channels.list', 'List channels', 'List channels or rooms.'), write('messages.post', 'Send message', 'Send a message to a channel or direct message.'), write('threads.reply', 'Reply in thread', 'Reply to a thread or conversation.')]
    case 'crm': return [read('records.search', 'Search records', 'Search contacts, companies, and deals.'), read('records.read', 'Read record', 'Read a CRM record.'), write('records.upsert', 'Upsert record', 'Create or update a CRM record.'), write('notes.create', 'Create note', 'Add a note or activity.')]
    case 'storage': return [read('files.search', 'Search files', 'Search files and folders.'), read('files.read', 'Read file', 'Read file metadata or content.'), write('files.upload', 'Upload file', 'Upload a file.'), write('files.update', 'Update file', 'Update file metadata or content.')]
    case 'docs': return [read('documents.search', 'Search documents', 'Search documents or pages.'), read('documents.read', 'Read document', 'Read a document.'), write('documents.create', 'Create document', 'Create a document or page.'), write('documents.update', 'Update document', 'Update a document or page.')]
    case 'database': return [read('records.query', 'Query records', 'Query rows, records, or objects.'), read('records.read', 'Read record', 'Read one row, record, or object.'), write('records.upsert', 'Upsert record', 'Create or update a row, record, or object.'), destructive('records.delete', 'Delete record', 'Delete a row, record, or object.')]
    case 'project': return [read('tasks.search', 'Search tasks', 'Search tasks, tickets, or issues.'), read('tasks.read', 'Read task', 'Read a task, ticket, or issue.'), write('tasks.create', 'Create task', 'Create a task, ticket, or issue.'), write('tasks.update', 'Update task', 'Update a task, ticket, or issue.')]
    case 'support': return [read('tickets.search', 'Search tickets', 'Search support tickets or conversations.'), read('customers.read', 'Read customer', 'Read a customer profile.'), write('tickets.reply', 'Reply to ticket', 'Reply to a support ticket.'), write('tickets.update', 'Update ticket', 'Update ticket status, tags, or assignee.')]
    case 'marketing': return [read('contacts.search', 'Search contacts', 'Search marketing contacts or audiences.'), read('campaigns.read', 'Read campaign', 'Read campaign metadata and performance.'), write('contacts.upsert', 'Upsert contact', 'Create or update a contact.'), write('campaigns.create', 'Create campaign', 'Create a campaign draft.')]
    case 'sales': return [read('prospects.search', 'Search prospects', 'Search prospects, leads, or accounts.'), read('activities.read', 'Read activities', 'Read sales activity history.'), write('prospects.upsert', 'Upsert prospect', 'Create or update a prospect.'), write('sequence.enqueue', 'Enroll in sequence', 'Enroll a prospect in a sales sequence.')]
    case 'commerce': return [read('orders.search', 'Search orders', 'Search orders.'), read('customers.read', 'Read customer', 'Read customer and purchase history.'), write('orders.update', 'Update order', 'Update order metadata or fulfillment state.'), write('products.update', 'Update product', 'Update product metadata.')]
    case 'finance': return [read('transactions.search', 'Search transactions', 'Search transactions, invoices, or payments.'), read('accounts.read', 'Read account', 'Read account or customer financial record.'), write('invoices.create', 'Create invoice', 'Create an invoice or payment object.'), write('records.sync', 'Sync record', 'Sync a finance or accounting record.')]
    case 'hr': return [read('people.search', 'Search people', 'Search employees, candidates, or contractors.'), read('people.read', 'Read person', 'Read a person profile.'), write('people.update', 'Update person', 'Update a person profile.'), write('events.create', 'Create HR event', 'Create a recruiting or HR event.')]
    case 'dev': return [read('resources.search', 'Search resources', 'Search issues, repos, deployments, logs, or incidents.'), read('resources.read', 'Read resource', 'Read a developer resource.'), write('resources.create', 'Create resource', 'Create an issue, deployment, incident, or config.'), write('resources.update', 'Update resource', 'Update a developer resource.')]
    case 'ai': return [read('models.list', 'List models', 'List available models or endpoints.'), write('responses.create', 'Create response', 'Create an AI response or job.'), write('embeddings.create', 'Create embeddings', 'Create embeddings or vector jobs.'), read('usage.read', 'Read usage', 'Read usage metadata.')]
    case 'analytics': return [read('reports.query', 'Query reports', 'Query analytics reports.'), read('events.search', 'Search events', 'Search analytics events.'), write('events.track', 'Track event', 'Track an analytics event.'), write('audiences.sync', 'Sync audience', 'Sync an audience or cohort.')]
    case 'workflow': return [read('runs.search', 'Search runs', 'Search workflow runs or jobs.'), read('templates.list', 'List templates', 'List workflow templates.'), write('runs.start', 'Start run', 'Start a workflow run.'), write('webhooks.dispatch', 'Dispatch webhook', 'Dispatch a workflow webhook.')]
    case 'webhook': return [write('requests.send', 'Send request', 'Send an HTTP request or webhook event.'), read('events.search', 'Search events', 'Search received webhook events.'), write('subscriptions.create', 'Create subscription', 'Create a webhook subscription.'), destructive('subscriptions.delete', 'Delete subscription', 'Delete a webhook subscription.')]
  }
}

function triggersFor(pack: IntegrationActionPack, scopes: string[]): IntegrationConnectorTrigger[] | undefined {
  const readScope = scopes.find((scope) => scope.endsWith('.read')) ?? scopes[0]
  const requiredScopes = readScope ? [readScope] : []
  if (pack === 'email') return [{ id: 'message.received', title: 'Message received', requiredScopes, dataClass: 'private' }]
  if (pack === 'calendar') return [{ id: 'event.changed', title: 'Event changed', requiredScopes, dataClass: 'private' }]
  if (pack === 'chat') return [{ id: 'message.posted', title: 'Message posted', requiredScopes, dataClass: 'private' }]
  if (pack === 'crm') return [{ id: 'record.changed', title: 'Record changed', requiredScopes, dataClass: 'private' }]
  if (pack === 'support') return [{ id: 'ticket.changed', title: 'Ticket changed', requiredScopes, dataClass: 'private' }]
  if (pack === 'commerce') return [{ id: 'order.changed', title: 'Order changed', requiredScopes, dataClass: 'sensitive' }]
  if (pack === 'finance') return [{ id: 'transaction.changed', title: 'Transaction changed', requiredScopes, dataClass: 'sensitive' }]
  if (pack === 'workflow' || pack === 'webhook') return [{ id: 'event.received', title: 'Event received', requiredScopes, dataClass: 'internal' }]
  return undefined
}

function scopesFor(id: string, pack: IntegrationActionPack): string[] {
  if (pack === 'webhook') return []
  return [`${id}.read`, `${id}.write`]
}

function providerKindsFor(auth: IntegrationConnector['auth']): IntegrationProviderKind[] {
  if (auth === 'none') return ['first_party', 'pipedream', 'tangle_catalog', 'custom']
  return DEFAULT_PROVIDER_KINDS
}

function dataClassFor(pack: IntegrationActionPack): 'public' | 'internal' | 'private' | 'sensitive' {
  if (pack === 'finance' || pack === 'commerce' || pack === 'hr') return 'sensitive'
  if (pack === 'workflow' || pack === 'webhook' || pack === 'dev' || pack === 'analytics') return 'internal'
  return 'private'
}

function objectSchema(): unknown {
  return { type: 'object', additionalProperties: true, properties: {} }
}
