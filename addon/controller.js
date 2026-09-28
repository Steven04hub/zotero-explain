var ZEController = (() => {
  "use strict";
  let panel = null, current = null, handler = null;
  const htmlNS = "http://www.w3.org/1999/xhtml";
  function sourceFor(reader, annotation, owner) {
    const internal = reader._internalReader;
    const view = internal?._lastViewPrimary === false ? internal._secondaryView : internal?._primaryView;
    const sourceWindow = view?._iframeWindow;
    return { reader, sourceWindow, key: JSON.stringify([annotation.position, annotation.text]),
      anchor() {
        try {
          const position = annotation.position;
          let boxes = [];
          if (position && view?.getClientRectForPopup) {
            const { nextPageRects, ...first } = position;
            // Content cannot read objects created in the privileged plugin scope.
            const popupRect = data => view.getClientRectForPopup(typeof Components !== "undefined"
              ? Components.utils.cloneInto(data, sourceWindow) : data);
            boxes.push(popupRect(first));
            if (nextPageRects) boxes.push(popupRect({ pageIndex: position.pageIndex + 1, rects: nextPageRects }));
          } else {
            const range = position && view?.toDisplayedRange?.(position);
            if (range) boxes.push(range.getBoundingClientRect());
          }
          boxes = boxes.map(box => ZELayout.toOwner(box, sourceWindow, owner, reader._iframe)).filter(Boolean);
          if (boxes.length) return ZELayout.rect([Math.min(...boxes.map(b => b.left)), Math.min(...boxes.map(b => b.top)),
            Math.max(...boxes.map(b => b.right)), Math.max(...boxes.map(b => b.bottom))]);
        } catch (_) {}
        return null;
      },
    };
  }
  function restoreReader(entry) {
    if (entry.dock) {
      entry.dock.browser.style.marginRight = entry.dock.margin;
      entry.dock = null;
    }
  }
  function position(entry, preferred = entry.preferred) {
    if (panel !== entry) return;
    const { owner, host } = entry;
    let box;
    const anchor = entry.source?.anchor();
    if (!entry.dock) box = ZELayout.place(owner.innerWidth, owner.innerHeight, anchor, preferred);
    // If selection geometry is unavailable, use reserved space instead of guessing.
    if ((!box || (entry.source?.reader._iframe && !anchor)) && !entry.dock) {
      const browser = entry.source?.reader._iframe;
      if (browser?.isConnected) {
        const before = browser.getBoundingClientRect();
        const width = Math.min(462, Math.max(250, before.width * 0.45));
        entry.dock = { browser, margin: browser.style.marginRight, width };
        const margin = parseFloat(owner.getComputedStyle(browser).marginRight) || 0;
        browser.style.marginRight = `${margin + width + 16}px`;
      }
    }
    if (entry.dock) {
      const reader = entry.dock.browser.getBoundingClientRect();
      const height = Math.min(602, owner.innerHeight - Math.max(12, reader.top) - 12);
      const top = Math.max(Math.max(12, reader.top), Math.min(preferred?.top ?? reader.top, owner.innerHeight - height - 12));
      box = { left: reader.right + 12, top, width: entry.dock.width, height };
    }
    box ||= ZELayout.place(owner.innerWidth, owner.innerHeight, null, preferred);
    if (!box) return;
    Object.assign(host.style, { left: `${box.left}px`, top: `${box.top}px`, right: "auto",
      width: `${box.width}px`, height: `${box.height}px` });
  }
  function watchSelection(entry, source) {
    if (source && entry.source?.reader === source.reader && entry.source?.key === source.key
      && entry.source?.sourceWindow === source.sourceWindow) return;
    entry.unwatch?.(); restoreReader(entry);
    entry.source = source;
    const target = source?.sourceWindow;
    const changed = () => {
      if (entry.pendingFrame) return;
      entry.pendingFrame = entry.owner.requestAnimationFrame(() => {
        entry.pendingFrame = null; position(entry);
      });
    };
    target?.addEventListener("scroll", changed, true);
    target?.addEventListener("resize", changed);
    entry.unwatch = () => {
      target?.removeEventListener("scroll", changed, true);
      target?.removeEventListener("resize", changed);
    };
  }
  function paper(reader, annotation) {
    const attachment = Zotero.Items.get(reader.itemID);
    const parent = attachment?.parentItemID ? Zotero.Items.get(attachment.parentItemID) : attachment;
    return { text: annotation?.text || "", title: parent?.getField("title") || "",
      page: annotation?.pageLabel || "" };
  }
  function close(restoreFocus = true) {
    if (!panel) return;
    const old = panel; panel = null;
    old.owner.removeEventListener("unload", old.onUnload);
    old.owner.removeEventListener("resize", old.onResize);
    if (old.pendingFrame) old.owner.cancelAnimationFrame(old.pendingFrame);
    old.unwatch?.(); restoreReader(old);
    old.frame.contentWindow?.ZEPanel?.dispose();
    old.host.remove();
    if (restoreFocus && !old.owner.closed) old.previousFocus?.focus();
  }
  function open(selection = null, owner = Zotero.getMainWindow(), source = null) {
    if (selection) current = selection;
    if (!owner || owner.closed) return;
    if (panel?.owner === owner && panel.host.isConnected) {
      if (selection) {
        watchSelection(panel, source); position(panel);
        panel.frame.ZEBridge.selection = selection;
        panel.frame.contentWindow?.ZEPanel?.select(selection);
      }
      panel.frame.contentWindow?.focus();
      return;
    }
    close(false);
    const doc = owner.document;
    const host = doc.createElementNS(htmlNS, "div");
    host.id = "zotero-explain-panel";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-label", "论文解释");
    // An in-document panel stays in the reader's macOS fullscreen Space.
    // Do not create/focus a separate native window or change owner.fullScreen.
    host.style.cssText = "position:fixed;z-index:2147483647;border:1px solid #80808050;border-radius:14px;overflow:hidden;box-shadow:0 12px 42px #0003;background:Canvas;color-scheme:light dark;animation:none;transition:none;box-sizing:border-box";
    const frame = doc.createElementNS(htmlNS, "iframe");
    frame.id = "zotero-explain-frame";
    frame.setAttribute("title", "论文解释 · ChatGPT");
    frame.style.cssText = "display:block;border:0;width:100%;height:100%";
    const entry = { owner, host, frame, previousFocus: doc.activeElement,
      onResize: () => position(entry),
      onUnload: () => { if (panel === entry) close(false); } };
    frame.ZEBridge = { core: ZECore, platform: ZEPlatform, selection: current,
      beginMove(point) {
        const box = host.getBoundingClientRect();
        entry.drag = { x: point.x, y: point.y, left: box.left, top: box.top };
      },
      move(point) {
        if (panel !== entry || !entry.drag) return;
        const desired = { left: entry.drag.left + point.x - entry.drag.x, top: entry.drag.top + point.y - entry.drag.y };
        if (entry.dock) restoreReader(entry);
        entry.preferred = desired; position(entry, desired);
      },
      endMove() { entry.drag = null; },
      close: () => { if (panel === entry) close(); } };
    frame.addEventListener("load", () => {
      if (panel === entry) frame.contentWindow.focus();
    }, { once: true });
    frame.src = "chrome://zotero-explain/content/panel.xhtml?v=0.3.3";
    host.appendChild(frame);
    panel = entry;
    owner.addEventListener("unload", entry.onUnload, { once: true });
    owner.addEventListener("resize", entry.onResize);
    doc.documentElement.appendChild(host);
    watchSelection(entry, source); position(entry);
  }
  function addMenu(window) {
    const doc = window.document;
    if (doc.getElementById("zotero-explain-menu")) return;
    const menu = doc.createXULElement("menuitem");
    menu.id = "zotero-explain-menu";
    menu.setAttribute("label", "论文解释 · ChatGPT");
    menu.addEventListener("command", () => open(null, window));
    doc.getElementById("menu_ToolsPopup")?.appendChild(menu);
  }
  function removeMenu(window) {
    window.document.getElementById("zotero-explain-menu")?.remove();
    if (panel?.owner === window) close(false);
  }
  return { open, addMenu, removeMenu,
    init(id) {
      // Remove callbacks left behind by earlier hot upgrades before registering ours.
      for (const old of [...(Zotero.Reader._registeredListeners || [])]) {
        if (old.pluginID === id && old.type === "renderTextSelectionPopup") {
          Zotero.Reader.unregisterEventListener(old.type, old.handler);
        }
      }
      handler = ({ reader, doc, params, append }) => {
        if (!params.annotation?.text?.trim()) return;
        const selection = paper(reader, params.annotation);
        const owner = reader._window || doc.defaultView?.top || Zotero.getMainWindow();
        const source = sourceFor(reader, params.annotation, owner);
        // Move an already-open panel out of the new selection before the user clicks Explain.
        if (panel?.owner === owner) { watchSelection(panel, source); position(panel); }
        const button = doc.createElement("button");
        button.textContent = "✦  用 ChatGPT 解释";
        button.title = "解释选中的句子（使用 ChatGPT 账号的 Codex 额度）";
        button.style.cssText = "display:block;width:100%;margin-top:6px;padding:7px 10px;border:0;border-radius:9px;background:AccentColor;color:AccentColorText;cursor:pointer;font:inherit";
        button.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
        button.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          // A PDF can be in a tab or a separate reader window; keep its actual owner.
          open(selection, owner, source);
        });
        append(button);
      };
      Zotero.Reader.registerEventListener("renderTextSelectionPopup", handler, id);
    },
    async shutdown() {
      if (handler) Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", handler);
      for (const window of Zotero.getMainWindows()) removeMenu(window);
      close(false); current = null;
    },
  };
})();
