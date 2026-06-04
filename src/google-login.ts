import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { Api } from './api.js';

const DEFAULT_PORT = 5173; // already an authorized JS origin on the cloudbtl OAuth client
const TIMEOUT_MS = 180_000;

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

function page(clientId: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>cloudbtl login</title>
<script src="https://accounts.google.com/gsi/client" async></script>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#0f1115}
#status{margin-top:20px;color:#5c6470}</style></head>
<body>
<h2>Sign in to cloudbtl</h2>
<div id="btn"></div>
<p id="status">Choose a Google account to continue…</p>
<script>
window.onload = function () {
  google.accounts.id.initialize({ client_id: ${JSON.stringify(clientId)}, callback: onCred });
  google.accounts.id.renderButton(document.getElementById('btn'), { theme: 'outline', size: 'large' });
  google.accounts.id.prompt();
};
function onCred(resp) {
  document.getElementById('status').textContent = 'Signing in…';
  fetch('/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { document.getElementById('status').textContent = d.ok ? '✓ Done — you can close this tab and return to the terminal.' : ('Sign-in failed: ' + (d.error || 'unknown error')); })
    .catch(function (e) { document.getElementById('status').textContent = 'Error: ' + e; });
}
</script></body></html>`;
}

/**
 * Runs the browser-based Google sign-in for a CLI: serves a tiny GIS page on a loopback
 * port whose origin is authorized on the OAuth client, captures the returned ID token,
 * and exchanges it for a cloudbtl session via the existing /api/auth/google.
 */
export function googleLogin(
  api: Api,
  clientId: string,
): Promise<{ user: { email: string; name: string }; cookie: string }> {
  const port = Number(process.env.CLOUDBTL_OAUTH_PORT) || DEFAULT_PORT;
  const origin = `http://localhost:${port}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    };

    const server = createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page(clientId));
        return;
      }
      if (req.method === 'POST' && req.url === '/callback') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { credential } = JSON.parse(body || '{}') as { credential?: string };
            if (!credential) throw new Error('No credential received from Google.');
            const result = await api.loginWithGoogle(credential);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            finish(() => resolve(result));
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'sign-in failed';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: msg }));
            finish(() => reject(e instanceof Error ? e : new Error(msg)));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const timer = setTimeout(
      () => finish(() => reject(new Error('Timed out waiting for Google sign-in.'))),
      TIMEOUT_MS,
    );

    server.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        finish(() =>
          reject(
            new Error(
              `Port ${port} is in use (a dev server?). Free it, or set CLOUDBTL_OAUTH_PORT to another port that is an Authorized JavaScript origin on your Google OAuth client.`,
            ),
          ),
        );
      } else {
        finish(() => reject(e));
      }
    });

    server.listen(port, '127.0.0.1', () => {
      if (process.env.CLOUDBTL_NO_BROWSER) {
        console.log(`Open this URL in a browser to sign in:\n  ${origin}`);
      } else {
        console.log(`Opening ${origin} in your browser… (complete the Google sign-in there)`);
        openBrowser(origin);
      }
    });
  });
}
