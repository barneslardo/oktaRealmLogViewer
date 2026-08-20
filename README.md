# Okta Realm Log Viewer

A web app that surfaces Okta System Log events, scoped per Okta **realm**, to the
right admins. Global (org-level) admins see everything with a realm selector;
realm-specific admins are hard-locked to their own realm's telemetry.

- **Backend:** Node.js + Express
- **Frontend:** React (Vite), served as a static build by the backend
- **Auth:** OIDC Authorization Code + PKCE, client authenticated with `private_key_jwt`
- **Deployment:** single process on **port 4000**, behind `zach.skylarbarnes.com`

---

## How authorization works (read this first)

The single most important architectural fact:

> **Access control is resolved entirely server-side via the Okta API token.
> It does NOT come from OIDC token claims or scopes.**

The OIDC login only proves *who* the user is (their `sub`). Immediately after
login, the backend calls the Okta API to look up that user and decide what they
can see. Because of this, **no custom scopes or custom claims are needed** on the
authorization server.

### Access model

Driven by the authoritative top-level `realmId` on the Okta user object
(`resolveUserAccess()` in `backend/src/lib/okta.js`):

| User's realm | Condition | Result |
|---|---|---|
| A specific (non-default) realm | always | **Realm admin** — locked to that realm, no realm selector. Overrides any global-group membership. |
| Default Realm | has `SUPER_ADMIN` / `ORG_ADMIN` role | **Global admin** — all realms, with realm dropdown |
| Default Realm | in a `GLOBAL_ADMIN_GROUPS` group | **Global admin** |
| Default Realm | neither | **No access** |

A realm member can *never* see another realm's logs, even if they're also placed
in a global admin group — realm membership wins.

### Log filtering

Realm scoping is applied by resolving the realm's member **user IDs**
(`realmId eq "<id>"` search), then filtering the System Log API by
`actor.id` / `target.id` for those users (plus the realm ID itself for
realm-management events). Filtering on `target.id eq "<realmId>"` alone does
**not** work — it only matches a handful of realm-admin events, not user activity.

The realm→members lookup is cached server-side for 5 minutes. Log data itself is
always fetched live.

---

## The custom authorization server (important)

This app **must** use a dedicated custom authorization server, not the default one.

- **Current issuer:** `https://demo-vita-oig.oktapreview.com/oauth2/auszidmvwkW4OtHXS1d7`
  ("Realm Reporting Tool")
- **Why:** Okta's *default* authorization server in this tenant had **zero access
  policies**, so it could not issue tokens for this client — sign-in failed with
  Okta's hosted *"You are not allowed to access this app"* / *"Policy evaluation
  failed"* pages even though the app, group, and redirect URIs were all correct.
- The custom auth server has its own access policy allowing assigned users to
  authenticate, and it advertises `private_key_jwt` support.

Set `OKTA_ISSUER` to the **custom** auth server's issuer URL, never `/oauth2/default`.

### `private_key_jwt` `aud` gotcha

`openid-client` v5 defaults the `client_assertion` JWT's `aud` to the *issuer*
URL, but Okta requires it to be the exact **token endpoint** URL. The callback
overrides this via `clientAssertionPayload.aud` — see `backend/src/routes/auth.js`.
Don't remove it or token exchange fails with
`invalid_client (The audience claim for client_assertion must be the endpoint invoked for the request.)`.

---

## Prerequisites

- Node.js 18+ (built/tested on v22)
- An Okta tenant with:
  - An OIDC web app configured for `private_key_jwt`
  - A **custom authorization server** with an access policy (see above)
  - System Log API access via an SSWS API token
  - The RSA key pair whose public key is registered on the app

---

## Setup

```bash
# 1. Install dependencies
cd backend  && npm install
cd ../frontend && npm install

# 2. Build the React frontend (output served by the backend)
npm run build          # from frontend/

# 3. Configure environment
cp backend/.env.example backend/.env
chmod 600 backend/.env
#   ...fill in the values (see Configuration below)

# 4. Run
cd backend && npm start        # or use the systemd unit below
```

A helper `setup.sh` is included that parses a credentials file
(`okta-credentials.txt`, or set `OKTA_CREDENTIALS=/path/to/file`; it is
gitignored because it holds your private key and API token), generates a
session secret, installs deps, and builds the frontend.

---

## Configuration (`backend/.env`)

