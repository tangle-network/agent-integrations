import { declarativeRestConnector } from './declarative-rest.js'

export const skyprepConnector = declarativeRestConnector({
  kind: 'skyprep',
  displayName: 'SkyPrep',
  description:
    'SkyPrep is a powerful Learning Management System (LMS) designed to help businesses and organizations deliver effective training and educational content to their employees and users.',
  auth: {
    kind: 'api-key',
    hint: 'SkyPrep API key from your account settings.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.skyprep.com',
  test: { method: 'GET', path: '/v1/users/me' },
  capabilities: [
    {
      name: 'users.enroll.into.course',
      class: 'mutation',
      description: 'Enroll a user into a course.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The ID of the user to enroll' },
          courseId: { type: 'string', description: 'The ID of the course to enroll into' },
          expirationDate: { type: 'string', description: 'Optional enrollment expiration date' },
        },
        required: ['userId', 'courseId'],
      },
      request: {
        method: 'POST',
        path: '/v1/users/{userId}/enrollments/courses',
        body: {
          courseId: '{courseId}',
          expirationDate: '{expirationDate}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'users.enroll.into.group',
      class: 'mutation',
      description: 'Enroll a user into a user group.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The ID of the user to enroll' },
          groupId: { type: 'string', description: 'The ID of the user group to enroll into' },
          expirationDate: { type: 'string', description: 'Optional enrollment expiration date' },
        },
        required: ['userId', 'groupId'],
      },
      request: {
        method: 'POST',
        path: '/v1/users/{userId}/enrollments/groups',
        body: {
          groupId: '{groupId}',
          expirationDate: '{expirationDate}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Update user profile information.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'The ID of the user to update' },
          firstName: { type: 'string', description: 'The first name of the user' },
          lastName: { type: 'string', description: 'The last name of the user' },
          email: { type: 'string', description: 'The email address of the user' },
          role: { type: 'string', description: 'The role of the user' },
          title: { type: 'string', description: 'The title/position of the user' },
          cellPhone: { type: 'string', description: 'The cell phone number of the user' },
          workPhone: { type: 'string', description: 'The work phone number of the user' },
          address: { type: 'string', description: 'The address of the user' },
          cardNo: { type: 'string', description: 'The unique user identifier (student #, badge #)' },
          emailNotifications: { type: 'boolean', description: 'Whether the user receives email notifications' },
          smsNotifications: { type: 'boolean', description: 'Whether the user receives SMS notifications' },
          accessStartDate: { type: 'string', description: 'The date when the user can start accessing content' },
          accessEndDate: { type: 'string', description: 'The date when the user can no longer access content' },
        },
        required: ['userId'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/users/{userId}',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          email: '{email}',
          role: '{role}',
          title: '{title}',
          cellPhone: '{cellPhone}',
          workPhone: '{workPhone}',
          address: '{address}',
          cardNo: '{cardNo}',
          emailNotifications: '{emailNotifications}',
          smsNotifications: '{smsNotifications}',
          accessStartDate: '{accessStartDate}',
          accessEndDate: '{accessEndDate}',
        },
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
