const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');
const { getCredentials, DEFAULT_SCOPES, resolveScopes, needsAuthCodeFlow } = require('./credentials');
const tokenStore = require('./token-store');

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_PATH = '/callback';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Device flow ──────────────────────────────────────────────────────

async function requestDeviceCode(clientId, scopes) {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopes.join(' '),
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Device code request failed: ${err.error_description || err.error}`);
  }

  return res.json();
}

async function pollForToken(clientId, clientSecret, deviceCode, interval, expiresIn) {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = await res.json();

    if (data.access_token) {
      return data;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'slow_down') {
      pollInterval += 5000;
      continue;
    }

    throw new Error(data.error_description || data.error);
  }

  throw new Error('Device code expired. Please try again.');
}

async function deviceFlowLogin(clientId, clientSecret, scopes) {
  const device = await requestDeviceCode(clientId, scopes);

  console.error(`\nOpen this URL in any browser:\n  ${device.verification_url}\n`);
  console.error(`Enter this code:\n  ${device.user_code}\n`);
  console.error('Waiting for authorization...');

  return pollForToken(
    clientId,
    clientSecret,
    device.device_code,
    device.interval || 5,
    device.expires_in || 1800,
  );
}

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

function buildRedirectUri(port) {
  return `http://localhost:${port}${REDIRECT_PATH}`;
}

async function authCodeFlowLogin(clientId, clientSecret, scopes, noBrowser) {
  // Start localhost server on a random port
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
  const redirectUri = buildRedirectUri(port);

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
  console.error(`  gws-auth exchange "${redirectUri}?code=<THE_CODE>"\n`);

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

  // Reconstruct the redirect_uri from the URL (must match what was used in the auth request)
  const redirectUri = `${url.origin}${url.pathname}`;
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2.getToken(code);
  tokenStore.save(tokens);
  console.error('Login successful. Token cached at ~/.config/gws-auth/tokens.json');
}

// ── Public API ───────────────────────────────────────────────────────

async function login(extraScopes = [], { noBrowser = false, flow } = {}) {
  const { clientId, clientSecret } = getCredentials();
  const scopes = resolveScopes(extraScopes);

  const useAuthCode = flow === 'authcode' || (!flow && needsAuthCodeFlow(scopes));

  let tokens;
  if (useAuthCode) {
    if (!flow) console.error('Restricted scopes detected — using authorization code flow.');
    tokens = await authCodeFlowLogin(clientId, clientSecret, scopes, noBrowser);
  } else {
    tokens = await deviceFlowLogin(clientId, clientSecret, scopes);
  }

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
