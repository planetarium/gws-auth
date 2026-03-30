#!/usr/bin/env node

const { login, getToken, logout } = require('../lib/auth');

const command = process.argv[2];

const USAGE = `gws-auth — Google Workspace OAuth token helper

Usage:
  gws-auth login     Open browser and authenticate with Google
  gws-auth token     Print access token to stdout (auto-refreshes)
  gws-auth logout    Remove cached tokens
  gws-auth status    Check login status

Examples:
  gws-auth login
  export GOOGLE_WORKSPACE_CLI_TOKEN=$(gws-auth token)
  gws sheets +read --spreadsheet <ID> --range Sheet1`;

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
}

async function main() {
  switch (command) {
    case 'login':
      return login();
    case 'token':
      return getToken();
    case 'logout':
      return logout();
    case 'status':
      return status();
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
