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
  const frames = new Map(); let nextFrame = 0;
  const win = { closed: false, fullScreen: true, innerWidth: 1400, innerHeight: 900,
    addEventListener(type, fn) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(fn);
    },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type) { for (const fn of events.get(type) || []) fn(); },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    getComputedStyle: node => node.style,
    unload() { win.emit('unload'); },
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

test('manual drag crosses a selected column and stays there until a new selection', () => {
  const e = setup(), win = e.main;
  const source = { reader: {}, sourceWindow: win, key: 'first',
    anchor: () => ({ left: 50, top: 180, right: 550, bottom: 440 }) };
  e.controller.open({ text: 'First selection' }, win, source);
  const frame = e.frame(win), bridge = frame.ZEBridge;
  const before = frame.parent.getBoundingClientRect();
  bridge.beginMove({ x: 1000, y: 150 });
  bridge.move({ x: 1000 + 40 - before.left, y: 150 }); bridge.endMove();
  const moved = frame.parent.getBoundingClientRect();
  assert.equal(moved.left, 40);
  assert.equal(moved.width, before.width);
  win.emit('scroll'); win.flushFrames(); win.emit('resize');
  assert.equal(frame.parent.getBoundingClientRect().left, 40);
  // Zotero can render the same selection popup again; this must not snap back.
  e.controller.open({ text: 'First selection' }, win, { ...source });
  assert.equal(frame.parent.getBoundingClientRect().left, 40);
  e.controller.open({ text: 'Next selection' }, win, { ...source, key: 'next' });
  assert.ok(frame.parent.getBoundingClientRect().left >= 562);
});

for (const missingGeometry of [true, false]) {
  test(`dragging releases right docking with ${missingGeometry ? 'missing geometry' : 'a crowded selection'}`, () => {
    const e = setup(), win = e.main;
    const browser = { isConnected: true, style: { marginRight: '9px' },
      getBoundingClientRect() {
        const right = 1390 - parseFloat(this.style.marginRight);
        return { left: 20, right, top: 80, bottom: 890, width: right - 20, height: 810 };
      } };
    const source = { reader: { _iframe: browser }, sourceWindow: win, key: 'first',
      anchor: () => missingGeometry ? null : { left: 20, top: 80, right: 1380, bottom: 880 } };
    e.controller.open({ text: 'Selected text' }, win, source);
    const frame = e.frame(win), bridge = frame.ZEBridge;
    const before = frame.parent.getBoundingClientRect();
    assert.notEqual(browser.style.marginRight, '9px');
    // A click without movement should leave automatic docking alone.
    bridge.beginMove({ x: 1000, y: 150 }); bridge.move({ x: 1000, y: 150 }); bridge.endMove();
    assert.notEqual(browser.style.marginRight, '9px');
    bridge.beginMove({ x: 1000, y: 150 });
    bridge.move({ x: 1000 + 30 - before.left, y: 180 }); bridge.endMove();
    assert.equal(browser.style.marginRight, '9px');
    assert.equal(frame.parent.getBoundingClientRect().left, 30);
    assert.equal(frame.parent.getBoundingClientRect().width, before.width);
    win.emit('scroll'); win.flushFrames(); win.emit('resize');
    assert.equal(frame.parent.getBoundingClientRect().left, 30);
    assert.equal(browser.style.marginRight, '9px');
    win.innerWidth = 400; win.innerHeight = 450; win.emit('resize');
    const small = frame.parent.getBoundingClientRect();
    assert.ok(small.left >= 12 && small.right <= 388 && small.top >= 12 && small.bottom <= 438);
    bridge.close(); win.flushFrames();
    assert.equal(browser.style.marginRight, '9px');
  });
}

test('repeated selection reuses the embedded panel, including selection before its script loads', () => {
  const e = setup(); e.select(e.main);
  const frame = e.frame(e.main); frame.contentWindow.ZEPanel = undefined;
  e.select(e.main, 'Latest sentence');
  assert.equal(e.frame(e.main), frame);
  assert.equal(frame.ZEBridge.selection.text, 'Latest sentence');
});

test('resized dimensions survive movement, scrolling and new selection avoidance', () => {
  const e = setup(), win = e.main;
  const source = { reader: {}, sourceWindow: win, key: 'first',
    anchor: () => ({ left: 50, top: 180, right: 400, bottom: 440 }) };
  e.controller.open({ text: 'First' }, win, source);
  const frame = e.frame(win), bridge = frame.ZEBridge;
  const before = frame.parent.getBoundingClientRect();
  bridge.beginResize('w', { x: 1000, y: 200 });
  bridge.resize({ x: 920, y: 200 });
  assert.equal(frame.parent.getBoundingClientRect().width, before.width + 80);
  bridge.resize({ x: 1000, y: 200 });
  assert.equal(frame.parent.getBoundingClientRect().width, before.width);
  bridge.resize({ x: 920, y: 200 }); bridge.endResize();
  const sized = frame.parent.getBoundingClientRect();
  assert.equal(sized.right, before.right);
  bridge.beginMove({ x: 1000, y: 200 }); bridge.move({ x: 200, y: 200 }); bridge.endMove();
  win.emit('scroll'); win.flushFrames();
  assert.equal(frame.parent.getBoundingClientRect().width, sized.width);
  e.controller.open({ text: 'Second' }, win, { ...source, key: 'second' });
  const avoided = frame.parent.getBoundingClientRect();
  assert.ok(avoided.left >= 412);
  assert.equal(avoided.width, sized.width);
  assert.equal(frame.contentWindow.ZEPanel.disposed, false);
  bridge.close(); bridge.beginResize('e', { x: 0, y: 0 }); bridge.resize({ x: 100, y: 0 });
  assert.equal(e.frame(win), undefined);
});

test('resizing a docked panel releases reserved reader space without snapping back', () => {
  const e = setup(), win = e.main;
  const browser = { isConnected: true, style: { marginRight: '9px' },
    getBoundingClientRect() {
      const right = 1390 - parseFloat(this.style.marginRight);
      return { left: 20, right, top: 80, width: right - 20 };
    } };
  e.controller.open({ text: 'No geometry' }, win, { reader: { _iframe: browser }, sourceWindow: win, key: 'first', anchor: () => null });
  const frame = e.frame(win), bridge = frame.ZEBridge;
  const before = frame.parent.getBoundingClientRect();
  bridge.beginResize('w', { x: 1000, y: 200 }); bridge.resize({ x: 940, y: 200 }); bridge.endResize();
  assert.equal(browser.style.marginRight, '9px');
  assert.equal(frame.parent.getBoundingClientRect().width, before.width + 60);
  win.emit('scroll'); win.flushFrames();
  assert.equal(frame.parent.getBoundingClientRect().width, before.width + 60);
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
