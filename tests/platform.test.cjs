const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function pipe() {
  let waiting = [], queued = [], ended = false;
  return {
    readString: () => queued.length ? Promise.resolve(queued.shift())
      : ended ? Promise.resolve('') : new Promise(resolve => waiting.push(resolve)),
    emit(text) { if (waiting.length) waiting.shift()(text); else queued.push(text); },
    close() { ended = true; for (const resolve of waiting) resolve(''); waiting = []; },
  };
}

function environment({ holdLaunch = false, holdInitialize = false, launchError = false,
  windows = false, files = null, env = {}, searchPath = null,
  storeOutput = '[]', storeExitCode = 0, storeError = false, holdStore = false, queryTimeout = 8000,
  preferences = new Map([['extensions.zotero-explain.codexPath', '/test/codex']]) } = {}) {
  let flushes = 0;
  let releaseLaunch, resolveExit;
  const launched = holdLaunch ? new Promise(resolve => { releaseLaunch = resolve; }) : Promise.resolve();
  const children = [], queries = [], inspected = [];
  const scope = { URL, setTimeout: (fn, ms) => setTimeout(fn, ms === 8000 ? queryTimeout : ms), clearTimeout,
    Components: { interfaces: { nsIFile: {} } },
    Services: { dirsvc: { get: () => ({ path: windows ? 'C:\\Users\\测试者' : '/test-home' }) }, prefs: { savePrefFile: () => { flushes++; } } },
    PathUtils: { profileDir: windows ? 'C:\\test-profile' : '/test-profile', join: windows ? path.win32.join : path.join },
    IOUtils: {
      stat: async file => {
        inspected.push(file);
        if (files === null) return { type: 'regular' };
        const kind = files.get(file);
        if (!kind || kind === 'denied') throw new Error('File missing or inaccessible');
        return { type: kind };
      }, makeDirectory: async () => {},
    },
    Zotero: { isMac: !windows, isWin: windows, Prefs: { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) } },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      getEnvironment: () => ({ PATH: '/bin', OPENAI_API_KEY: 'must-not-inherit', CODEX_HOME: '/original', ...env }),
      pathSearch: async () => { if (searchPath) return searchPath; throw new Error('Not found'); },
      async call(options) {
        if (/powershell\.exe$/i.test(options.command)) {
          if (storeError) throw new Error('PowerShell blocked');
          const stdout = pipe(), stderr = pipe();
          let exits;
          const exit = new Promise(resolve => { exits = resolve; });
          const query = { options, stdout, stderr, killCount: 0, wait: () => exit,
            async kill() { query.killCount++; stdout.close(); stderr.close(); exits({ exitCode: 1 }); },
          };
          queries.push(query);
          if (!holdStore) {
            stdout.emit(storeOutput); stdout.close(); stderr.close(); exits({ exitCode: storeExitCode });
          }
          return query;
        }
        await launched;
        if (launchError) throw new Error('Access denied');
        const stdout = pipe(), stderr = pipe();
        let initialized = false, initializeID, exits;
        const exit = new Promise(resolve => { exits = resolve; });
        const response = (id, result) => stdout.emit(JSON.stringify({ id, result }) + '\n');
        const child = {
          stdout, stderr, options, killCount: 0,
          stdin: { async write(line) {
            const m = JSON.parse(line);
            if (m.method === 'initialize') { initializeID = m.id; if (!holdInitialize) response(m.id, {}); }
            else if (m.method === 'initialized') initialized = true;
            else if (m.method === 'account/read') {
              if (initialized) response(m.id, { account: null });
              else stdout.emit(JSON.stringify({ id: m.id, error: { message: 'not initialized' } }) + '\n');
            }
          } },
          ready() { response(initializeID, {}); },
          wait: () => exit,
          async kill() { child.killCount++; stdout.close(); stderr.close(); exits({ exitCode: 0 }); return { exitCode: 0 }; },
        };
        children.push(child); return child;
      },
    } }) },
  };
  vm.createContext(scope);
  for (const file of ['core.js', 'platform.js']) vm.runInContext(fs.readFileSync('addon/' + file, 'utf8'), scope);
  return { platform: scope.ZEPlatform, children, queries, inspected, preferences, get flushes() { return flushes; }, releaseLaunch: () => releaseLaunch?.() };
}

