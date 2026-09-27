var ZECore, ZEPlatform, ZEController;
var chromeHandle;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  const startupService = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = startupService.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
    ["content", "zotero-explain", rootURI],
  ]);
  for (const file of ["core.js", "platform.js", "controller.js"]) {
    Services.scriptloader.loadSubScript(rootURI + file);
  }
  ZEController.init(id);
  for (const window of Zotero.getMainWindows()) ZEController.addMenu(window);
}
function onMainWindowLoad({ window }) { ZEController?.addMenu(window); }
function onMainWindowUnload({ window }) { ZEController?.removeMenu(window); }
async function shutdown() {
  await ZEController?.shutdown();
  await ZEPlatform?.stop(true);
  chromeHandle?.destruct();
  ZEController = ZEPlatform = ZECore = undefined;
}
function install() {}
function uninstall() {}
