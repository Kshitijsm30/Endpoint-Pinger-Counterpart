const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function readEnv() {
	const envPath = path.join(__dirname, '..', '.env');
	if (!fs.existsSync(envPath)) return {};
	const content = fs.readFileSync(envPath, 'utf8');
	const lines = content.split(/\r?\n/);
	const env = {};
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const idx = trimmed.indexOf('=');
		if (idx === -1) continue;
		const key = trimmed.slice(0, idx).trim();
		let val = trimmed.slice(idx + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		env[key] = val;
	}
	return env;
}

const env = readEnv();
const pingUrl = env.PING_URL || env.URL || env.ENDPOINT || Object.values(env).find(v => /^https?:\/\//i.test(v));
if (!pingUrl) {
	console.error('No URL found in .env. Set PING_URL or URL to a valid http(s) URL.');
	process.exit(1);
}

function ping(targetUrl) {
	try {
		const u = new URL(targetUrl);
		const lib = u.protocol === 'https:' ? https : http;
		const start = Date.now();
		const req = lib.get(u, (res) => {
			const ms = Date.now() - start;
			console.log(new Date().toISOString(), 'PING', targetUrl, 'status=', res.statusCode, 'timeMs=', ms);
			res.resume();
		});
		req.on('error', (err) => {
			console.error(new Date().toISOString(), 'PING ERROR', targetUrl, err.message);
		});
		req.setTimeout(30000, () => {
			req.abort();
			console.error(new Date().toISOString(), 'PING TIMEOUT', targetUrl);
		});
	} catch (err) {
		console.error('Invalid URL:', targetUrl, err.message);
	}
}

function scheduleNext() {
	const min = 4 * 60 * 1000; // 4 minutes
	const randomExtra = Math.random() * (2 * 60 * 1000); // up to 2 minutes
	const delay = Math.round(min + randomExtra);
	const minutes = (delay / 60000).toFixed(2);
	console.log(new Date().toISOString(), `Next ping in ${minutes} minutes`);
	setTimeout(() => {
		ping(pingUrl);
		scheduleNext();
	}, delay);
}

(function main() {
	console.log('Loaded URL:', pingUrl);
	ping(pingUrl);
	scheduleNext();
})();

