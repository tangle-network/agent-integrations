import { declarativeRestConnector } from './declarative-rest.js'

// AWS Secrets Manager JSON 1.1 protocol endpoint. Each request is signed with
// AWS Signature V4 (`credentialPlacement: aws-sigv4`) from the credential
// bundle in the api-key field; the bundle's region is substituted into the
// `{region}` host template, and the metadataKey indirection still lets callers
// override the host per-tenant without touching the manifest.
export const amazonSecretsManagerConnector = declarativeRestConnector({
  kind: 'amazon-secrets-manager',
  displayName: 'AWS Secrets Manager',
  description:
    'Create, read, update, find, and delete secrets in AWS Secrets Manager, or generate a random password.',
  auth: {
    kind: 'api-key',
    hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}. Optional "sessionToken" and "endpoint". Requests are signed with AWS Signature V4; the region selects the secretsmanager.<region>.amazonaws.com endpoint.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  credentialPlacement: { kind: 'aws-sigv4', service: 'secretsmanager' },
  baseUrl: {
    metadataKey: 'endpoint',
    fallback: 'https://secretsmanager.{region}.amazonaws.com',
  },
  defaultHeaders: {
    'Content-Type': 'application/x-amz-json-1.1',
  },
  test: {
    method: 'POST',
    path: '/',
    headers: { 'X-Amz-Target': 'secretsmanager.ListSecrets' },
    body: { MaxResults: 1 },
  },
  capabilities: [
    {
      name: 'secrets.get',
      class: 'read',
      description: 'Retrieve the value of a secret by name or ARN.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name or ARN.' },
          versionId: { type: 'string', description: 'Specific version id (optional).' },
          versionStage: {
            type: 'string',
            description: 'Staging label (defaults to AWSCURRENT).',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.GetSecretValue' },
        body: {
          SecretId: '{name}',
          VersionId: '{versionId}',
          VersionStage: '{versionStage}',
        },
      },
    },
    {
      name: 'secrets.find',
      class: 'read',
      description: 'List or filter secrets by name, tag, or description.',
      parameters: {
        type: 'object',
        properties: {
          filterKey: {
            type: 'string',
            description: 'Field to filter by (name, description, tag-key, tag-value, all).',
          },
          filterValue: { type: 'string', description: 'Filter value.' },
          maxResults: { type: 'integer', description: 'Max results (1-100).' },
          sortBy: { type: 'string', description: 'Sort by name or last accessed.' },
          sortOrder: { type: 'string', description: 'asc or desc.' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.ListSecrets' },
        body: {
          MaxResults: '{maxResults}',
          Filters: [{ Key: '{filterKey}', Values: ['{filterValue}'] }],
          SortOrder: '{sortOrder}',
        },
      },
    },
    {
      name: 'secrets.password.random',
      class: 'read',
      description:
        'Generate a random password (does not store it). Used as input to secrets.create / secrets.update.',
      parameters: {
        type: 'object',
        properties: {
          passwordLength: { type: 'integer' },
          excludeCharacters: { type: 'string' },
          excludeNumbers: { type: 'boolean' },
          excludePunctuation: { type: 'boolean' },
          excludeUppercase: { type: 'boolean' },
          excludeLowercase: { type: 'boolean' },
          includeSpace: { type: 'boolean' },
          requireEachIncludedType: { type: 'boolean' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.GetRandomPassword' },
        body: {
          PasswordLength: '{passwordLength}',
          ExcludeCharacters: '{excludeCharacters}',
          ExcludeNumbers: '{excludeNumbers}',
          ExcludePunctuation: '{excludePunctuation}',
          ExcludeUppercase: '{excludeUppercase}',
          ExcludeLowercase: '{excludeLowercase}',
          IncludeSpace: '{includeSpace}',
          RequireEachIncludedType: '{requireEachIncludedType}',
        },
      },
    },
    {
      name: 'secrets.create',
      class: 'mutation',
      description: 'Create a new secret with a name, value, and optional tags.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          secretValue: { type: 'string' },
          description: { type: 'string' },
          tags: {
            type: 'array',
            description: 'List of { Key, Value } tag objects.',
            items: { type: 'object' },
          },
          clientRequestToken: {
            type: 'string',
            description: 'Idempotency token (defaults to invocation idempotency key).',
          },
        },
        required: ['name', 'secretValue'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.CreateSecret' },
        body: {
          Name: '{name}',
          SecretString: '{secretValue}',
          Description: '{description}',
          Tags: '{tags}',
          ClientRequestToken: '{clientRequestToken}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'secrets.update',
      class: 'mutation',
      description: 'Update the value of an existing secret. Creates a new AWSCURRENT version.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name or ARN.' },
          secretValue: { type: 'string' },
          description: { type: 'string' },
          clientRequestToken: { type: 'string' },
        },
        required: ['name', 'secretValue'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.UpdateSecret' },
        body: {
          SecretId: '{name}',
          SecretString: '{secretValue}',
          Description: '{description}',
          ClientRequestToken: '{clientRequestToken}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'secrets.delete',
      class: 'mutation',
      description:
        'Schedule a secret for deletion. Defaults to a 30-day recovery window; pass forceDeleteWithoutRecovery to skip it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          recoveryWindowInDays: {
            type: 'integer',
            description: '7-30. Ignored when forceDeleteWithoutRecovery is true.',
          },
          forceDeleteWithoutRecovery: { type: 'boolean' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.DeleteSecret' },
        body: {
          SecretId: '{name}',
          RecoveryWindowInDays: '{recoveryWindowInDays}',
          ForceDeleteWithoutRecovery: '{forceDeleteWithoutRecovery}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'secrets.rotate',
      class: 'mutation',
      description: 'Trigger immediate rotation of a secret.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name or ARN.' },
          rotationLambdaArn: {
            type: 'string',
            description: 'ARN of the Lambda rotation function (optional if already configured).',
          },
          rotationRules: {
            type: 'object',
            description:
              'Optional RotationRules object (AutomaticallyAfterDays, Duration, ScheduleExpression).',
          },
          rotateImmediately: {
            type: 'boolean',
            description: 'When true, rotates the secret immediately in addition to scheduling.',
          },
          clientRequestToken: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.RotateSecret' },
        body: {
          SecretId: '{name}',
          RotationLambdaARN: '{rotationLambdaArn}',
          RotationRules: '{rotationRules}',
          RotateImmediately: '{rotateImmediately}',
          ClientRequestToken: '{clientRequestToken}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'secrets.restore',
      class: 'mutation',
      description: 'Cancel a scheduled deletion of a secret and reinstate it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name or ARN.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.RestoreSecret' },
        body: { SecretId: '{name}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'secrets.tag',
      class: 'mutation',
      description: 'Attach tags to a secret.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name or ARN.' },
          tags: {
            type: 'array',
            description: 'List of { Key, Value } tag objects to attach.',
            items: { type: 'object' },
          },
        },
        required: ['name', 'tags'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': 'secretsmanager.TagResource' },
        body: {
          SecretId: '{name}',
          Tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
