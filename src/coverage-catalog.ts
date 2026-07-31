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
  | 'meeting'
  | 'telephony'

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
  ['google-contacts', 'Google Contacts and Directory', 'crm', 'crm', 'tier_0', 'contacts,people,directory,google,workspace'],
  ['google-slides', 'Google Slides', 'docs', 'docs', 'tier_1', 'slides,presentations,google,workspace'],
  ['googlechat', 'Google Chat', 'chat', 'chat', 'tier_1', 'chat,collaboration,google,workspace'],
  ['google-tasks', 'Google Tasks', 'workflow', 'project', 'tier_1', 'tasks,google,workspace'],
  ['microsoft-excel-365', 'Microsoft Excel 365', 'database', 'database', 'tier_0', 'sheets,spreadsheet,microsoft,office,database'],
  ['notion', 'Notion', 'docs', 'docs', 'tier_0', 'docs,wiki,knowledge'],
  ['airtable', 'Airtable', 'database', 'database', 'tier_0', 'database,spreadsheet,ops'],
  ['coda', 'Coda', 'docs', 'docs', 'tier_1', 'docs,wiki,ops'],
  ['confluence', 'Confluence', 'docs', 'docs', 'tier_1', 'docs,wiki,atlassian'],
  ['sharepoint', 'SharePoint', 'storage', 'storage', 'tier_1', 'files,microsoft,enterprise'],
  ['microsoft-365-people', 'Microsoft 365 People', 'crm', 'crm', 'tier_0', 'contacts,people,microsoft,office'],
  ['microsoft-365-planner', 'Microsoft Planner', 'workflow', 'project', 'tier_1', 'tasks,planning,microsoft,office'],
  ['microsoft-todo', 'Microsoft To Do', 'workflow', 'project', 'tier_1', 'tasks,microsoft,office'],
  ['microsoft-onenote', 'Microsoft OneNote', 'docs', 'docs', 'tier_1', 'notes,docs,microsoft,office'],
  ['microsoft-dynamics-crm', 'Microsoft Dynamics 365 CRM', 'crm', 'crm', 'tier_0', 'crm,sales,microsoft,dynamics'],
  ['microsoft-dynamics-365-business-central', 'Microsoft Dynamics 365 Business Central', 'workflow', 'finance', 'tier_1', 'erp,finance,microsoft,dynamics'],
  ['microsoft-power-bi', 'Microsoft Power BI', 'database', 'analytics', 'tier_1', 'analytics,reporting,microsoft,office'],
  ['microsoft-forms', 'Microsoft Forms', 'workflow', 'marketing', 'tier_1', 'forms,microsoft,office,commercial-api', 'custom'],
  ['microsoft-word', 'Microsoft Word', 'docs', 'docs', 'tier_1', 'docs,microsoft,office,commercial-api', 'custom'],
  ['hubspot', 'HubSpot', 'crm', 'crm', 'tier_0', 'crm,sales,marketing'],
  ['salesforce', 'Salesforce', 'crm', 'crm', 'tier_0', 'crm,sales,enterprise'],
  ['pipedrive', 'Pipedrive', 'crm', 'crm', 'tier_1', 'crm,sales'],
  ['zoho-crm', 'Zoho CRM', 'crm', 'crm', 'tier_1', 'crm,sales'],
  ['zoho-desk', 'Zoho Desk', 'crm', 'support', 'tier_1', 'support,tickets,crm,zoho'],
  ['zoho-bookings', 'Zoho Bookings', 'calendar', 'calendar', 'tier_1', 'appointments,scheduling,calendar,zoho'],
  ['zoho-books', 'Zoho Books', 'workflow', 'finance', 'tier_1', 'accounting,invoices,finance,zoho'],
  ['zoho-invoice', 'Zoho Invoice', 'workflow', 'finance', 'tier_1', 'invoices,billing,finance,zoho'],
  ['zoho-mail', 'Zoho Mail', 'email', 'email', 'tier_1', 'email,inbox,zoho'],
  ['zoho-campaigns', 'Zoho Campaigns', 'workflow', 'marketing', 'tier_1', 'email-marketing,campaigns,zoho'],
  ['close', 'Close', 'crm', 'crm', 'tier_1', 'crm,sales'],
  ['attio', 'Attio', 'crm', 'crm', 'tier_1', 'crm,sales,startups'],
  ['affinity', 'Affinity', 'crm', 'crm', 'tier_0', 'crm,relationships,private-markets', 'api_key'],
  ['dealcloud', 'DealCloud', 'crm', 'crm', 'tier_0', 'crm,relationships,private-markets,commercial-api', 'custom'],
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
  ['chargebee', 'Chargebee', 'workflow', 'finance', 'tier_1', 'subscriptions,billing,revenue', 'api_key'],
  ['paddle', 'Paddle', 'workflow', 'finance', 'tier_1', 'payments,billing,merchant-of-record', 'api_key'],
  ['quickbooks', 'QuickBooks', 'workflow', 'finance', 'tier_0', 'accounting,finance'],
  ['xero', 'Xero', 'workflow', 'finance', 'tier_1', 'accounting,finance'],
  ['netsuite', 'NetSuite', 'workflow', 'finance', 'tier_1', 'erp,finance,enterprise', 'api_key'],
  ['sage', 'Sage', 'workflow', 'finance', 'tier_2', 'accounting,finance'],
  ['sage-intacct', 'Sage Intacct', 'workflow', 'finance', 'tier_1', 'accounting,erp,finance', 'api_key'],
  ['plaid', 'Plaid', 'workflow', 'finance', 'tier_1', 'banking,finance', 'api_key'],
  ['ramp', 'Ramp', 'workflow', 'finance', 'tier_1', 'cards,expenses,finance', 'api_key'],
  ['brex', 'Brex', 'workflow', 'finance', 'tier_1', 'cards,expenses,finance', 'api_key'],
  ['bill-com', 'BILL', 'workflow', 'finance', 'tier_1', 'accounts-payable,bills,payments', 'api_key'],
  ['avalara', 'Avalara AvaTax', 'workflow', 'finance', 'tier_1', 'tax,sales-tax,compliance,finance', 'api_key'],
  ['taxjar', 'TaxJar', 'workflow', 'finance', 'tier_1', 'tax,sales-tax,compliance,finance', 'api_key'],
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
  ['open-phone', 'OpenPhone', 'chat', 'telephony', 'tier_0', 'sms,voice,telephony,communications', 'api_key'],
  ['ringcentral', 'RingCentral', 'chat', 'telephony', 'tier_0', 'voice,sms,telephony,communications'],
  ['dialpad', 'Dialpad', 'chat', 'telephony', 'tier_0', 'voice,sms,telephony,communications'],
  ['aircall', 'Aircall', 'chat', 'telephony', 'tier_1', 'voice,telephony,communications', 'api_key'],
  ['phony', 'ph0ny', 'chat', 'chat', 'tier_1', 'voice,telephony,communications', 'api_key'],
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
  ['amazon-sns', 'Amazon SNS', 'webhook', 'webhook', 'tier_1', 'events,notifications,aws', 'api_key'],
  ['amazon-sqs', 'Amazon SQS', 'webhook', 'webhook', 'tier_1', 'events,queues,aws', 'api_key'],
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
  ['okta', 'Okta', 'internal', 'workflow', 'tier_1', 'identity,security', 'api_key'],
  ['auth0', 'Auth0', 'internal', 'workflow', 'tier_1', 'identity,security'],
  ['ping-identity', 'Ping Identity', 'internal', 'workflow', 'tier_1', 'identity,security,provisioning', 'api_key'],
  ['onelogin', 'OneLogin', 'internal', 'workflow', 'tier_1', 'identity,security,provisioning', 'api_key'],
  ['scim', 'SCIM', 'internal', 'workflow', 'tier_1', 'identity,security,provisioning', 'api_key'],
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
  ['mycase', 'MyCase', 'crm', 'project', 'tier_1', 'legal,practice-management,cases'],
  ['ironclad', 'Ironclad', 'docs', 'docs', 'tier_1', 'legal,contracts'],
  ['lexisnexis', 'LexisNexis', 'docs', 'docs', 'tier_2', 'legal,research'],
  ['calendly', 'Calendly', 'calendar', 'calendar', 'tier_0', 'scheduling,calendar'],
  ['cal-com', 'Cal.com', 'calendar', 'calendar', 'tier_1', 'scheduling,calendar'],
  ['zoom', 'Zoom', 'calendar', 'calendar', 'tier_0', 'meetings,video,calendar'],
  ['granola', 'Granola', 'docs', 'meeting', 'tier_0', 'meetings,notes,transcripts', 'api_key'],
  ['gong', 'Gong', 'docs', 'meeting', 'tier_0', 'meetings,calls,transcripts,sales'],
  ['fathom', 'Fathom', 'docs', 'meeting', 'tier_0', 'meetings,notes,transcripts'],
  ['fireflies-ai', 'Fireflies.ai', 'docs', 'meeting', 'tier_0', 'meetings,notes,transcripts', 'api_key'],
  ['otter', 'Otter.ai', 'docs', 'meeting', 'tier_0', 'meetings,notes,transcripts,commercial-api', 'custom'],
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
  ['actualbudget', 'Actual Budget', 'workflow', 'finance', 'tier_2', 'finance,budgeting,accounting', 'api_key'],
  ['aianswer', 'AI Answer', 'chat', 'ai', 'long_tail', 'ai,answers,chat', 'api_key'],
  ['airparser', 'Airparser', 'docs', 'docs', 'tier_2', 'documents,parsing,extraction', 'api_key'],
  ['anyhook-websocket', 'AnyHook WebSocket', 'webhook', 'webhook', 'long_tail', 'websocket,events,automation', 'api_key'],
  ['apify', 'Apify', 'database', 'workflow', 'tier_2', 'scraping,automation,data', 'api_key'],
  ['ask-handle', 'AskHandle', 'workflow', 'ai', 'long_tail', 'ai,forms,automation', 'api_key'],
  ['bannerbear', 'Bannerbear', 'docs', 'marketing', 'tier_2', 'images,creative,marketing', 'api_key'],
  ['base44', 'Base44', 'workflow', 'dev', 'long_tail', 'apps,automation,dev', 'api_key'],
  ['beehiiv', 'Beehiiv', 'email', 'marketing', 'tier_2', 'newsletter,email,marketing', 'api_key'],
  ['bika', 'Bika.ai', 'docs', 'database', 'long_tail', 'database,workspace,automation', 'api_key'],
  ['buttondown', 'Buttondown', 'email', 'marketing', 'tier_2', 'newsletter,email,marketing', 'api_key'],
  ['camb-ai', 'Camb.AI', 'workflow', 'ai', 'long_tail', 'ai,audio,translation', 'api_key'],
  ['cartloom', 'Cartloom', 'workflow', 'commerce', 'long_tail', 'commerce,checkout,orders', 'api_key'],
  ['chain-aware', 'ChainAware.AI', 'database', 'analytics', 'long_tail', 'blockchain,risk,analytics', 'api_key'],
  ['chaindesk', 'Chaindesk', 'workflow', 'ai', 'long_tail', 'ai,knowledge,chatbot', 'api_key'],
  ['chat-aid', 'Chat Aid', 'workflow', 'ai', 'long_tail', 'ai,chat,knowledge', 'api_key'],
  ['chatsistant', 'Chatsistant', 'chat', 'chat', 'long_tail', 'chat,ai,support', 'api_key'],
  ['claude', 'Anthropic Claude', 'workflow', 'ai', 'tier_1', 'ai,llm,anthropic', 'api_key'],
  ['clearoutphone', 'ClearoutPhone', 'workflow', 'telephony', 'long_tail', 'phone,validation,enrichment', 'api_key'],
  ['clickfunnels', 'ClickFunnels', 'workflow', 'marketing', 'tier_2', 'marketing,funnels,crm', 'api_key'],
  ['cody', 'Cody', 'workflow', 'ai', 'long_tail', 'ai,knowledge,assistant', 'api_key'],
  ['contextual-ai', 'Contextual AI', 'workflow', 'ai', 'tier_2', 'ai,rag,knowledge', 'api_key'],
  ['contiguity', 'Contiguity', 'chat', 'telephony', 'long_tail', 'sms,messaging,communications', 'api_key'],
  ['couchbase', 'Couchbase', 'database', 'database', 'tier_2', 'database,nosql,data', 'api_key'],
  ['dappier', 'Dappier', 'workflow', 'ai', 'long_tail', 'ai,data,search', 'api_key'],
  ['deepgram', 'Deepgram', 'workflow', 'ai', 'tier_2', 'audio,transcription,ai', 'api_key'],
  ['detecting-ai', 'Detecting AI', 'workflow', 'ai', 'long_tail', 'ai,detection,content', 'api_key'],
  ['digital-pilot', 'DigitalPilot', 'database', 'analytics', 'long_tail', 'analytics,marketing,data', 'api_key'],
  ['docsbot', 'DocsBot', 'docs', 'ai', 'long_tail', 'ai,docs,knowledge', 'api_key'],
  ['drip', 'Drip', 'crm', 'marketing', 'tier_2', 'crm,email,marketing', 'api_key'],
  ['echowin', 'Echowin', 'workflow', 'telephony', 'long_tail', 'voice,phone,ai', 'api_key'],
  ['elevenlabs', 'ElevenLabs', 'workflow', 'ai', 'tier_2', 'audio,voice,ai', 'api_key'],
  ['everhour', 'Everhour', 'workflow', 'project', 'tier_2', 'time-tracking,project,work', 'api_key'],
  ['feathery', 'Feathery', 'workflow', 'marketing', 'tier_2', 'forms,marketing,workflow', 'api_key'],
  ['fellow', 'Fellow.ai', 'docs', 'meeting', 'tier_2', 'meetings,notes,collaboration', 'api_key'],
  ['flow-parser', 'FlowParser', 'workflow', 'workflow', 'long_tail', 'parsing,automation,workflow', 'api_key'],
  ['gamma', 'Gamma', 'docs', 'docs', 'tier_2', 'presentations,docs,ai', 'api_key'],
  ['gender-api', 'Gender API', 'database', 'analytics', 'long_tail', 'enrichment,identity,analytics', 'api_key'],
  ['generatebanners', 'GenerateBanners', 'docs', 'marketing', 'long_tail', 'images,banners,marketing', 'api_key'],
  ['giftbit', 'Giftbit', 'workflow', 'commerce', 'long_tail', 'rewards,gift-cards,commerce', 'api_key'],
  ['modelslab', 'ModelsLab', 'workflow', 'ai', 'long_tail', 'images,media,ai', 'api_key'],
  ['webhook', 'Generic Webhook', 'webhook', 'webhook', 'tier_0', 'webhook,http,events', 'none'],
  ['http', 'HTTP / REST / OpenAPI Request', 'workflow', 'webhook', 'tier_0', 'http,api,rest,openapi,webhook', 'none'],
  ['rss', 'RSS', 'webhook', 'webhook', 'tier_1', 'feeds,content', 'none'],
  ['sftp', 'SFTP', 'storage', 'storage', 'tier_0', 'files,sftp,imports,commercial-api', 'custom'],
  ['csv-files', 'CSV Files', 'database', 'database', 'tier_0', 'files,csv,imports', 'none'],
  ['excel-files', 'Excel Files', 'database', 'database', 'tier_0', 'files,excel,imports', 'none'],
  ['parquet-files', 'Parquet Files', 'database', 'database', 'tier_1', 'files,parquet,imports', 'none'],
  ['kafka', 'Apache Kafka', 'webhook', 'webhook', 'tier_1', 'events,streams,kafka', 'custom'],
  ['amazon-eventbridge', 'Amazon EventBridge', 'webhook', 'webhook', 'tier_1', 'events,aws,eventbridge', 'custom'],
  ['google-pubsub', 'Google Pub/Sub', 'webhook', 'webhook', 'tier_1', 'events,google,pubsub', 'custom'],
  ['azure-event-grid', 'Azure Event Grid', 'webhook', 'webhook', 'tier_1', 'events,azure,event-grid', 'custom'],
  ['azure-service-bus', 'Azure Service Bus', 'webhook', 'webhook', 'tier_1', 'events,queues,azure,service-bus', 'custom'],
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
    case 'meeting': return [read('meetings.search', 'Search meetings', 'Search meetings and recorded calls.'), read('transcripts.read', 'Read transcript', 'Read a meeting transcript.'), read('summaries.read', 'Read summary', 'Read meeting notes, summaries, and action items.'), write('notes.create', 'Create note', 'Create or attach an approved note to a meeting.')]
    case 'telephony': return [read('calls.search', 'Search calls', 'Search inbound and outbound calls.'), read('recordings.read', 'Read recording', 'Read call recording metadata and transcripts.'), read('messages.search', 'Search messages', 'Search SMS and MMS conversations.'), write('messages.send', 'Send message', 'Send an approved SMS or MMS message.')]
  }
}

