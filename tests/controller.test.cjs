const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('hot upgrade replaces stale callbacks without removing other plugins', () => {
  const Reader = { _registeredListeners: [
    { type: 'renderTextSelectionPopup', handler() {}, pluginID: 'test' },
    { type: 'renderTextSelectionPopup', handler() {}, pluginID: 'other' },
  ],
  unregisterEventListener(type, handler) {
    this._registeredListeners = this._registeredListeners.filter(x => x.type !== type || x.handler !== handler);
  },
  registerEventListener(type, handler, pluginID) { this._registeredListeners.push({ type, handler, pluginID }); } };
  const other = Reader._registeredListeners[1], old = Reader._registeredListeners[0];
  const context = vm.createContext({ Zotero: { Reader } });
  vm.runInContext(fs.readFileSync('addon/controller.js', 'utf8'), context);
  context.ZEController.init('test');
  assert.equal(Reader._registeredListeners.length, 2);
  assert.ok(Reader._registeredListeners.includes(other));
  assert.ok(!Reader._registeredListeners.includes(old));
});

function owner() {
  let focusCount = 0;
  const events = new Map();
  const win = { closed: false, fullScreen: true, innerWidth: 1400, innerHeight: 900,
    addEventListener: (type, fn) => events.set(type, fn),
    removeEventListener: type => events.delete(type),
    unload() { events.get('unload')?.(); },
    openDialog() { throw new Error('Must not create a native window'); },
    get focusCount() { return focusCount; },
  };
  function node(tag) {
    const handlers = new Map();
    return { tag, ownerDocument: doc, children: [], style: {}, isConnected: false,
      getBoundingClientRect() { const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0; const width = parseFloat(this.style.width) || 462, height = parseFloat(this.style.height) || 602; return { left, top, width, height, right: left + width, bottom: top + height }; },
      setAttribute() {}, addEventListener: (type, fn) => handlers.set(type, fn),
      emit(type) { handlers.get(type)?.({ preventDefault() {}, stopPropagation() {} }); },
      appendChild(child) { child.parent = this; child.isConnected = this.isConnected; this.children.push(child); },
      remove() { this.isConnected = false; this.parent.children = this.parent.children.filter(child => child !== this); },
      contentWindow: tag === 'iframe' ? { focus() {}, ZEPanel: {
        selections: [], disposed: false,
        select(value) { this.selections.push(value); }, dispose() { this.disposed = true; },
      } } : undefined,
    };
  }
  const doc = { defaultView: win, activeElement: { focus() { focusCount++; } },
    createElement: node, createElementNS: (_, tag) => node(tag), createXULElement: node,
    getElementById(id) {
      const find = element => element.id === id ? element : element.children.map(find).find(Boolean);
      return find(doc.documentElement);
    },
  };
  win.top = win; win.document = doc;
  doc.documentElement = node('window'); doc.documentElement.isConnected = true;
  const menu = node('menupopup'); menu.id = 'menu_ToolsPopup'; doc.documentElement.appendChild(menu);
  return win;
}

function setup() {
  const main = owner(), readerWindow = owner();
  let listener;
  const context = { ZECore: {}, ZEPlatform: {}, Zotero: {
    getMainWindow: () => main, getMainWindows: () => [main],
    Items: { get: () => ({ getField: () => 'Test paper' }) },
    Reader: { registerEventListener: (_, fn) => { listener = fn; }, unregisterEventListener: () => { listener = null; } },
  } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('addon/layout.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('addon/controller.js', 'utf8'), context);
  const controller = context.ZEController;
  controller.init('test');
  return { main, readerWindow, controller,
    frame: win => win.document.getElementById('zotero-explain-panel')?.children[0],
    select(win, text = 'Selected sentence', readerOptions = {}) {
      let button;
      listener({ reader: { itemID: 1, _window: win, ...readerOptions }, doc: main.document,
        params: { annotation: { text, position: { pageIndex: 0, rects: [[0, 0, 1, 1]] } } }, append: value => { button = value; } });
      button.emit('click');
    },
  };
}

test('selection in a detached reader opens inside that reader and preserves fullscreen', () => {
  const e = setup(); e.select(e.readerWindow);
  assert.ok(e.frame(e.readerWindow));
  assert.equal(e.frame(e.main), undefined);
  assert.equal(e.readerWindow.fullScreen, true);
  assert.equal(e.frame(e.readerWindow).ZEBridge.selection.text, 'Selected sentence');
});

test('dragging moves the panel while keeping it within the owner window', () => {
  const e = setup(); e.select(e.main); const frame = e.frame(e.main);
  frame.ZEBridge.beginMove({ x: 1000, y: 150 });
  frame.ZEBridge.move({ x: 500, y: 250 }); frame.ZEBridge.endMove();
  const box = frame.parent.getBoundingClientRect();
  assert.equal(box.left, 426); assert.equal(box.top, 172);
  frame.ZEBridge.beginMove({ x: 500, y: 250 }); frame.ZEBridge.move({ x: -5000, y: -5000 });
  assert.equal(frame.parent.getBoundingClientRect().left, 12);
  assert.equal(e.main.fullScreen, true);
});

test('PDF selection uses the active split view and relocates an already-open panel', () => {
  const e = setup();
  const view = { _iframeWindow: e.main, getClientRectForPopup: () => [900, 180, 1250, 440] };
  e.select(e.main, 'Right column', { _internalReader: { _lastViewPrimary: false, _secondaryView: view } });
  assert.ok(e.frame(e.main).parent.getBoundingClientRect().right <= 888);
  view.getClientRectForPopup = () => [50, 180, 550, 440];
  e.select(e.main, 'Left column', { _internalReader: { _primaryView: view } });
  assert.ok(e.frame(e.main).parent.getBoundingClientRect().left >= 562);
});

test('repeated selection reuses the embedded panel, including selection before its script loads', () => {
  const e = setup(); e.select(e.main);
  const frame = e.frame(e.main); frame.contentWindow.ZEPanel = undefined;
  e.select(e.main, 'Latest sentence');
  assert.equal(e.frame(e.main), frame);
  assert.equal(frame.ZEBridge.selection.text, 'Latest sentence');
});

test('changing reader owners disposes the old panel and ignores its late close callback', () => {
  const e = setup(); e.select(e.main); const old = e.frame(e.main);
  e.select(e.readerWindow);
  assert.equal(old.contentWindow.ZEPanel.disposed, true);
  assert.equal(e.frame(e.main), undefined);
  old.ZEBridge.close();
  assert.ok(e.frame(e.readerWindow));
});

test('closing restores reader focus without closing the owner or leaving fullscreen', () => {
  const e = setup(); e.select(e.main); const frame = e.frame(e.main);
  frame.ZEBridge.close(); frame.ZEBridge.close();
  assert.equal(frame.contentWindow.ZEPanel.disposed, true);
  assert.equal(e.main.focusCount, 1);
  assert.equal(e.main.closed, false);
  assert.equal(e.main.fullScreen, true);
});

test('owner unload and plugin shutdown both dispose embedded panels', async () => {
  const e = setup(); e.select(e.readerWindow); const frame = e.frame(e.readerWindow);
  e.readerWindow.unload();
  assert.equal(frame.contentWindow.ZEPanel.disposed, true);
  assert.equal(e.frame(e.readerWindow), undefined);
  e.select(e.main); const next = e.frame(e.main);
  await e.controller.shutdown();
  assert.equal(next.contentWindow.ZEPanel.disposed, true);
  assert.equal(e.frame(e.main), undefined);
});
