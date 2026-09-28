const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('addon/layout.js', 'utf8'), context);
const layout = context.ZELayout;
const boxOf = p => layout.rect([p.left, p.top, p.left + p.width, p.top + p.height]);

test('all four edges and corners resize in both directions with opposite edges fixed', () => {
  const start = { left: 400, top: 200, width: 462, height: 402 };
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    for (const amount of [-60, 60]) {
      const p = layout.resize(1400, 900, start, edge, amount, amount);
      assert.equal(p.left, start.left + (edge.includes('w') ? amount : 0));
      assert.equal(p.top, start.top + (edge.includes('n') ? amount : 0));
      assert.equal(p.left + p.width, start.left + start.width + (edge.includes('e') ? amount : 0));
      assert.equal(p.top + p.height, start.top + start.height + (edge.includes('s') ? amount : 0));
    }
  }
});

test('resizing clamps extreme drags to minimum size and owner bounds', () => {
  for (const [width, height] of [[1400, 900], [300, 220]]) {
    const start = layout.place(width, height, null);
    for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      for (const amount of [-5000, 5000]) {
        const p = layout.resize(width, height, start, edge, amount, amount);
        assert.ok(p.width >= Math.min(322, width - 24) && p.height >= Math.min(262, height - 24));
        assert.ok(p.left >= 12 && p.top >= 12 && p.left + p.width <= width - 12 && p.top + p.height <= height - 12);
      }
    }
  }
});

test('right-column selection leaves a full-size panel on the left', () => {
  const anchor = layout.rect([820, 170, 1200, 400]);
  const p = layout.place(1400, 900, anchor);
  assert.equal(p.width, 462); assert.equal(p.height, 602);
  assert.ok(p.left + p.width <= anchor.left - 12);
});

test('left-column selection preserves a clear right-side position', () => {
  const anchor = layout.rect([120, 150, 600, 440]);
  const p = layout.place(1400, 900, anchor);
  assert.ok(p.left >= anchor.right + 12);
});

test('wide selections use free space above/below and resize when needed', () => {
  const anchor = layout.rect([30, 40, 960, 300]);
  const p = layout.place(1000, 900, anchor);
  assert.ok(p.top >= 312); assert.ok(p.height < 602); assert.ok(p.height >= 262);
});

test('an unobstructed user position is preserved and offscreen drags are clamped', () => {
  const p = layout.place(1400, 900, layout.rect([800, 400, 1200, 700]), { left: 40, top: 100 });
  assert.equal(p.left, 40); assert.equal(p.top, 100);
  const edge = layout.place(800, 700, null, { left: -200, top: 3000 });
  assert.ok(edge.left >= 12 && edge.top + edge.height <= 688);
});

test('crowded viewport reports that no nonoverlapping placement fits', () => {
  assert.equal(layout.place(700, 650, layout.rect([50, 80, 660, 580])), null);
});

test('placement never covers the selection or leaves the viewport across a range of sizes', () => {
  for (const width of [650, 900, 1400, 2200]) for (const height of [500, 900, 1400]) {
    for (let x = 0; x < width; x += 173) for (let y = 0; y < height; y += 211) {
      const anchor = layout.rect([x, y, Math.min(x + 340, width), Math.min(y + 150, height)]);
      const p = layout.place(width, height, anchor, { left: width * 0.6, top: 90 });
      if (!p) continue;
      assert.equal(layout.intersect(boxOf(p), anchor), null);
      assert.ok(p.left >= 12 && p.top >= 12 && p.left + p.width <= width - 12 && p.top + p.height <= height - 12);
    }
  }
});

test('selection coordinates cross nested frames with zoom, borders and clipping', () => {
  const owner = { innerWidth: 1400, innerHeight: 900 };
  const middle = { innerWidth: 600, innerHeight: 400,
    frameElement: { offsetWidth: 602, offsetHeight: 402, clientWidth: 600, clientHeight: 400, clientLeft: 1, clientTop: 1,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 1204, height: 804 }), ownerDocument: { defaultView: owner } } };
  const child = { innerWidth: 300, innerHeight: 200,
    frameElement: { clientWidth: 300, clientHeight: 200,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 200 }), ownerDocument: { defaultView: middle } } };
  const p = layout.toOwner([20, 10, 80, 60], child, owner);
  assert.equal(p.left, 162); assert.equal(p.top, 112);
  assert.equal(p.width, 120); assert.equal(p.height, 100);
  assert.equal(layout.toOwner([20, -300, 80, -100], child, owner), null);
});

test('Gecko content/chrome boundary uses only the matching reader browser', () => {
  const owner = { innerWidth: 1200, innerHeight: 800 };
  const content = { innerWidth: 1200, innerHeight: 720, frameElement: null };
  const reader = { contentWindow: { wrappedJSObject: content }, clientWidth: 1200, clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 80, width: 1200, height: 720 }), ownerDocument: { defaultView: owner } };
  const p = layout.toOwner([700, 200, 1100, 300], content, owner, reader);
  assert.equal(p.left, 700); assert.equal(p.top, 280);
  assert.equal(layout.toOwner([700, 200, 1100, 300], { ...content }, owner, reader), null);
});
