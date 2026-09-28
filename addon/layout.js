var ZELayout = (() => {
  "use strict";
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  function rect(value) {
    if (!value) return null;
    const [left, top, right, bottom] = Array.isArray(value)
      ? value : [value.left, value.top, value.right, value.bottom];
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function intersect(a, b) {
    return rect([Math.max(a.left, b.left), Math.max(a.top, b.top), Math.min(a.right, b.right), Math.min(a.bottom, b.bottom)]);
  }
  function place(width, height, anchor, preferred, size = { width: 462, height: 602 }) {
    const bounds = rect([12, 12, width - 12, height - 12]);
    if (!bounds) return null;
    const w = Math.min(size.width, bounds.width), h = Math.min(size.height, bounds.height);
    const desired = preferred || { left: bounds.right - w, top: Math.min(72, bounds.bottom - h) };
    const blocked = anchor && intersect(bounds, rect([anchor.left - 12, anchor.top - 12, anchor.right + 12, anchor.bottom + 12]));
    const fit = (area, fw, fh) => ({ left: clamp(desired.left, area.left, area.right - fw),
      top: clamp(desired.top, area.top, area.bottom - fh), width: fw, height: fh });
    const initial = fit(bounds, w, h);
    if (!blocked || !intersect(rect([initial.left, initial.top, initial.left + w, initial.top + h]), blocked)) return initial;
    const areas = [
      rect([bounds.left, bounds.top, blocked.left, bounds.bottom]),
      rect([blocked.right, bounds.top, bounds.right, bounds.bottom]),
      rect([bounds.left, bounds.top, bounds.right, blocked.top]),
      rect([bounds.left, blocked.bottom, bounds.right, bounds.bottom]),
    ].filter(Boolean);
    const candidates = areas.filter(a => a.width >= Math.min(322, w) && a.height >= Math.min(262, h))
      .map(a => fit(a, Math.min(w, a.width), Math.min(h, a.height)));
    // Prefer a full-size panel, then the closest unobstructed position to the drag/default.
    const score = p => (w * h - p.width * p.height) * 100
      + Math.hypot(p.left - desired.left, p.top - desired.top);
    candidates.sort((a, b) => score(a) - score(b));
    return candidates[0] || null;
  }
  function resize(width, height, start, edge, dx, dy) {
    const base = place(width, height, null, start, start);
    if (!base) return null;
    let { left, top } = base;
    let right = left + base.width, bottom = top + base.height;
    // The opposite edge stays anchored. Small owner windows take precedence
    // over the normal minimum size, so every handle remains reachable.
    if (edge.includes("w")) left = clamp(left + dx, 12, right - Math.min(322, right - 12));
    if (edge.includes("e")) right = clamp(right + dx, left + Math.min(322, width - 12 - left), width - 12);
    if (edge.includes("n")) top = clamp(top + dy, 12, bottom - Math.min(262, bottom - 12));
    if (edge.includes("s")) bottom = clamp(bottom + dy, top + Math.min(262, height - 12 - top), height - 12);
    return { left, top, width: right - left, height: bottom - top };
  }
  function toOwner(value, source, owner, readerFrame = null) {
    let result = rect(value);
    for (let depth = 0; result && source && depth < 8; depth++) {
      result = intersect(result, rect([0, 0, source.innerWidth, source.innerHeight]));
      if (!result || source === owner) return result;
      let frame = source.frameElement || source.browsingContext?.embedderElement;
      // Gecko hides frameElement at the content/chrome boundary. The reader's
      // known browser is the embedding element for that specific content window.
      if (!frame && readerFrame && (source === readerFrame.contentWindow
        || source === readerFrame.contentWindow?.wrappedJSObject)) frame = readerFrame;
      if (!frame) return null;
      const box = frame.getBoundingClientRect();
      const outerX = box.width / (frame.offsetWidth || box.width);
      const outerY = box.height / (frame.offsetHeight || box.height);
      const sx = outerX * ((frame.clientWidth || source.innerWidth) / source.innerWidth);
      const sy = outerY * ((frame.clientHeight || source.innerHeight) / source.innerHeight);
      const x = box.left + (frame.clientLeft || 0) * outerX, y = box.top + (frame.clientTop || 0) * outerY;
      result = rect([x + result.left * sx, y + result.top * sy, x + result.right * sx, y + result.bottom * sy]);
      source = frame.ownerDocument.defaultView;
    }
    return null;
  }
  return { rect, intersect, place, resize, toOwner };
})();
