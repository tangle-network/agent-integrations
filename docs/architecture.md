# Agent Integrations Architecture

## Non-Goals

- Do not become a full Zapier clone in the SDK.
- Do not require one OAuth broker or workflow vendor.
- Do not expose provider tokens to sandboxes or agents.
- Do not make product repos hand-roll Gmail/Slack/calendar semantics.

## Package Responsibilities

`agent-integrations` owns:

- stable connector, connection, action, trigger, and capability contracts
- provider adapter interface
- connection store interface
- sandbox-safe capability token minting and verification
- invocation policy enforcement
- event normalization
- redaction helpers

Provider-specific services own:

- OAuth client registration
- provider token vaulting
- refresh-token rotation
- webhook subscription lifecycle
- vendor-specific action mapping
- provider rate limits and retries

Product apps own:

- UI for connect/install/approve flows
- tenant/user ownership policy
- which connectors are enabled
- human approval before sensitive writes
- audit log persistence

## Launch Bar

- A generated app can declare required connectors.
- Builder can ask the user to connect missing accounts.
- A sandbox can receive a short-lived capability for one user-owned connection.
- Agents can invoke only actions allowed by that capability.
- Triggers can wake or enqueue sandbox workflows without exposing credentials.
- Audit logs can show what happened without leaking secrets.
