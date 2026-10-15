# Server connection identity

The iOS client supports several user-entered connection addresses for one
BookOrbit installation. `GET /api/v1/server-identity` is public and returns only
`product: "bookorbit"`, `protocolVersion: 1`, and a persisted UUID `instanceId`.
It sends `Cache-Control: no-store`. The authenticated `/api/v1/app-info` response
adds the same optional `instanceId` and advertises `server-connection-identity`.
Existing routes and request bodies are unchanged. Released clients ignore the
additional fields. New clients keep single-address behavior on older servers.
The iOS client consumes this route even though the web client does not call it.

The singleton `server_identity` row is generated on first use and shared by all
replicas through PostgreSQL. Keep it in database backups. Application restart,
container replacement, DNS changes, and reverse-proxy aliases preserve it.
Multiple addresses must reach the same database and installation.

The UUID detects accidental connection to another installation through an
alternative address. It is public and is not a replacement for TLS certificate
validation. Clients never send account credentials when probing an alternative
and never bypass TLS trust. The address a user signed in with keeps the trust
released clients gave it, including following its redirects. An alternative is
used only after it answers with the enrolled UUID, and its redirects must stay on
its host. Users who explicitly choose HTTP retain that transport's existing trust
limits. If the identity row cannot be read, `/app-info` still answers and omits
`instanceId`.

A restored database belonging to the same installation keeps its UUID. When the
UUID changes (an independent clone, a fresh database, or a backup taken before
this table existed), clients keep using the address they signed in with, adopt
the new UUID from the authenticated `/app-info` response, and ask the user to
verify each alternative again. For an independent clone, stop every application
replica, remove only the singleton `server_identity` row through an
administrative database session, and restart. The next request creates a fresh
UUID. Never regenerate the row while live replicas hold a cached identity.

Regression coverage is available through `pnpm e2e:run -- server-connection-identity`.
