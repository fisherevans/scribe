# OIDC auth (`SCRIBE_AUTH_MODE=oidc`)

scribe can authenticate users directly against any OpenID Connect provider. In
this mode scribe is a confidential OIDC client: it owns the login redirect, the
callback, the session, and token refresh - no reverse-proxy auth gate required.
This doc is the reference for wiring it up; it's deliberately generic (works with
Authelia, Keycloak, Zitadel, Auth0, Dex, Google, etc.), with an Authelia example
at the end.

## What it does

- Runs **Authorization Code + PKCE (S256)** with `state` + `nonce`.
- Verifies the ID token, then keeps a **server-side session** keyed by a
  `Secure; HttpOnly; SameSite=Lax` cookie (`scribe_session`). Sessions persist
  to a **SQLite** file by default (so a restart doesn't log everyone out); set
  `SCRIBE_SESSION_DB=memory` for in-memory instead.
- **Refreshes** the access token transparently via the refresh token
  (`offline_access`) for the life of the session, so users aren't bounced when
  the access token's short TTL expires.
- **Challenges** unauthenticated requests by content type: browser navigations
  (Accept: text/html) get a 302 to the IdP; API/XHR calls get `401`.
- Optionally restricts login to members of one or more **groups**.

Health (`GET /api/health`) is always open so liveness/uptime probes work.

## Config

All flags have `SCRIBE_*` env equivalents.

| Env | Required | Default | Notes |
|---|---|---|---|
| `SCRIBE_AUTH_MODE` | yes | `none` | set to `oidc` |
| `SCRIBE_OIDC_ISSUER` | yes | | issuer URL; scribe fetches `<issuer>/.well-known/openid-configuration` |
| `SCRIBE_OIDC_CLIENT_ID` | yes | | the client id registered with your IdP |
| `SCRIBE_OIDC_CLIENT_SECRET` | yes | | the client secret (confidential client) |
| `SCRIBE_OIDC_REDIRECT_URL` | yes | | must be `https://<your-host>/auth/callback` and registered as a redirect URI on the client |
| `SCRIBE_SESSION_SECRET` | yes | | random ≥32-char string; HMAC key for the short-lived login-flow cookie |
| `SCRIBE_OIDC_SCOPES` | no | `openid profile email groups offline_access` | space-separated; keep `offline_access` for refresh |
| `SCRIBE_OIDC_ALLOWED_GROUPS` | no | (any) | comma-separated; if set, the user's `groups` claim must intersect, else `403` |
| `SCRIBE_SESSION_DB` | no | `<data>/auth-sessions.db` | SQLite path persisting sessions across restarts. Set to `memory` to keep sessions in-process (lost on restart). Put it on durable storage (a mounted volume) to actually survive restarts. |

## Routes scribe adds

| Route | Purpose |
|---|---|
| `GET /auth/login` | start the flow (redirects to the IdP); honors `?rd=<local path>` for post-login return |
| `GET /auth/callback` | the OAuth2 redirect URI; exchanges the code, sets the session |
| `GET /auth/logout` | clears the session; RP-initiated logout at the IdP if it advertises `end_session_endpoint` |
| `GET /api/me` | `{authenticated, mode, identity{subject,email,name,groups}}` for the UI |

## Registering the client (any IdP)

Create a **confidential** client with:

- Grant types: `authorization_code`, `refresh_token`
- Response types: `code`
- Redirect URI: `https://<your-host>/auth/callback`
- Scopes: `openid profile email groups offline_access`
- PKCE: required, method `S256`
- Token endpoint auth: `client_secret_basic`

Hand the client id + secret to scribe via the env vars above.

## Notes / gotchas

- **Groups claim.** Group restriction reads `groups` from the ID token, falling
  back to the UserInfo endpoint when the IdP doesn't put groups in the ID token.
  If `SCRIBE_OIDC_ALLOWED_GROUPS` never matches, check your IdP actually emits a
  `groups` claim for the `groups` scope (some need an explicit claims/scope
  mapping).
- **Sessions persist to SQLite by default** (`<data>/auth-sessions.db`), so a
  restart keeps everyone logged in - put the data dir on durable storage. Use
  `SCRIBE_SESSION_DB=memory` to opt out. The SQLite store is single-writer; for
  >1 replica you'd want a shared backend (the store is behind an interface).
- **HTTPS.** Cookies are marked `Secure` when `SCRIBE_OIDC_REDIRECT_URL` is
  `https://...`. For local http testing, the cookie won't be sent over http -
  use `none` mode for local dev, or terminate TLS in front.
- **Behind a proxy?** Don't also gate scribe with a forward-auth proxy in `oidc`
  mode - scribe does its own redirect, and a proxy gate in front would
  double-redirect. Point the proxy straight at scribe.

## Authelia example

Client entry in Authelia's `identity_providers.oidc.clients`:

```yaml
- client_id: 'scribe'
  client_name: 'Scribe'
  client_secret: '$pbkdf2-sha512$...'   # hash of the generated secret
  public: false
  authorization_policy: 'one_factor'
  redirect_uris:
    - 'https://scribe.example.com/auth/callback'
  scopes: ['openid', 'profile', 'email', 'groups', 'offline_access']
  grant_types: ['authorization_code', 'refresh_token']
  response_types: ['code']
  token_endpoint_auth_method: 'client_secret_basic'
  require_pkce: true
  pkce_challenge_method: 'S256'
```

scribe env:

```sh
SCRIBE_AUTH_MODE=oidc
SCRIBE_OIDC_ISSUER=https://auth.example.com
SCRIBE_OIDC_CLIENT_ID=scribe
SCRIBE_OIDC_CLIENT_SECRET=<plaintext secret>
SCRIBE_OIDC_REDIRECT_URL=https://scribe.example.com/auth/callback
SCRIBE_OIDC_ALLOWED_GROUPS=admin     # optional
SCRIBE_SESSION_SECRET=<random string>
```
