const fs = require('fs');

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('CLIENT_ID and CLIENT_SECRET env vars are required');
  process.exit(1);
}

const file = 'lib/credentials.js';
let content = fs.readFileSync(file, 'utf8');
content = content.replace('%%GWS_AUTH_CLIENT_ID%%', clientId);
content = content.replace('%%GWS_AUTH_CLIENT_SECRET%%', clientSecret);
fs.writeFileSync(file, content);

console.log('Credentials injected successfully');
