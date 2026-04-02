// OAuth Client ID is public (safe to hardcode).
// Client Secret is injected at build time via CI.
// See .github/workflows/publish.yml

const CLIENT_ID = '%%GWS_AUTH_CLIENT_ID%%';
const CLIENT_SECRET = '%%GWS_AUTH_CLIENT_SECRET%%';

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// Shorthand → full scope URL mapping
const SCOPE_ALIASES = {
  'spreadsheets': 'https://www.googleapis.com/auth/spreadsheets',
  'drive': 'https://www.googleapis.com/auth/drive',
  'drive.file': 'https://www.googleapis.com/auth/drive.file',
  'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
  'gmail.readonly': 'https://www.googleapis.com/auth/gmail.readonly',
  'gmail.send': 'https://www.googleapis.com/auth/gmail.send',
  'gmail.modify': 'https://www.googleapis.com/auth/gmail.modify',
  'calendar': 'https://www.googleapis.com/auth/calendar',
  'calendar.readonly': 'https://www.googleapis.com/auth/calendar.readonly',
  'docs': 'https://www.googleapis.com/auth/documents',
  'docs.readonly': 'https://www.googleapis.com/auth/documents.readonly',
};

// Scopes that require authorization code flow (device flow rejects these)
const AUTHCODE_ONLY_PREFIXES = [
  'https://www.googleapis.com/auth/gmail',
  'https://www.googleapis.com/auth/calendar',
  'https://mail.google.com/',
];

function needsAuthCodeFlow(scopes) {
  return scopes.some((s) =>
    AUTHCODE_ONLY_PREFIXES.some((prefix) => s.startsWith(prefix))
  );
}

function resolveScopes(extraScopes) {
  const scopes = new Set(DEFAULT_SCOPES);
  for (const s of extraScopes) {
    scopes.add(SCOPE_ALIASES[s] || s);
  }
  return [...scopes];
}

function getCredentials() {
  if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_ID.includes('GWS_AUTH')) {
    console.error(
      'Error: OAuth credentials not configured.\n' +
      'This binary was not built through CI. See README.md for development setup.'
    );
    process.exit(1);
  }
  return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };
}

module.exports = { getCredentials, DEFAULT_SCOPES, SCOPE_ALIASES, resolveScopes, needsAuthCodeFlow };