function triggersFor(pack: IntegrationActionPack, scopes: string[]): IntegrationConnectorTrigger[] | undefined {
  const readScope = scopes.find((scope) => scope.endsWith('.read')) ?? scopes[0]
  const requiredScopes = readScope ? [readScope] : []
  if (pack === 'email') return [{ id: 'message.received', title: 'Message received', requiredScopes, dataClass: 'private' }]
  if (pack === 'calendar') return [{ id: 'event.changed', title: 'Event changed', requiredScopes, dataClass: 'private' }]
  if (pack === 'chat') return [{ id: 'message.posted', title: 'Message posted', requiredScopes, dataClass: 'private' }]
  if (pack === 'crm') return [
    { id: 'person.changed', title: 'Person changed', requiredScopes, dataClass: 'private' },
    { id: 'company.changed', title: 'Company changed', requiredScopes, dataClass: 'private' },
    { id: 'opportunity.changed', title: 'Opportunity changed', requiredScopes, dataClass: 'private' },
    { id: 'stage.changed', title: 'Stage changed', requiredScopes, dataClass: 'private' },
    { id: 'owner.changed', title: 'Owner changed', requiredScopes, dataClass: 'private' },
    { id: 'record.deleted', title: 'Record deleted', requiredScopes, dataClass: 'private' },
  ]
  if (pack === 'docs') return [
    { id: 'document.changed', title: 'Document changed', requiredScopes, dataClass: 'private' },
    { id: 'document.shared', title: 'Document shared', requiredScopes, dataClass: 'private' },
  ]
  if (pack === 'database') return [{ id: 'record.changed', title: 'Record changed', requiredScopes, dataClass: 'private' }]
  if (pack === 'project') return [
    { id: 'task.changed', title: 'Task changed', requiredScopes, dataClass: 'private' },
    { id: 'task.overdue', title: 'Task overdue', requiredScopes, dataClass: 'private' },
  ]
  if (pack === 'support') return [{ id: 'ticket.changed', title: 'Ticket changed', requiredScopes, dataClass: 'private' }]
  if (pack === 'commerce') return [{ id: 'order.changed', title: 'Order changed', requiredScopes, dataClass: 'sensitive' }]
  if (pack === 'finance') return [{ id: 'transaction.changed', title: 'Transaction changed', requiredScopes, dataClass: 'sensitive' }]
  if (pack === 'workflow' || pack === 'webhook') return [{ id: 'event.received', title: 'Event received', requiredScopes, dataClass: 'internal' }]
  if (pack === 'meeting') return [
    { id: 'meeting.ended', title: 'Meeting ended', requiredScopes, dataClass: 'private' },
    { id: 'transcript.ready', title: 'Transcript ready', requiredScopes, dataClass: 'private' },
    { id: 'summary.ready', title: 'Summary ready', requiredScopes, dataClass: 'private' },
  ]
  if (pack === 'telephony') return [
    { id: 'call.completed', title: 'Call completed', requiredScopes, dataClass: 'private' },
    { id: 'call.missed', title: 'Call missed', requiredScopes, dataClass: 'private' },
    { id: 'recording.ready', title: 'Recording ready', requiredScopes, dataClass: 'private' },
    { id: 'transcript.ready', title: 'Transcript ready', requiredScopes, dataClass: 'private' },
    { id: 'message.received', title: 'Message received', requiredScopes, dataClass: 'private' },
  ]
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
