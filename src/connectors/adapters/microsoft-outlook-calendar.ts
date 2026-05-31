import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Outlook Calendar connector backed by Microsoft Graph v1.0.
 *
 * Manages events on the signed-in user's primary calendar (and any explicit
 * calendarId the caller supplies). Authentication uses the Microsoft identity
 * platform v2.0 OAuth endpoints; the `common` tenant lets a single app
 * registration serve any work, school, or personal account.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/event?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/api/user-list-events?view=graph-rest-1.0
 *   - https://learn.microsoft.com/graph/permissions-reference#calendars-permissions
 */
export const microsoftOutlookCalendarConnector = declarativeRestConnector({
  kind: 'microsoft-outlook-calendar',
  displayName: 'Microsoft Outlook Calendar',
  description: 'Create, list, and delete Outlook/Microsoft 365 calendar events via Microsoft Graph.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Calendars.ReadWrite', 'User.Read'],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'create.event',
      class: 'mutation',
      description:
        "Create a calendar event on the signed-in user's primary calendar, or on a specific calendarId when supplied.",
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'object' },
          start: { type: 'object' },
          end: { type: 'object' },
          location: { type: 'object' },
          attendees: { type: 'array', items: { type: 'object' } },
          isOnlineMeeting: { type: 'boolean' },
          onlineMeetingProvider: { type: 'string' },
          showAs: { type: 'string' },
          sensitivity: { type: 'string' },
          importance: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          reminderMinutesBeforeStart: { type: 'integer' },
          isAllDay: { type: 'boolean' },
          recurrence: { type: 'object' },
          transactionId: { type: 'string' },
        },
        required: ['subject', 'start', 'end'],
      },
      request: {
        method: 'POST',
        path: '/me/calendars/{calendarId}/events',
        body: {
          subject: '{subject}',
          body: '{body}',
          start: '{start}',
          end: '{end}',
          location: '{location}',
          attendees: '{attendees}',
          isOnlineMeeting: '{isOnlineMeeting}',
          onlineMeetingProvider: '{onlineMeetingProvider}',
          showAs: '{showAs}',
          sensitivity: '{sensitivity}',
          importance: '{importance}',
          categories: '{categories}',
          reminderMinutesBeforeStart: '{reminderMinutesBeforeStart}',
          isAllDay: '{isAllDay}',
          recurrence: '{recurrence}',
          transactionId: '{transactionId}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Calendars.ReadWrite'],
    },
    {
      name: 'delete.event',
      class: 'mutation',
      description: 'Delete a calendar event by id from the signed-in user mailbox.',
      parameters: {
        type: 'object',
        properties: { eventId: { type: 'string' } },
        required: ['eventId'],
      },
      request: { method: 'DELETE', path: '/me/events/{eventId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Calendars.ReadWrite'],
    },
    {
      name: 'list.events',
      class: 'read',
      description:
        "List events on a calendar with OData paging/filtering ($top, $skip, $filter, $select, $orderby, $search). Targets the user's primary calendar unless calendarId is supplied.",
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          $top: { type: 'integer' },
          $skip: { type: 'integer' },
          $filter: { type: 'string' },
          $select: { type: 'string' },
          $orderby: { type: 'string' },
          $search: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/calendars/{calendarId}/events',
        query: {
          $top: '{$top}',
          $skip: '{$skip}',
          $filter: '{$filter}',
          $select: '{$select}',
          $orderby: '{$orderby}',
          $search: '{$search}',
        },
      },
      requiredScopes: ['Calendars.ReadWrite'],
    },
  ],
})
