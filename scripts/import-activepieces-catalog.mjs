#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.env.ACTIVEPIECES_ROOT
if (!root) {
  throw new Error('Set ACTIVEPIECES_ROOT to a checkout of github.com/activepieces/activepieces')
}

const communityDir = join(root, 'packages/pieces/community')
const entries = []

for (const dirent of await readdir(communityDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue
  const id = dirent.name
  const pieceDir = join(communityDir, id)
  const pkg = JSON.parse(await readFile(join(pieceDir, 'package.json'), 'utf8'))
  const index = await readOptional(join(pieceDir, 'src/index.ts'))
  const readme = await readOptional(join(pieceDir, 'README.md'))
  const displayName = matchString(index, /displayName:\s*['"`]([^'"`]+)['"`]/)
    ?? titleFromId(id)
  const description = matchString(index, /description:\s*['"`]([^'"`]+)['"`]/)
    ?? firstReadmeLine(readme)
    ?? `${displayName} integration.`
  const categories = [...index.matchAll(/PieceCategory\.([A-Z_]+)/g)].map((m) => m[1])
  const auth = inferAuth(index)
  const actionNames = importedNames(index, /from\s+['"]\.\/lib\/actions\//)
  const triggerNames = importedNames(index, /from\s+['"]\.\/lib\/triggers\//)
  entries.push({
    id,
    title: displayName,
    description,
    npmPackage: pkg.name,
    version: pkg.version,
    category: categoryFor(categories, id, description),
    auth,
    domains: domainsFor(id, categories, description),
    actions: actionNames.map((name) => actionFromName(name)),
    triggers: triggerNames.map((name) => triggerFromName(name)),
    source: {
      repository: 'https://github.com/activepieces/activepieces',
      path: `packages/pieces/community/${id}`,
      license: 'MIT',
    },
  })
}

entries.sort((a, b) => a.id.localeCompare(b.id))

await writeFile('data/activepieces-catalog.json', JSON.stringify(entries, null, 2) + '\n')
console.log(`wrote ${entries.length} Activepieces catalog entries to data/activepieces-catalog.json`)

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function matchString(text, regex) {
  return text.match(regex)?.[1]?.trim()
}

function firstReadmeLine(readme) {
  return readme.split('\n').map((line) => line.trim()).find((line) =>
    line && !line.startsWith('#') && !line.startsWith('![')
  )
}

function importedNames(index, pathRegex) {
  const names = []
  for (const stmt of index.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g)) {
    const full = stmt[0]
    if (!pathRegex.test(full)) continue
    names.push(...stmt[1].split(',').map((part) =>
      part.trim().replace(/\s+as\s+.*/, '')
    ).filter(Boolean))
  }
  return [...new Set(names)]
}

function inferAuth(index) {
  if (/PieceAuth\.None|auth:\s*undefined|auth:\s*null/.test(index)) return 'none'
  if (/OAuth2|oauth2|OAuth/.test(index)) return 'oauth2'
  if (/SecretText|apiKey|api_key|bearer|token/i.test(index)) return 'api_key'
  return 'custom'
}

const UPSTREAM_CATEGORY_MAP = {
  'communication': 'chat',
  'team-collaboration': 'chat',
  'forms-and-surveys': 'webhook',
  'sales-and-crm': 'crm',
  'marketing': 'crm',
  'customer-support': 'crm',
  'human-resources': 'crm',
  'productivity': 'docs',
  'content-and-files': 'storage',
  'commerce': 'crm',
  'payment-processing': 'crm',
  'finance': 'crm',
  'accounting': 'crm',
  'flow-control': 'workflow',
  'core': 'workflow',
  'developer-tools': 'workflow',
  'business-intelligence': 'database',
  'artificial-intelligence': 'workflow',
  'analytics': 'database',
  'advertising': 'crm',
  'video-and-audio': 'storage',
  'ecommerce': 'crm',
}

function categoryFor(categories, id, description) {
  for (const cat of categories.map((c) => c.toLowerCase().replace(/_/g, '-'))) {
    const mapped = UPSTREAM_CATEGORY_MAP[cat]
    if (mapped) return mapped
  }
  const text = `${id} ${description} ${categories.join(' ')}`.toLowerCase()
  if (/\b(mail|email|gmail|outlook|smtp|sendgrid|postmark|mailchimp|convertkit|imap|sendinblue)\b/.test(text)) return 'email'
  if (/\b(calendar|scheduling|booking|meeting|zoom|calendly|cronofy|savvycal|nylas|doodle)\b/.test(text)) return 'calendar'
  if (/\b(slack|discord|teams|chat|sms|whatsapp|telegram|messag(e|ing)|signal|matrix|zulip|mattermost|pusher|twist|rocket\.?chat)\b/.test(text)) return 'chat'
  if (/\b(crm|salesforce|hubspot|pipedrive|zoho|monday|copper|freshsales|insightly|contact|lead|sales|opportunity|deal)\b/.test(text)) return 'crm'
  if (/\b(drive|dropbox|s3|storage|file|cloudinary|bucket|object-storage|cdn|onedrive|box|wasabi|backblaze|gcs)\b/.test(text)) return 'storage'
  if (/\b(doc|docs|notion|wiki|cms|contentful|wordpress|webflow|ghost|prismic|sanity|strapi)\b/.test(text)) return 'docs'
  if (/\b(database|postgres|postgresql|mysql|mariadb|airtable|sheet|spreadsheet|mongodb|supabase|firestore|dynamodb|redis|sqlite|clickhouse|bigquery|snowflake)\b/.test(text)) return 'database'
  if (/\b(webhook|http|form|rss|atom|incoming-?webhook)\b/.test(text)) return 'webhook'
  if (/\b(internal|identity|sso|oauth|saml|security|auth|kms|secret|vault|password)\b/.test(text)) return 'internal'
  return 'workflow'
}

function domainsFor(id, categories, description) {
  return [...new Set([
    'activepieces',
    ...id.split('-').filter(Boolean),
    ...categories.map((c) => c.toLowerCase().replace(/_/g, '-')),
    ...description.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3).slice(0, 6),
  ])]
}

function actionFromName(name) {
  const id = normalizeCapabilityName(name)
  return {
    id,
    title: titleFromId(id),
    risk: riskForName(id),
  }
}

function triggerFromName(name) {
  const id = normalizeCapabilityName(name)
  return {
    id,
    title: titleFromId(id),
  }
}

function normalizeCapabilityName(name) {
  return name.replace(/Action$|Trigger$/i, '').replace(/([a-z])([A-Z])/g, '$1.$2').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
}

function riskForName(id) {
  if (/\b(delete|remove|destroy|cancel|void|revoke|archive)\b/.test(id)) return 'destructive'
  if (/\b(get|list|read|search|find|fetch|retrieve|lookup|query|download)\b/.test(id)) return 'read'
  return 'write'
}

function titleFromId(id) {
  return id.split(/[-._]+/).filter(Boolean).map((part) =>
    part.slice(0, 1).toUpperCase() + part.slice(1)
  ).join(' ')
}
