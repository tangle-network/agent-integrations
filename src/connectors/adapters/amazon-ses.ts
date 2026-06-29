import { declarativeRestConnector } from './declarative-rest.js'

const emailAddressList = {
  type: 'array',
  items: { type: 'string' },
}

const messageTag = {
  type: 'object',
  properties: {
    Name: { type: 'string' },
    Value: { type: 'string' },
  },
  required: ['Name', 'Value'],
}

export const amazonSesConnector = declarativeRestConnector({
  kind: 'amazon-ses',
  displayName: 'Amazon SES',
  description: 'Send transactional and templated email and manage SES email templates via the Amazon SES v2 REST API.',
  auth: {
    kind: 'api-key',
    hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"} (the key needs ses:SendEmail / ses:SendTemplatedEmail / template-management permissions). Optional "sessionToken" and "endpoint". Requests are signed with AWS Signature V4; the region selects the email.<region>.amazonaws.com (SES v2) endpoint.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  // SES v2 REST API: the SigV4 signing name is `ses`, but the regional host is
  // the `email.` subdomain. metadata.endpoint still overrides when a tenant
  // pins a host.
  credentialPlacement: { kind: 'aws-sigv4', service: 'ses' },
  baseUrl: { metadataKey: 'endpoint', fallback: 'https://email.{region}.amazonaws.com' },
  test: { method: 'GET', path: '/v2/email/identities' },
  capabilities: [
    {
      name: 'send.email',
      class: 'mutation',
      description: 'Send a transactional email via SES SendEmail (simple content).',
      parameters: {
        type: 'object',
        properties: {
          fromEmailAddress: { type: 'string' },
          toAddresses: emailAddressList,
          ccAddresses: emailAddressList,
          bccAddresses: emailAddressList,
          replyToAddresses: emailAddressList,
          subject: { type: 'string' },
          htmlBody: { type: 'string' },
          textBody: { type: 'string' },
          returnPath: { type: 'string' },
          configurationSetName: { type: 'string' },
          emailTags: { type: 'array', items: messageTag },
          sourceArn: { type: 'string' },
          returnPathArn: { type: 'string' },
        },
        required: ['fromEmailAddress', 'toAddresses', 'subject'],
      },
      request: {
        method: 'POST',
        path: '/v2/email/outbound-emails',
        body: {
          FromEmailAddress: '{fromEmailAddress}',
          Destination: {
            ToAddresses: '{toAddresses}',
            CcAddresses: '{ccAddresses}',
            BccAddresses: '{bccAddresses}',
          },
          ReplyToAddresses: '{replyToAddresses}',
          FeedbackForwardingEmailAddress: '{returnPath}',
          Content: {
            Simple: {
              Subject: { Data: '{subject}' },
              Body: {
                Html: { Data: '{htmlBody}' },
                Text: { Data: '{textBody}' },
              },
            },
          },
          EmailTags: '{emailTags}',
          ConfigurationSetName: '{configurationSetName}',
          FromEmailAddressIdentityArn: '{sourceArn}',
          FeedbackForwardingEmailAddressIdentityArn: '{returnPathArn}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'send.templated.email',
      class: 'mutation',
      description: 'Send an email rendered from an SES email template with merge data.',
      parameters: {
        type: 'object',
        properties: {
          fromEmailAddress: { type: 'string' },
          toAddresses: emailAddressList,
          ccAddresses: emailAddressList,
          bccAddresses: emailAddressList,
          replyToAddresses: emailAddressList,
          templateName: { type: 'string' },
          templateData: { type: 'object' },
          configurationSetName: { type: 'string' },
          emailTags: { type: 'array', items: messageTag },
          sourceArn: { type: 'string' },
          returnPathArn: { type: 'string' },
        },
        required: ['fromEmailAddress', 'toAddresses', 'templateName', 'templateData'],
      },
      request: {
        method: 'POST',
        path: '/v2/email/outbound-emails',
        body: {
          FromEmailAddress: '{fromEmailAddress}',
          Destination: {
            ToAddresses: '{toAddresses}',
            CcAddresses: '{ccAddresses}',
            BccAddresses: '{bccAddresses}',
          },
          ReplyToAddresses: '{replyToAddresses}',
          Content: {
            Template: {
              TemplateName: '{templateName}',
              TemplateData: '{templateData}',
            },
          },
          EmailTags: '{emailTags}',
          ConfigurationSetName: '{configurationSetName}',
          FromEmailAddressIdentityArn: '{sourceArn}',
          FeedbackForwardingEmailAddressIdentityArn: '{returnPathArn}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'create.email.template',
      class: 'mutation',
      description: 'Create a reusable SES email template (subject + HTML + text parts).',
      parameters: {
        type: 'object',
        properties: {
          templateName: { type: 'string' },
          subjectPart: { type: 'string' },
          htmlPart: { type: 'string' },
          textPart: { type: 'string' },
        },
        required: ['templateName', 'subjectPart'],
      },
      request: {
        method: 'POST',
        path: '/v2/email/templates',
        body: {
          TemplateName: '{templateName}',
          TemplateContent: {
            Subject: '{subjectPart}',
            Html: '{htmlPart}',
            Text: '{textPart}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update.email.template',
      class: 'mutation',
      description: 'Update an existing SES email template by name.',
      parameters: {
        type: 'object',
        properties: {
          templateName: { type: 'string' },
          subjectPart: { type: 'string' },
          htmlPart: { type: 'string' },
          textPart: { type: 'string' },
        },
        required: ['templateName', 'subjectPart'],
      },
      request: {
        method: 'PUT',
        path: '/v2/email/templates/{templateName}',
        body: {
          TemplateContent: {
            Subject: '{subjectPart}',
            Html: '{htmlPart}',
            Text: '{textPart}',
          },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'create.custom.verification.email.template',
      class: 'mutation',
      description: 'Create a custom verification email template used by SendCustomVerificationEmail.',
      parameters: {
        type: 'object',
        properties: {
          templateName: { type: 'string' },
          fromEmailAddress: { type: 'string' },
          templateSubject: { type: 'string' },
          templateContent: { type: 'string' },
          successRedirectionURL: { type: 'string' },
          failureRedirectionURL: { type: 'string' },
        },
        required: [
          'templateName',
          'fromEmailAddress',
          'templateSubject',
          'templateContent',
          'successRedirectionURL',
          'failureRedirectionURL',
        ],
      },
      request: {
        method: 'POST',
        path: '/v2/email/custom-verification-email-templates',
        body: {
          TemplateName: '{templateName}',
          FromEmailAddress: '{fromEmailAddress}',
          TemplateSubject: '{templateSubject}',
          TemplateContent: '{templateContent}',
          SuccessRedirectionURL: '{successRedirectionURL}',
          FailureRedirectionURL: '{failureRedirectionURL}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update.custom.verification.email.template',
      class: 'mutation',
      description: 'Update a custom verification email template by name.',
      parameters: {
        type: 'object',
        properties: {
          templateName: { type: 'string' },
          fromEmailAddress: { type: 'string' },
          templateSubject: { type: 'string' },
          templateContent: { type: 'string' },
          successRedirectionURL: { type: 'string' },
          failureRedirectionURL: { type: 'string' },
        },
        required: [
          'templateName',
          'fromEmailAddress',
          'templateSubject',
          'templateContent',
          'successRedirectionURL',
          'failureRedirectionURL',
        ],
      },
      request: {
        method: 'PUT',
        path: '/v2/email/custom-verification-email-templates/{templateName}',
        body: {
          FromEmailAddress: '{fromEmailAddress}',
          TemplateSubject: '{templateSubject}',
          TemplateContent: '{templateContent}',
          SuccessRedirectionURL: '{successRedirectionURL}',
          FailureRedirectionURL: '{failureRedirectionURL}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'send.custom.verification.email',
      class: 'mutation',
      description: 'Send a custom verification email to an address using a previously created template.',
      parameters: {
        type: 'object',
        properties: {
          emailAddress: { type: 'string' },
          templateName: { type: 'string' },
          configurationSetName: { type: 'string' },
        },
        required: ['emailAddress', 'templateName'],
      },
      request: {
        method: 'POST',
        path: '/v2/email/outbound-custom-verification-emails',
        body: {
          EmailAddress: '{emailAddress}',
          TemplateName: '{templateName}',
          ConfigurationSetName: '{configurationSetName}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
