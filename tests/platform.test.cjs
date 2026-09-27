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

function environment({ holdLaunch = false, holdInitialize = false,
  preferences = new Map([['extensions.zotero-explain.codexPath', '/test/codex']]) } = {}) {
  let flushes = 0;
  let releaseLaunch, resolveExit;
  const launched = holdLaunch ? new Promise(resolve => { releaseLaunch = resolve; }) : Promise.resolve();
  const children = [];
  const scope = { URL, setTimeout, clearTimeout,
    Components: { interfaces: { nsIFile: {} } },
    Services: { dirsvc: { get: () => ({ path: '/test-home' }) }, prefs: { savePrefFile: () => { flushes++; } } },
    PathUtils: { profileDir: '/test-profile', join: path.join },
    IOUtils: { exists: async () => true, makeDirectory: async () => {} },
    Zotero: { isMac: true, Prefs: { get: key => preferences.get(key), set: (key, value) => preferences.set(key, value) } },
    ChromeUtils: { importESModule: () => ({ Subprocess: {
      getEnvironment: () => ({ PATH: '/bin', OPENAI_API_KEY: 'must-not-inherit', CODEX_HOME: '/original' }),
      async call(options) {
        await launched;
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
  return { platform: scope.ZEPlatform, children, preferences, get flushes() { return flushes; }, releaseLaunch: () => releaseLaunch?.() };
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
