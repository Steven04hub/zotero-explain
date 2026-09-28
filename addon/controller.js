var ZEController = (() => {
  "use strict";
  let panel = null, current = null, handler = null;
  const htmlNS = "http://www.w3.org/1999/xhtml";
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
    old.frame.contentWindow?.ZEPanel?.dispose();
    old.host.remove();
    if (restoreFocus && !old.owner.closed) old.previousFocus?.focus();
  }
  function open(selection = null, owner = Zotero.getMainWindow()) {
    if (selection) current = selection;
    if (!owner || owner.closed) return;
    if (panel?.owner === owner && panel.host.isConnected) {
      if (selection) {
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
    host.style.cssText = "position:fixed;z-index:2147483647;right:16px;top:min(72px,10vh);width:min(460px,calc(100vw - 32px));height:min(600px,calc(90vh - 16px));border:1px solid #80808050;border-radius:14px;overflow:hidden;box-shadow:0 12px 42px #0003;background:Canvas;color-scheme:light dark;animation:none;transition:none;box-sizing:content-box";
    const frame = doc.createElementNS(htmlNS, "iframe");
    frame.id = "zotero-explain-frame";
    frame.setAttribute("title", "论文解释 · ChatGPT");
    frame.style.cssText = "display:block;border:0;width:100%;height:100%";
    const entry = { owner, host, frame, previousFocus: doc.activeElement,
      onUnload: () => { if (panel === entry) close(false); } };
    frame.ZEBridge = { core: ZECore, platform: ZEPlatform, selection: current,
      close: () => { if (panel === entry) close(); } };
    frame.addEventListener("load", () => {
      if (panel === entry) frame.contentWindow.focus();
    }, { once: true });
    frame.src = "chrome://zotero-explain/content/panel.xhtml";
    host.appendChild(frame);
    panel = entry;
    owner.addEventListener("unload", entry.onUnload, { once: true });
    doc.documentElement.appendChild(host);
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
      handler = ({ reader, doc, params, append }) => {
        if (!params.annotation?.text?.trim()) return;
        const selection = paper(reader, params.annotation);
        const button = doc.createElement("button");
        button.textContent = "✦  用 ChatGPT 解释";
        button.title = "解释选中的句子（使用 ChatGPT 账号的 Codex 额度）";
        button.style.cssText = "display:block;width:100%;margin-top:6px;padding:7px 10px;border:0;border-radius:9px;background:AccentColor;color:AccentColorText;cursor:pointer;font:inherit";
        button.addEventListener("mousedown", event => { event.preventDefault(); event.stopPropagation(); });
        button.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          // A PDF can be in a tab or a separate reader window; keep its actual owner.
          open(selection, reader._window || doc.defaultView?.top || Zotero.getMainWindow());
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