test('concurrent clients both wait for initialization, without inheriting API credentials', async () => {
  const e = environment({ holdInitialize: true });
  const one = e.platform.start(); await tick();
  const two = e.platform.start();
  let returned = false; two.then(() => { returned = true; });
  await tick(); assert.equal(returned, false);
  e.children[0].ready();
  const [a, b] = await Promise.all([one, two]); assert.equal(a, b);
  assert.equal((await b.request('account/read')).account, null);
  assert.equal(e.children[0].options.environment.OPENAI_API_KEY, undefined);
  assert.equal(e.children[0].options.environment.CODEX_HOME, '/test-profile/zotero-explain');
  await e.platform.stop();
});

test('stop during process launch kills the late process', async () => {
  const e = environment({ holdLaunch: true });
  const start = e.platform.start(); const rejection = assert.rejects(start, /取消/);
  await tick(); const stop = e.platform.stop();
  e.releaseLaunch(); await stop; await rejection;
  assert.ok(e.children[0].killCount > 0);
});

test('stop during initialization closes pending requests promptly', async () => {
  const e = environment({ holdInitialize: true });
  const start = e.platform.start(); const rejection = assert.rejects(start);
  await tick(); await e.platform.stop(); await rejection;
  assert.ok(e.children[0].killCount > 0);
});

test('malformed transport output terminates its process and permits a clean restart', async () => {
  const e = environment(); const old = await e.platform.start();
  e.children[0].stdout.emit('invalid JSON\n'); await tick();
  assert.equal(old.closed, true); assert.ok(e.children[0].killCount > 0);
  const next = await e.platform.start(); assert.notEqual(next, old);
  assert.equal((await next.request('account/read')).account, null);
  await e.platform.stop();
});

test('model and effort are flushed and restored by a fresh plugin instance', () => {
  const first = environment();
  first.platform.setGenerationSettings({ model: 'gpt-6-astra', effort: 'xhigh' });
  assert.equal(first.flushes, 1);
  const second = environment({ preferences: first.preferences });
  assert.deepEqual(JSON.parse(JSON.stringify(second.platform.getGenerationSettings())), { model: 'gpt-6-astra', effort: 'xhigh' });
  assert.equal(second.flushes, 0, 'reading settings must not overwrite them');
  assert.equal(first.preferences.get('extensions.zotero-explain.codexPath'), '/test/codex');
});

test('missing, corrupt and malformed preferences recover to safe defaults', () => {
  for (const raw of [undefined, '{broken', 'null', 'false', '{"model":7,"effort":{}}']) {
    const e = environment({ preferences: new Map([['extensions.zotero-explain.generation', raw]]) });
    assert.deepEqual(JSON.parse(JSON.stringify(e.platform.getGenerationSettings())), { model: 'gpt-6-sol', effort: 'medium' });
  }
});

const windowsEnv = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\测试者\\AppData\\Local' };
const storeRoot = 'D:\\WindowsApps\\OpenAI.Codex_26.927.1.0_x64__example';
const bundledCLI = path.win32.join(storeRoot, 'app', 'resources', 'codex.exe');
function windowsEnvironment(options = {}) {
  return environment({ windows: true, preferences: new Map(), files: new Map(), env: windowsEnv, ...options });
}

