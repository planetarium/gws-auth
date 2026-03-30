const http = require('http');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');
const { getCredentials, SCOPES } = require('./credentials');
const tokenStore = require('./token-store');

async function openBrowser(url) {
  const open = (await import('open')).default;
  await open(url);
}

/** Start local server, open browser, wait for OAuth callback, return tokens. */
async function login() {
  const { clientId, clientSecret } = getCredentials();

  const { code, redirectUri } = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (code) {
        res.end('<h2>Authenticated!</h2><p>You can close this tab.</p>');
      } else {
        res.end(`<h2>Failed: ${error || 'unknown'}</h2><p>You can close this tab.</p>`);
      }
      server.close();

      if (code) resolve({ code, redirectUri });
      else reject(new Error(error || 'no code received'));
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;

      const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
      const authUrl = oauth2.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
      });

      console.error('Opening browser for authentication...');
      console.error(`If browser doesn't open, visit:\n${authUrl}\n`);
      openBrowser(authUrl).catch(() => {});
    });
  });

  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  tokenStore.save(tokens);
  console.error('Login successful. Token cached at ~/.config/gws-auth/tokens.json');
}

/** Print a valid access token to stdout. Auto-refreshes if expired. */
async function getToken() {
  const tokens = tokenStore.load();
  if (!tokens) {
    console.error('Not logged in. Run: gws-auth login');
    process.exit(1);
  }

  const { clientId, clientSecret } = getCredentials();
  const oauth2 = new OAuth2Client(clientId, clientSecret);
  oauth2.setCredentials(tokens);

  const { token } = await oauth2.getAccessToken();
  if (!token) {
    console.error('Token refresh failed. Run: gws-auth login');
    process.exit(1);
  }

  // Persist refreshed credentials
  tokenStore.save(oauth2.credentials);
  process.stdout.write(token);
}

function logout() {
  tokenStore.clear();
  console.error('Logged out. Cached tokens removed.');
}

module.exports = { login, getToken, logout };
