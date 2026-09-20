const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const port = process.env.PORT || 3000;
let domain = process.env.NGROK_DOMAIN || process.env.TUNNEL_URL || '';

// Clean domain if it has trailing slashes
if (domain) {
  domain = domain.trim().replace(/\/+$/, '');
}

console.log('========================================================');
console.log('  Foodie Express - Secure HTTPS Tunnel Runner');
console.log('========================================================\n');

// Find ngrok binary: bundled scripts/ngrok.exe or system ngrok in PATH
const localNgrok = path.join(__dirname, 'ngrok.exe');
let ngrokCmd = 'ngrok';

if (fs.existsSync(localNgrok)) {
  ngrokCmd = localNgrok;
}

const args = ['http'];
if (domain) {
  args.push(`--url=${domain}`);
  console.log(`Tunneling port ${port} to private domain: ${domain}\n`);
} else {
  console.log(`Tunneling port ${port} via standard dynamic HTTPS URL...\n`);
}
args.push(String(port));

console.log('Starting tunnel process... Press Ctrl+C in this window to stop.');

const child = spawn(ngrokCmd, args, {
  stdio: 'inherit',
  shell: true,
  windowsHide: false,
});

child.on('error', (err) => {
  console.error('\n[Tunnel Error] Failed to launch ngrok:', err.message);
  console.error('Ensure scripts/ngrok.exe exists or ngrok is installed in your system PATH.');
  process.exit(1);
});

child.on('close', (code) => {
  console.log(`\nTunnel closed (exit code ${code})`);
});
