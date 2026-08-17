import { declarativeRestConnector } from './declarative-rest.js'

const target = (operation: string) => `GraniteServiceVersion20100801.${operation}`

export const amazonCloudWatchConnector = declarativeRestConnector({
  kind: 'aws-cloudwatch',
  displayName: 'AWS CloudWatch',
  description:
    'Read and publish CloudWatch metrics, manage metric alarms, and manage dashboards.',
  auth: {
    kind: 'api-key',
    hint: 'AWS credentials as JSON: {"accessKeyId":"AKIA…","secretAccessKey":"…","region":"us-east-1"}. Optional "sessionToken" and "endpoint" support temporary credentials and local AWS-compatible endpoints.',
  },
  category: 'other',
  // Metric publication is eventually consistent and cannot be deduplicated by
  // a caller-provided key. Alarm and dashboard writes use stronger CAS labels.
  defaultConsistencyModel: 'advisory',
  credentialPlacement: { kind: 'aws-sigv4', service: 'monitoring' },
  baseUrl: {
    metadataKey: 'endpoint',
    fallback: 'https://monitoring.{region}.amazonaws.com',
  },
  defaultHeaders: {
    'Content-Type': 'application/x-amz-json-1.0',
  },
  test: {
    method: 'POST',
    path: '/',
    headers: { 'X-Amz-Target': target('ListMetrics') },
    body: {},
  },
  capabilities: [
    {
      name: 'metrics.list',
      class: 'read',
      description: 'List available CloudWatch metrics and their dimensions.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          metricName: { type: 'string' },
          dimensions: { type: 'array', description: 'AWS DimensionFilter objects.' },
          nextToken: { type: 'string' },
          recentlyActive: { type: 'string', enum: ['PT3H'] },
          includeLinkedAccounts: { type: 'boolean' },
          owningAccount: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('ListMetrics') },
        body: {
          Namespace: '{namespace}',
          MetricName: '{metricName}',
          Dimensions: '{dimensions}',
          NextToken: '{nextToken}',
          RecentlyActive: '{recentlyActive}',
          IncludeLinkedAccounts: '{includeLinkedAccounts}',
          OwningAccount: '{owningAccount}',
        },
      },
    },
    {
      name: 'metrics.statistics.get',
      class: 'read',
      description: 'Get statistics for one metric over a time range.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          metricName: { type: 'string' },
          dimensions: { type: 'array', description: 'AWS Dimension objects.' },
          startTime: { type: 'number', description: 'Unix epoch seconds.' },
          endTime: { type: 'number', description: 'Unix epoch seconds.' },
          period: { type: 'integer', description: 'Aggregation period in seconds.' },
          statistics: { type: 'array', items: { type: 'string' } },
          extendedStatistics: { type: 'array', items: { type: 'string' } },
          unit: { type: 'string' },
        },
        required: ['namespace', 'metricName', 'startTime', 'endTime', 'period'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('GetMetricStatistics') },
        body: {
          Namespace: '{namespace}',
          MetricName: '{metricName}',
          Dimensions: '{dimensions}',
          StartTime: '{startTime}',
          EndTime: '{endTime}',
          Period: '{period}',
          Statistics: '{statistics}',
          ExtendedStatistics: '{extendedStatistics}',
          Unit: '{unit}',
        },
      },
    },
    {
      name: 'metrics.data.get',
      class: 'read',
      description: 'Run up to 500 metric-data or metric-math queries in one request.',
      parameters: {
        type: 'object',
        properties: {
          metricDataQueries: { type: 'array', description: 'AWS MetricDataQuery objects.' },
          startTime: { type: 'number', description: 'Unix epoch seconds.' },
          endTime: { type: 'number', description: 'Unix epoch seconds.' },
          nextToken: { type: 'string' },
          scanBy: { type: 'string', enum: ['TimestampDescending', 'TimestampAscending'] },
          maxDatapoints: { type: 'integer' },
          labelOptions: { type: 'object' },
        },
        required: ['metricDataQueries', 'startTime', 'endTime'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('GetMetricData') },
        body: {
          MetricDataQueries: '{metricDataQueries}',
          StartTime: '{startTime}',
          EndTime: '{endTime}',
          NextToken: '{nextToken}',
          ScanBy: '{scanBy}',
          MaxDatapoints: '{maxDatapoints}',
          LabelOptions: '{labelOptions}',
        },
      },
    },
    {
      name: 'alarms.list',
      class: 'read',
      description: 'List metric and composite alarms with optional filters.',
      parameters: {
        type: 'object',
        properties: {
          alarmNames: { type: 'array', items: { type: 'string' } },
          alarmNamePrefix: { type: 'string' },
          alarmTypes: { type: 'array', items: { type: 'string' } },
          childrenOfAlarmName: { type: 'string' },
          parentsOfAlarmName: { type: 'string' },
          stateValue: { type: 'string', enum: ['OK', 'ALARM', 'INSUFFICIENT_DATA'] },
          actionPrefix: { type: 'string' },
          maxRecords: { type: 'integer' },
          nextToken: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('DescribeAlarms') },
        body: {
          AlarmNames: '{alarmNames}',
          AlarmNamePrefix: '{alarmNamePrefix}',
          AlarmTypes: '{alarmTypes}',
          ChildrenOfAlarmName: '{childrenOfAlarmName}',
          ParentsOfAlarmName: '{parentsOfAlarmName}',
          StateValue: '{stateValue}',
          ActionPrefix: '{actionPrefix}',
          MaxRecords: '{maxRecords}',
          NextToken: '{nextToken}',
        },
      },
    },
    {
      name: 'dashboards.list',
      class: 'read',
      description: 'List CloudWatch dashboards in the account.',
      parameters: {
        type: 'object',
        properties: {
          dashboardNamePrefix: { type: 'string' },
          nextToken: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('ListDashboards') },
        body: {
          DashboardNamePrefix: '{dashboardNamePrefix}',
          NextToken: '{nextToken}',
        },
      },
    },
    {
      name: 'dashboards.get',
      class: 'read',
      description: 'Get one CloudWatch dashboard definition.',
      parameters: {
        type: 'object',
        properties: { dashboardName: { type: 'string' } },
        required: ['dashboardName'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('GetDashboard') },
        body: { DashboardName: '{dashboardName}' },
      },
    },
    {
      name: 'metrics.publish',
      class: 'mutation',
      description: 'Publish custom metric data or entity metric data to CloudWatch.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          metricData: { type: 'array', description: 'AWS MetricDatum objects.' },
          entityMetricData: { type: 'array', description: 'AWS EntityMetricData objects.' },
          strictEntityValidation: { type: 'boolean' },
        },
        required: ['namespace'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('PutMetricData') },
        body: {
          Namespace: '{namespace}',
          MetricData: '{metricData}',
          EntityMetricData: '{entityMetricData}',
          StrictEntityValidation: '{strictEntityValidation}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'alarms.put',
      class: 'mutation',
      description: 'Create or fully replace a CloudWatch metric alarm.',
      parameters: {
        type: 'object',
        properties: {
          alarm: {
            type: 'object',
            description: 'AWS PutMetricAlarm input without undeclared transport fields.',
          },
        },
        required: ['alarm'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('PutMetricAlarm') },
        body: '{alarm}',
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'alarms.delete',
      class: 'mutation',
      description: 'Delete up to 100 CloudWatch alarms by name.',
      parameters: {
        type: 'object',
        properties: {
          alarmNames: { type: 'array', items: { type: 'string' } },
        },
        required: ['alarmNames'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('DeleteAlarms') },
        body: { AlarmNames: '{alarmNames}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'dashboards.put',
      class: 'mutation',
      description: 'Create or fully replace a CloudWatch dashboard.',
      parameters: {
        type: 'object',
        properties: {
          dashboardName: { type: 'string' },
          dashboardBody: { type: 'string', description: 'CloudWatch dashboard JSON string.' },
        },
        required: ['dashboardName', 'dashboardBody'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('PutDashboard') },
        body: {
          DashboardName: '{dashboardName}',
          DashboardBody: '{dashboardBody}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'dashboards.delete',
      class: 'mutation',
      description: 'Delete up to 100 CloudWatch dashboards by name.',
      parameters: {
        type: 'object',
        properties: {
          dashboardNames: { type: 'array', items: { type: 'string' } },
        },
        required: ['dashboardNames'],
      },
      request: {
        method: 'POST',
        path: '/',
        headers: { 'X-Amz-Target': target('DeleteDashboards') },
        body: { DashboardNames: '{dashboardNames}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
