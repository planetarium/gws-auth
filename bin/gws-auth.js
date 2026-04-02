#!/usr/bin/env node

const { login, getToken, logout, exchangeCode } = require('../lib/auth');
const { SCOPE_ALIASES } = require('../lib/credentials');

const args = process.argv.slice(2);
const command = args[0];

const USAGE = `gws-auth — Google Workspace OAuth token helper

Usage:
  gws-auth login [--scope <name>]...   Authenticate with Google
  gws-auth exchange <url>              Exchange auth code from redirect URL
  gws-auth token                       Print access token to stdout (auto-refreshes)
  gws-auth logout                      Remove cached tokens
  gws-auth status                      Check login status
  gws-auth scopes                      List available scope aliases

Options:
  --scope <name>   Add extra scope (can be repeated). Use alias or full URL.
  --flow <type>    Force auth flow: "device" or "authcode" (default: auto).
  --no-browser     Skip auto-opening browser (print URL for manual copy).
  --remote         Remote mode: print auth URL only, use "exchange" to complete.

Auth flow is auto-selected by default:
  - Device flow for basic scopes (spreadsheets, drive.file, etc.)
  - Authorization code flow for restricted scopes (gmail.*, calendar.*, etc.)

Examples:
  gws-auth login
  gws-auth login --scope gmail.readonly
  gws-auth login --scope gmail.modify --scope calendar
  gws-auth login --flow authcode
  gws-auth login --scope gmail.send --no-browser

  # Remote / Docker (no localhost callback possible):
  gws-auth login --scope gmail.readonly --remote
  gws-auth exchange "http://localhost/callback?code=4/0AQ..."

  export GOOGLE_WORKSPACE_CLI_TOKEN=$(gws-auth token)

Default scopes: spreadsheets, drive.file`;

function parseScopes(args) {
  const scopes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope' && i + 1 < args.length) {
      scopes.push(args[++i]);
    }
  }
  return scopes;
}

async function status() {
  const tokenStore = require('../lib/token-store');
  const tokens = tokenStore.load();
  if (!tokens) {
    console.error('Not logged in.');
    process.exit(1);
  }
  const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
  const hasRefresh = !!tokens.refresh_token;
  console.error(`Logged in.`);
  console.error(`  Refresh token: ${hasRefresh ? 'yes' : 'no'}`);
  if (expiry) {
    console.error(`  Access token expires: ${expiry.toISOString()}`);
  }
  if (tokens.scope) {
    console.error(`  Scopes: ${tokens.scope}`);
  }
}

function listScopes() {
  console.log('Available scope aliases:\n');
  for (const [alias, url] of Object.entries(SCOPE_ALIASES)) {
    console.log(`  ${alias.padEnd(20)} ${url}`);
  }
  console.log('\nDefault: spreadsheets, drive.file');
  console.log('Full URLs are also accepted as --scope values.');
}

async function main() {
  switch (command) {
    case 'login': {
      const flowIdx = args.indexOf('--flow');
      const flow = flowIdx !== -1 && flowIdx + 1 < args.length ? args[flowIdx + 1] : undefined;
      if (flow && flow !== 'device' && flow !== 'authcode') {
        console.error(`Unknown flow: ${flow}. Use "device" or "authcode".`);
        process.exit(1);
      }
      return login(parseScopes(args), {
        noBrowser: args.includes('--no-browser'),
        remote: args.includes('--remote'),
        flow,
      });
    }
    case 'exchange': {
      const url = args[1];
      if (!url) {
        console.error('Usage: gws-auth exchange <redirect-url>');
        process.exit(1);
      }
      return exchangeCode(url);
    }
    case 'token':
      return getToken();
    case 'logout':
      return logout();
    case 'status':
      return status();
    case 'scopes':
      return listScopes();
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
