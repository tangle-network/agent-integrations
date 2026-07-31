/** Canonical provider ids shared by catalog, setup, runtime, and audits. */
export const INTEGRATION_KIND_ALIASES: Readonly<Record<string, string>> = {
  'notion-database': 'notion',
  'microsoft-onedrive': 'onedrive',
  'microsoft-sharepoint': 'sharepoint',
  'microsoft-excel': 'microsoft-excel-365',
  'aws-s3': 'amazon-s3',
  'outlook-calendar': 'microsoft-calendar',
  'microsoft-outlook-calendar': 'microsoft-calendar',
  'microsoft-outlook': 'outlook-mail',
  'gmail-mail': 'gmail',
  'slack-bolt': 'slack',
  'help-scout': 'helpscout',
  'mycase-piece': 'mycase',
  jira: 'jira-cloud',
  stripe: 'stripe-pack',
  twilio: 'twilio-sms',
  'twilio-voice': 'twilio-sms',
  'telegram-bot': 'telegram',
  scrapegrapghai: 'scrapegraphai',
}

export function canonicalIntegrationKind(kind: string): string {
  return INTEGRATION_KIND_ALIASES[kind] ?? kind
}
