const http = require('http');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');
const { getCredentials, resolveScopes } = require('./credentials');
const tokenStore = require('./token-store');

const REDIRECT_PATH = '/callback';

// ── Authorization code flow ──────────────────────────────────────────

function canOpenBrowser() {
  if (process.env.GWS_AUTH_NO_BROWSER === '1') return false;
  if (!process.stdout.isTTY) return false;
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT) return false;
  if (process.env.container || process.env.DOCKER_CONTAINER) return false;
  return true;
}

async function tryOpenBrowser(url) {
  const { spawn } = require('child_process');
  let command, args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Wait for the OAuth callback on the server. */
function waitForCallback(server) {
  let timeoutId;
  let requestHandler;

  const cleanup = () => {
    clearTimeout(timeoutId);
    server.removeListener('request', requestHandler);
    server.close();
  };

  return {
    promise: new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Authorization timed out (5 minutes).'));
      }, 5 * 60 * 1000);

      requestHandler = (req, res) => {
        if (!req.url.startsWith(REDIRECT_PATH)) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, 'http://localhost');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authorization denied.</h1><p>You can close this tab.</p>');
          cleanup();
          reject(new Error(`Authorization denied: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authorization successful!</h1><p>You can close this tab.</p>');
          cleanup();
          resolve(code);
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid authorization response.</h1><p>You can close this tab and try again.</p>');
        cleanup();
        reject(new Error('Invalid authorization callback: missing "code" and "error" query parameters.'));
      };

      server.on('request', requestHandler);
    }),
    cleanup,
  };
}

async function authCodeFlowLogin(clientId, clientSecret, scopes, noBrowser) {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      server.close(() => reject(err));
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const port = server.address().port;
  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;

  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  const useBrowser = !noBrowser && canOpenBrowser();

  if (useBrowser) {
    console.error('\nOpening browser for authorization...');
    const opened = await tryOpenBrowser(authUrl);
    if (!opened) {
      console.error('Could not open browser.');
      console.error(`\nOpen this URL in a browser:\n\n  ${authUrl}\n`);
    }
  } else {
    console.error(`\nOpen this URL in a browser:\n\n  ${authUrl}\n`);
  }

  console.error(`Waiting for authorization callback on ${redirectUri} ...`);
  console.error(`If localhost is unreachable, copy the redirect URL and run:`);
  console.error(`  gws-auth exchange "<redirect-url>"\n`);

  const code = await waitForCallback(server).promise;
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

// ── Exchange (manual code completion) ────────────────────────────────

async function exchangeCode(callbackUrl) {
  const { clientId, clientSecret } = getCredentials();
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code found in the URL.');
  }

  const redirectUri = `${url.origin}${url.pathname}`;
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  tokenStore.save(tokens);
  console.error('Login successful. Token cached at ~/.config/gws-auth/tokens.json');
}

// ── Public API ───────────────────────────────────────────────────────

async function login(extraScopes = [], { noBrowser = false } = {}) {
  const { clientId, clientSecret } = getCredentials();
  const scopes = resolveScopes(extraScopes);

  const tokens = await authCodeFlowLogin(clientId, clientSecret, scopes, noBrowser);
  tokenStore.save(tokens);
  console.error('Login successful. Token cached at ~/.config/gws-auth/tokens.json');
}

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

  tokenStore.save(oauth2.credentials);
  process.stdout.write(token);
}

function logout() {
  tokenStore.clear();
  console.error('Logged out. Cached tokens removed.');
}

module.exports = { login, getToken, logout, exchangeCode };
