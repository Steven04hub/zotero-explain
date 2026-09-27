// Verify the official login protocol without reading any existing credentials,
// opening a browser, or making a model request. No URLs/tokens are printed.
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const scope = { URL, setTimeout, clearTimeout };
vm.createContext(scope);
vm.runInContext(readFileSync(resolve(__dirname, '../addon/core.js'), 'utf8'), scope);
const binary = process.argv[2] || 'codex';
const dev = resolve(__dirname, '../.dev');
mkdirSync(dev, { recursive: true });
const isolated = mkdtempSync(join(dev, 'codex-probe-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(CODEX_|OPENAI_|AZURE_OPENAI_|CHATGPT_)/.test(key)) delete env[key];
env.CODEX_HOME = isolated;
const child = spawn(binary, ['app-server', '--listen', 'stdio://', '-c', 'forced_login_method="chatgpt"'], {
  cwd: isolated, env, stdio: ['pipe', 'pipe', 'pipe'],
});
const rpc = new scope.ZECore.RPC(line => new Promise((resolve, reject) => child.stdin.write(line, error => error ? reject(error) : resolve())));
child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => rpc.feed(chunk));
child.stderr.resume(); child.on('exit', () => rpc.close()); child.on('error', error => rpc.close(error));
(async () => {
  try {
    await rpc.request('initialize', { clientInfo: { name: 'zotero_explain_probe', version: '0.1.0' } });
    await rpc.notify('initialized');
    const state = await rpc.request('account/read', { refreshToken: false });
    assert.equal(state.account, null);
    const login = await rpc.request('account/login/start', { type: 'chatgpt' });
    assert.equal(login.type, 'chatgpt'); assert.ok(login.loginId);
    scope.ZECore.loginURL(login.authUrl);
    await rpc.request('account/login/cancel', { loginId: login.loginId });
    const after = await rpc.request('account/read', { refreshToken: false });
    assert.equal(after.account, null);
    console.log('PASS: initialize → signed-out account → official ChatGPT login URL → cancel → still signed out');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { rpc.close(); child.kill('SIGTERM'); }
})();
