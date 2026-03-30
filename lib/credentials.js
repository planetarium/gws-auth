// OAuth Client ID is public (safe to hardcode).
// Client Secret is injected at build time via CI.
// See .github/workflows/publish.yml

const CLIENT_ID = '%%GWS_AUTH_CLIENT_ID%%';
const CLIENT_SECRET = '%%GWS_AUTH_CLIENT_SECRET%%';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

function getCredentials() {
  if (CLIENT_ID.startsWith('%%') || CLIENT_SECRET.startsWith('%%')) {
    console.error(
      'Error: OAuth credentials not configured.\n' +
      'This binary was not built through CI. See README.md for development setup.'
    );
    process.exit(1);
  }
  return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
}

module.exports = { getCredentials, SCOPES };
