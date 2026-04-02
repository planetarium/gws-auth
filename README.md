# gws-auth

Google Workspace OAuth token helper CLI. Login once, pipe tokens to [gws](https://github.com/googleworkspace/cli).

## Install

```bash
npm install -g https://github.com/planetarium/gws-auth/releases/download/v0.4.0/planetarium-gws-auth-0.4.0.tgz
```

## Usage

```bash
# Authenticate (opens browser, one-time)
gws-auth login

# Request additional scopes (Gmail, Calendar, etc.)
gws-auth login --scope gmail.readonly
gws-auth login --scope gmail.modify --scope calendar

# Use with gws
export GOOGLE_WORKSPACE_CLI_TOKEN=$(gws-auth token)
gws sheets +read --spreadsheet <ID> --range Sheet1

# Check status
gws-auth status

# Logout
gws-auth logout
```

## How it works

1. `gws-auth login` starts a temporary localhost HTTP server and opens Google's OAuth consent screen.
2. After you approve, the callback is received on `localhost`, and the auth code is exchanged for tokens.
3. Tokens are cached at `~/.config/gws-auth/tokens.json` (file permission `600`).
4. `gws-auth token` prints a valid access token to stdout, auto-refreshing if expired.

### Remote / Docker environments

When localhost is unreachable (Docker without host networking, remote servers, etc.), the callback will fail. In that case:

1. Copy the redirect URL from the browser's address bar (it contains the auth code even though the page shows "connection refused").
2. Run `gws-auth exchange "<redirect-url>"` to complete the login.

```bash
# On the remote machine:
gws-auth login --scope gmail.readonly --no-browser
# → Prints an auth URL. Open it in any browser.
# → After consent, browser redirects to localhost (fails). Copy the URL.

gws-auth exchange "http://localhost:PORT/callback?code=4/0AQ..."
# → Login successful.
```

## Scopes

Default scopes: `spreadsheets`, `drive.file`

Available aliases:

| Alias | Scope |
|-------|-------|
| `spreadsheets` | `https://www.googleapis.com/auth/spreadsheets` |
| `drive` | `https://www.googleapis.com/auth/drive` |
| `drive.file` | `https://www.googleapis.com/auth/drive.file` |
| `drive.readonly` | `https://www.googleapis.com/auth/drive.readonly` |
| `gmail.readonly` | `https://www.googleapis.com/auth/gmail.readonly` |
| `gmail.send` | `https://www.googleapis.com/auth/gmail.send` |
| `gmail.modify` | `https://www.googleapis.com/auth/gmail.modify` |
| `calendar` | `https://www.googleapis.com/auth/calendar` |
| `calendar.readonly` | `https://www.googleapis.com/auth/calendar.readonly` |
| `docs` | `https://www.googleapis.com/auth/documents` |
| `docs.readonly` | `https://www.googleapis.com/auth/documents.readonly` |

Full scope URLs are also accepted as `--scope` values.

## Development

OAuth Client ID and Secret are injected at build time via CI. For local development:

```bash
export GWS_AUTH_CLIENT_ID="your-client-id"
export GWS_AUTH_CLIENT_SECRET="your-client-secret"
node scripts/inject-credentials.js
```

The OAuth client must be **Desktop app** type (not "TV and Limited Input") to support the authorization code flow.

## Releasing

Tag a version and push — CI handles the rest:

```bash
git tag v0.5.0
git push origin v0.5.0
```

The workflow automatically:
1. Syncs `package.json` version to the tag (strips the `v` prefix)
2. Injects OAuth credentials from GitHub Secrets
3. Packs the tarball and creates a GitHub Release

### GitHub Secrets

| Secret | Description |
|--------|-------------|
| `GWS_AUTH_CLIENT_ID` | OAuth Client ID (Desktop app type) |
| `GWS_AUTH_CLIENT_SECRET` | OAuth Client Secret |

## License

Apache-2.0
