const http = require('http');
const { URL } = require('url');
const readline = require('readline');
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
  // Inside Docker or similar containers
  if (process.env.container || process.env.DOCKER_CONTAINER) return false;
  return true;
}

async function tryOpenBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  return new Promise((resolve) => {
    exec(`${cmd} ${JSON.stringify(url)}`, (err) => resolve(!err));
  });
}

function promptForUrl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question('\nPaste the redirected URL here:\n> ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Start a temporary localhost server and wait for the OAuth callback. */
function waitForCallback(server) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out (5 minutes).'));
    }, 5 * 60 * 1000);

    server.on('request', (req, res) => {
      if (!req.url.startsWith(REDIRECT_PATH)) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization denied.</h1><p>You can close this tab.</p>');
        clearTimeout(timeout);
        server.close();
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this tab.</p>');
        clearTimeout(timeout);
        server.close();
        resolve(code);
      }
    });
  });
}

async function authCodeFlowLogin(clientId, clientSecret, scopes, noBrowser) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;

  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });

  let code;
  const useBrowser = !noBrowser && canOpenBrowser();

  if (useBrowser) {
    console.error('\nOpening browser for authorization...');
    const opened = await tryOpenBrowser(authUrl);
    if (opened) {
      console.error('Waiting for authorization...');
      code = await waitForCallback(server);
    } else {
      // Browser failed to open — fall through to manual mode
      console.error('Could not open browser.');
    }
  }

  if (!code) {
    // Manual mode: print URL, ask user to paste the redirect URL back
    console.error(`\nOpen this URL in a browser:\n\n  ${authUrl}\n`);
    console.error(`After authorization, the browser will redirect to localhost.`);
    console.error(`If the page shows "connection refused", that's OK — copy the URL from the address bar.`);

    // Race: either the server catches the callback, or user pastes the URL
    code = await Promise.race([
      waitForCallback(server),
      promptForUrl().then((raw) => {
        server.close();
        const u = new URL(raw);
        const c = u.searchParams.get('code');
        if (!c) throw new Error('No authorization code found in the URL.');
        return c;
      }),
    ]);
  }

  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

// ── Public API ───────────────────────────────────────────────────────

async function login(extraScopes = [], { noBrowser = false } = {}) {
  const { clientId, clientSecret } = getCredentials();
  const scopes = resolveScopes(extraScopes);

  let tokens;
  if (needsAuthCodeFlow(scopes)) {
    console.error('Restricted scopes detected — using authorization code flow.');
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

module.exports = { login, getToken, logout };
