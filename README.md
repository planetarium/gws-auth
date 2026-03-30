# gws-auth

Google Workspace OAuth token helper CLI. Login once, pipe tokens to [gws](https://github.com/googleworkspace/cli).

## Install

```bash
npm install -g @anthropic-kr/gws-auth
```

## Usage

```bash
# Authenticate (opens browser, one-time)
gws-auth login

# Use with gws
export GOOGLE_WORKSPACE_CLI_TOKEN=$(gws-auth token)
gws sheets +read --spreadsheet <ID> --range Sheet1

# Check status
gws-auth status

# Logout
gws-auth logout
```

## How it works

1. `gws-auth login` starts a local HTTP server and opens Google's OAuth consent screen in your browser.
2. After you approve, the authorization code is exchanged for access + refresh tokens.
3. Tokens are cached at `~/.config/gws-auth/tokens.json` (file permission `600`).
4. `gws-auth token` prints a valid access token to stdout, auto-refreshing if expired.
5. Pipe the token to `gws` via `GOOGLE_WORKSPACE_CLI_TOKEN` environment variable.

## Scopes

This CLI requests the following scopes:

- `https://www.googleapis.com/auth/spreadsheets` — Read/write Google Sheets
- `https://www.googleapis.com/auth/drive` — Read/write Google Drive

## Development

OAuth Client ID and Secret are injected at build time via CI. For local development:

```bash
cp .env.example .env   # Fill in your own credentials
# Or:
export GWS_AUTH_CLIENT_ID="your-client-id"
export GWS_AUTH_CLIENT_SECRET="your-client-secret"
```

Then modify `lib/credentials.js` placeholders manually or use the inject script.

## CI/CD

The GitHub Actions workflow (`.github/workflows/publish.yml`) injects credentials from repository secrets on tagged releases:

- `GWS_AUTH_CLIENT_ID` — OAuth Client ID
- `GWS_AUTH_CLIENT_SECRET` — OAuth Client Secret
- `NPM_TOKEN` — npm publish token

```bash
git tag v0.1.0
git push origin v0.1.0
```

## License

Apache-2.0
