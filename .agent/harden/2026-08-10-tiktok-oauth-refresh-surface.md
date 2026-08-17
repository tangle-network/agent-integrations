# Adversarial Surface — OAuth Refresh and Public Clients

| Boundary | Invariant | Attack |
| --- | --- | --- |
| OAuth start and callback | The hub owns state, owner, metadata, and PKCE verifier | Replace caller fields during callback |
| PKCE posture | Omission requires exact provider opt-out | Omit or downgrade an unknown posture |
| Expired credential resolution | One rotating refresh token is redeemed once per process and store | Start two actions before the token endpoint responds |
| Secret persistence | No action receives rotated credentials before durable storage | Block the secret write after refresh |
| Refresh failure | All waiters fail and a later retry can start | Reject one shared refresh and retry |
| Revocation | Deleted credentials and revoked rows never return | Revoke during token, secret, and connection writes |
| Error handling | Credentials do not reach errors or unhandled rejection events | Reject transport and persistence immediately |
| Public-client exchange | A public client sends its ID without a secret or Basic authorization | Supply a secret and assert it never leaves the process |
| Confidential-client exchange | Missing secrets fail before network access | Omit the secret for both supported confidential methods |
| Cal.com refresh isolation | One connection cannot receive another connection's rotated token | Refresh two source IDs concurrently through one adapter instance |
| Cal.com refresh persistence | An action does not continue before rotated credentials persist | Delay the host callback and observe action completion |
