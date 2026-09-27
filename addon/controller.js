var ZEController = (() => {
  "use strict";
  let panel = null, current = null, handler = null;
  function paper(reader, annotation) {
    const attachment = Zotero.Items.get(reader.itemID);
    const parent = attachment?.parentItemID ? Zotero.Items.get(attachment.parentItemID) : attachment;
    return { text: annotation?.text || "", title: parent?.getField("title") || "",
      page: annotation?.pageLabel || "" };
  }
  function open(selection = null) {
    if (selection) current = selection;
    if (panel && !panel.closed) {
      panel.focus(); if (selection) panel.ZEPanel?.select(selection);
      return;
    }
    const parent = Zotero.getMainWindow();
    panel = parent.openDialog("chrome://zotero-explain/content/panel.xhtml", "zotero-explain-panel",
      "chrome,dialog=yes,dependent,close=yes,titlebar=yes,minimizable=no,resizable=no,suppressanimation=yes,centerscreen,width=460,height=600", {
        core: ZECore, platform: ZEPlatform, selection: current,
      });
  }
  function addMenu(window) {
    const doc = window.document;
    if (doc.getElementById("zotero-explain-menu")) return;
    const menu = doc.createXULElement("menuitem");
    menu.id = "zotero-explain-menu";
    menu.setAttribute("label", "论文解释 · ChatGPT");
    menu.addEventListener("command", () => open());
    doc.getElementById("menu_ToolsPopup")?.appendChild(menu);
  }
  function removeMenu(window) { window.document.getElementById("zotero-explain-menu")?.remove(); }
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
        button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); open(selection); });
        append(button);
      };
      Zotero.Reader.registerEventListener("renderTextSelectionPopup", handler, id);
    },
    async shutdown() {
      if (handler) Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", handler);
      for (const window of Zotero.getMainWindows()) removeMenu(window);
      if (panel && !panel.closed) panel.close();
      panel = null; current = null;
    },
  };
})();
