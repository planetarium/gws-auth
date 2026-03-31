#!/usr/bin/env node

const { login, getToken, logout } = require('../lib/auth');
const { SCOPE_ALIASES } = require('../lib/credentials');

const args = process.argv.slice(2);
const command = args[0];

const USAGE = `gws-auth — Google Workspace OAuth token helper

Usage:
  gws-auth login [--scope <name>]...   Authenticate with Google (device flow)
  gws-auth token                       Print access token to stdout (auto-refreshes)
  gws-auth logout                      Remove cached tokens
  gws-auth status                      Check login status
  gws-auth scopes                      List available scope aliases

Options:
  --scope <name>   Add extra scope (can be repeated). Use alias or full URL.

Examples:
  gws-auth login
  gws-auth login --scope gmail.readonly
  gws-auth login --scope gmail.readonly --scope calendar
  export GOOGLE_WORKSPACE_CLI_TOKEN=$(gws-auth token)
  gws sheets +read --spreadsheet <ID> --range Sheet1

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
    case 'login':
      return login(parseScopes(args));
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
