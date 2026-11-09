# API Keys

An API key lets a script, a home automation, or another tool call the BookOrbit API without a password. Each key belongs to one person, can do at most what that person can do, and can be narrowed further: read only, a smaller set of permissions, or a few libraries.

## Who can create keys

Creating a key needs the **Create API keys** permission (`api_keys`). People with it manage their own keys under **Settings > You > API keys**. Administrators with **Manage users** can see, issue, and revoke keys for someone else from that person's page under **Settings > Users**.

A key stops working as soon as its owner loses the `api_keys` permission, is suspended, or is deleted. Restoring the permission or the account brings the key back, unless it was revoked or expired in the meantime.

## Using a key

A key is shown once, when it is created or regenerated. It starts with `bok_` and is 53 characters long. BookOrbit stores only a hash of it, so a lost key cannot be recovered; regenerate it instead.

Send the key in either header on any `/api/v1` request:

```bash
curl -H "Authorization: Bearer $BOOKORBIT_API_KEY" https://books.example.com/api/v1/auth/me
```

```bash
curl -H "X-Api-Key: $BOOKORBIT_API_KEY" https://books.example.com/api/v1/auth/me
```

- A key in the query string is ignored, so it never ends up in proxy logs or browser history.
- A request that carries two different credentials, such as a key in `X-Api-Key` and a session token in `Authorization`, is refused with `401`.
- `GET /api/v1/auth/me` reports `authenticationMethod: "api_key"` and the permissions the key actually has, which is a quick way to check what a key can do.
- Socket.IO connections accept a key as `auth.token` in the handshake, the same place a session token goes.

## What a key can do

Every key is created with these settings. Only the name can be changed afterwards; regenerating a key replaces its secret and keeps everything else.

| Setting       | Choices                                            | Default |
| ------------- | -------------------------------------------------- | ------- |
| Access        | **Read** or **Read and write**                     | Read    |
| Permissions   | Any of the owner's permissions that a key may hold | None    |
| Libraries     | All the owner's libraries, or only some of them    | All     |
| Expires       | 30, 90, or 365 days, or never                      | 90 days |
| Administrator | Superuser access, offered only to superusers       | Off     |

**Read** keys may use `GET` routes and the few `POST` routes that only search or count, such as library and collection book queries. Anything else answers `403` with `API_KEY_READ_ONLY`.

**Permissions** narrow a key to less than its owner. A key with no permissions can still read the owner's libraries and personal data, but not use features that need a permission, such as downloading books or editing metadata. A key can never hold a permission its owner does not have, and never the `api_keys` permission itself.

**Libraries** limit a key to the chosen libraries. Everything that lists, searches, or opens books respects that limit, as it does for the owner's own library access.

**Administrator** gives the key the owner's superuser access. It is the only way a key gets superuser power, and it cannot be combined with a library limit. A superuser's key without it behaves like a regular user's key.

Keys survive password changes and signing out of other sessions. Revoke a key to stop it.

## Routes a key cannot use

Some routes are for a person at the keyboard and refuse every key with `403` and `API_KEY_ROUTE_FORBIDDEN`:

- creating, listing, renaming, regenerating, and revoking API keys, including an administrator's view of someone else's keys;
- changing a password, listing or ending sessions, and editing one's own profile;
- changing another person's permissions or superuser status, or resetting their password;
- App Attest registration and every route that requires an App Attest assertion from the iOS or Android app.

Sign-in, registration, and the other public routes do not need a credential, and a key adds nothing to them.

## Limits

- A person can have at most **25** active keys. Creating another answers `409` with `API_KEY_LIMIT_REACHED`.
- An address that presents more than 30 unknown or invalid keys within a minute gets `429` for the rest of that minute.
- The last-used time and address are recorded at most once a minute per key.
- Revoked and expired keys stay visible for 90 days, then they are removed.

## Server settings

Administrators with **Manage app settings** control keys for the whole server under **Settings > Admin > API keys**:

- **Allow API keys** turns every key off or back on without revoking any. While off, requests with a key answer `401` with `API_KEYS_DISABLED`, and no new keys can be created.
- **Maximum key lifetime** caps how long a new or regenerated key may last. A cap hides the choices that exceed it, including "never". Existing keys keep their expiry until they are regenerated.

## API reference

With `SWAGGER_ENABLED=true`, the server publishes its OpenAPI reference at `/api/docs` (JSON at `/api/docs-json`). It declares both ways to send a key: the `bearer` scheme and the `api-key` scheme for `X-Api-Key`. Operations that refuse every key are marked with `x-api-key: interactive`, and the few `POST` operations a read key may call carry `x-api-key-read-safe: true`.

## Keeping keys safe

- Give each script or service its own key, so one can be revoked without breaking the others.
- Grant the least a key needs: read access, no permissions, and only the libraries it works on.
- Keep keys in environment variables or a secret store, never in source code, URLs, or shared chat.
- Prefer an expiry, and regenerate keys on a schedule. A regenerated key stops the old one at once.
- Check **Last used** in the key list now and then, and revoke keys that are no longer used.

## Audit log

Creating, renaming, regenerating, and revoking keys appear in the audit log. Every other action a key performs is recorded under the key's owner, with the key's name shown beside it, so a key's activity can be told apart from the owner's own.

## Error codes

Errors carry an `errorCode` in the response body so clients can react without matching messages.

| Code                           | Status    | Meaning                                                                                   |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------- |
| `API_KEYS_DISABLED`            | 401 / 403 | Keys are turned off on this server.                                                       |
| `API_KEY_READ_ONLY`            | 403       | A read key tried to change something.                                                     |
| `API_KEY_ROUTE_FORBIDDEN`      | 403       | The route refuses every key.                                                              |
| `API_KEY_LIMIT_REACHED`        | 409       | The owner already has 25 active keys.                                                     |
| `API_KEY_SCOPE_EXCEEDS_OWNER`  | 400       | The key asked for a permission, library, or administrator access the owner does not have. |
| `API_KEY_EXPIRY_EXCEEDS_CAP`   | 400       | The expiry is longer than the server allows. `errorMeta.cap` holds the limit in days.     |
| `API_KEY_ADMIN_WITH_LIBRARIES` | 400       | Administrator access cannot be combined with a library limit.                             |
| `API_KEY_OWNER_NOT_PERMITTED`  | 400       | The owner is suspended or lacks the `api_keys` permission.                                |

An unknown, expired, revoked, or malformed key answers `401` without a code.