| Variable | Description |
|---|---|
| `OKTA_TENANT` | Base tenant URL, e.g. `https://demo-vita-oig.oktapreview.com` |
| `OKTA_ISSUER` | **Custom** auth server issuer URL (NOT `/oauth2/default`) |
| `OKTA_CLIENT_ID` | OIDC app client ID |
| `OKTA_REDIRECT_URI` | `https://<domain>/auth/callback` |
| `OKTA_POST_LOGOUT_URI` | `https://<domain>` |
| `OKTA_PRIVATE_KEY_JWK` | Private key, single-line JWK JSON (pairs with the public key registered on the app) |
| `OKTA_API_TOKEN` | SSWS token for the System Log + Users/Realms APIs |
| `OKTA_REALM_ID` | Default/primary realm ID (legacy; resolution is now per-user) |
| `GLOBAL_ADMIN_GROUPS` | Comma-separated group IDs (or names) granting global access to Default Realm users |
| `SESSION_SECRET` | 32-byte hex, `openssl rand -hex 32`. Rotating it invalidates all sessions. |
| `PORT` | Default `4000` |
| `NODE_ENV` | `production` in deployment |

> **Note:** `.env` contains live secrets (private key + API token). It is
> `chmod 600` and must never be committed. The SSWS API token can expire — if log
> pulls or logins suddenly fail later, check the token first.

---

## Running as a service

A systemd unit **template** is provided. `setup.sh` renders it for the invoking
user and install path as `okta-realm-logs.service.local` (the tracked file keeps
`__RUN_USER__` / `__APP_DIR__` placeholders, so it carries no host-specific paths):

```bash
sudo cp okta-realm-logs.service.local /etc/systemd/system/okta-realm-logs.service
sudo systemctl daemon-reload
sudo systemctl enable --now okta-realm-logs
sudo systemctl status okta-realm-logs
journalctl -u okta-realm-logs -f      # tail logs
```

The service reads `backend/.env` and runs `node src/server.js` on port 4000.
Point your reverse proxy / DNS (`zach.skylarbarnes.com`) at port 4000.

---

## HTTP endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/auth/login` | — | Start OIDC login (redirects to Okta) |
| GET | `/auth/callback` | — | OIDC redirect URI; exchanges code, builds session |
| GET | `/auth/logout` | — | End session + Okta logout |
| GET | `/auth/me` | session | Current user + resolved access (role, realms, labels) |
| GET | `/api/logs` | session | Realm-scoped System Log events (newest first) |
| GET | `/api/logs/event-types` | session | Distinct event types in scope (for the filter UI) |
| GET | `/api/health` | — | Liveness check |

`/api/logs` query params: `since`, `until`, `q`, `eventType`, `limit`, `after`
(cursor), and `realmId` (global admins only, to scope to one realm). Results are
returned `DESCENDING` (most recent first); `nextCursor` drives "Load more".

---

## Okta configuration checklist

When standing this up against a tenant, all of the following must be true:

1. **OIDC app** with `token_endpoint_auth_method: private_key_jwt`, grant types
   `authorization_code` + `refresh_token`, response type `code`.
2. **Public key registered** on the app (JWKS), matching `OKTA_PRIVATE_KEY_JWK`.
3. **Redirect URIs** include the prod callback and (for dev) `http://localhost:4000/auth/callback`.
4. **An app authentication policy** is assigned. Every OIE app needs one or login
   fails with *"Policy evaluation failed."*
5. **A custom authorization server** with an access policy allowing assigned users.
6. **Users/groups assigned** to the app. Group membership is what the access model
   reads; direct user assignment lets a user log in but won't grant realm/global
   scope on its own.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| *"Policy evaluation failed"* before callback | App has no authentication policy, or the auth server has no access policy. |
| *"You are not allowed to access this app"* (Okta page) after MFA | User/group not assigned to the app, or default auth server has no access policies — use the custom one. |
| `invalid_client … audience claim for client_assertion` | The `clientAssertionPayload.aud` override is missing/wrong (see above). |
| Infinite 302 redirect loop after login | Session cookie exceeded 4KB. Don't store realm labels / tokens in the session; they're fetched on demand in `/auth/me`. |
| User sees the wrong scope (e.g. global instead of realm) after a logic change | `access` is cached in the signed session cookie and survives restarts. Have them re-login, or rotate `SESSION_SECRET` to invalidate all sessions. |
| Newly added realm member missing from results | Realm member list is cached 5 min; wait or restart. |

---

## Project layout

```
okta-realm-log-viewer/
├── backend/
│   ├── src/
│   │   ├── server.js            # Express app, OIDC client init, static serving
│   │   ├── lib/okta.js          # realm map, access resolution, realm-user cache
│   │   ├── routes/auth.js       # login / callback / logout / me
│   │   ├── routes/logs.js       # realm-scoped System Log queries
│   │   └── middleware/auth.js   # session guard
│   └── .env                     # secrets (chmod 600, not committed)
├── frontend/
│   └── src/
│       ├── App.jsx              # login splash + shell, role badge
│       └── components/
│           ├── LogViewer.jsx    # filters, table, realm selector, refresh
│           └── LogDetail.jsx    # event detail panel
├── okta-realm-logs.service      # systemd unit template (placeholders)
├── setup.sh                     # bootstrap helper
└── README.md
```
