const { OAuth2Client } = require('google-auth-library');
const { getCredentials, DEFAULT_SCOPES, resolveScopes } = require('./credentials');
const tokenStore = require('./token-store');

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Request device + user codes from Google. */
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

/** Poll token endpoint until user authorizes or timeout. */
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

    // access_denied, expired_token, or other error
    throw new Error(data.error_description || data.error);
  }

  throw new Error('Device code expired. Please try again.');
}

/** Device flow login: show code, wait for user to authorize. */
async function login(extraScopes = []) {
  const { clientId, clientSecret } = getCredentials();
  const scopes = resolveScopes(extraScopes);

  const device = await requestDeviceCode(clientId, scopes);

  console.error(`\nOpen this URL in any browser:\n  ${device.verification_url}\n`);
  console.error(`Enter this code:\n  ${device.user_code}\n`);
  console.error('Waiting for authorization...');

  const tokens = await pollForToken(
    clientId,
    clientSecret,
    device.device_code,
    device.interval || 5,
    device.expires_in || 1800,
  );

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