test('Windows Store discovery uses registered location on another drive and launches the CLI', async () => {
  const e = windowsEnvironment({ storeOutput: JSON.stringify([storeRoot]), files: new Map([[bundledCLI, 'regular']]) });
  await e.platform.start();
  assert.equal(e.children[0].options.command, bundledCLI);
  assert.equal(e.children[0].options.arguments[0], 'app-server');
  assert.equal(e.queries[0].options.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(e.queries[0].options.arguments.includes('-NoProfile'));
  assert.ok(e.queries[0].options.arguments.at(-1).includes("Get-AppxPackage -Name 'OpenAI.Codex'"));
  assert.ok(!e.inspected.includes(path.win32.join(storeRoot, 'app', 'Codex.exe')));
  await e.platform.stop();
});

test('Store discovery accepts UTF-8 BOM and Unicode paths, and skips missing or denied versions', async () => {
  const root = 'D:\\应用\\OpenAI.Codex_new';
  const cli = path.win32.join(root, 'app', 'resources', 'codex.exe');
  const e = windowsEnvironment({ storeOutput: '\uFEFF' + JSON.stringify([storeRoot, root]),
    files: new Map([[bundledCLI, 'denied'], [cli, 'regular']]) });
  assert.equal(await e.platform.findExecutable(), cli);
});

test('Store locations are rediscovered after updates instead of persisting a versioned path', async () => {
  const preferences = new Map();
  const old = windowsEnvironment({ preferences, storeOutput: JSON.stringify([storeRoot]), files: new Map([[bundledCLI, 'regular']]) });
  assert.equal(await old.platform.findExecutable(), bundledCLI);
  const root = storeRoot.replace('26.927.1.0', '26.928.1.0');
  const cli = path.win32.join(root, 'resources', 'codex.exe');
  const updated = windowsEnvironment({ preferences, storeOutput: JSON.stringify([root]), files: new Map([[cli, 'regular']]) });
  assert.equal(await updated.platform.findExecutable(), cli);
  assert.equal(preferences.size, 0);
});

test('Windows discovery falls back to the standalone CLI when Store query is unavailable or malformed', async () => {
  const cli = path.win32.join(windowsEnv.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  for (const options of [{ storeError: true }, { storeOutput: 'not json' }, { storeOutput: 'null' }, { storeExitCode: 1 }, {}]) {
    const e = windowsEnvironment({ ...options, files: new Map([[cli, 'regular']]) });
    assert.equal(await e.platform.findExecutable(), cli);
    assert.equal(e.children.length, 0);
  }
});

test('Windows package query times out, terminates, and allows PATH fallback', async () => {
  const cli = 'C:\\tools\\codex.exe';
  const e = windowsEnvironment({ holdStore: true, queryTimeout: 10, searchPath: cli, files: new Map([[cli, 'regular']]) });
  assert.equal(await e.platform.findExecutable(), cli);
  assert.equal(e.queries[0].killCount, 1);
});

test('stopping during Windows discovery kills the query and never launches App Server', async () => {
  const e = windowsEnvironment({ holdStore: true });
  const pending = e.platform.start();
  const rejection = assert.rejects(pending);
  await tick();
  await e.platform.stop(); await rejection;
  assert.ok(e.queries[0].killCount > 0);
  assert.equal(e.children.length, 0);
});

test('Windows custom path accepts copied quotes and case-insensitive environment variables and persists', async () => {
  const cli = path.win32.join(windowsEnv.LOCALAPPDATA, 'Codex CLI', 'codex.exe');
  const e = windowsEnvironment({ files: new Map([[cli, 'regular']]) });
  e.platform.setPath(' "%localappdata%\\Codex CLI\\codex.exe" ');
  assert.equal(await e.platform.findExecutable(), cli);
  assert.equal(e.flushes, 1);
  assert.equal(e.queries.length, 0, 'explicit paths bypass package discovery');
});

test('Windows rejects launch scripts, directories and stale custom paths with recovery instructions', async () => {
  for (const custom of ['C:\\bin\\codex.cmd', 'C:\\bin\\codex.ps1', 'C:\\Codex', 'C:\\old\\codex.exe']) {
    const e = windowsEnvironment({ preferences: new Map([['extensions.zotero-explain.codexPath', custom]]) });
    await assert.rejects(e.platform.findExecutable(), /清空路径/);
    assert.equal(e.queries.length, 0);
  }
  const e = windowsEnvironment({ files: new Map([[bundledCLI, 'directory']]), storeOutput: JSON.stringify([storeRoot]) });
  await assert.rejects(e.platform.findExecutable(), /未找到/);
});

test('Windows avoids desktop execution aliases and explains how to recover if nothing is found', async () => {
  const alias = path.win32.join(windowsEnv.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'codex.exe');
  const e = windowsEnvironment({ searchPath: alias, files: new Map([[alias, 'regular']]) });
  await assert.rejects(e.platform.findExecutable(), /Microsoft Store.*官方 Windows Codex CLI/);
  assert.equal(e.children.length, 0);
});

test('Windows reports a found but unlaunchable executable separately from a missing installation', async () => {
  const e = windowsEnvironment({ launchError: true, storeOutput: JSON.stringify([storeRoot]),
    files: new Map([[bundledCLI, 'regular']]) });
  await assert.rejects(e.platform.start(), error => error.message.includes(bundledCLI)
    && error.message.includes('已找到 Codex，但无法启动') && error.message.includes('官方 Windows Codex CLI'));
  await e.platform.stop();
});
