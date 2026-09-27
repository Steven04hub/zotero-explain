const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');

test('Zotero-required manifest metadata and native entry point are present', () => {
  const manifest = JSON.parse(readFileSync('addon/manifest.json', 'utf8'));
  const app = manifest.applications.zotero;
  for (const key of ['id', 'update_url', 'strict_min_version', 'strict_max_version']) assert.ok(app[key], key);
  assert.equal(app.strict_max_version, '10.0.*');
  assert.ok(new URL(app.update_url).hostname.endsWith('.invalid'));
  const files = readdirSync('addon');
  for (const file of ['bootstrap.js', 'core.js', 'platform.js', 'controller.js', 'panel.xhtml', 'panel.js', 'panel.css']) assert.ok(files.includes(file));
  for (const file of files) assert.ok(!/auth|token|schema|test/.test(file));
});
