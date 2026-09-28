#!/usr/bin/env python3
"""Prepare an isolated Zotero profile and test-only harness, never a real library.

Usage: python3 scripts/native-smoke.py
Then run Zotero with the printed -profile path and inspect .dev/native-result.json.
The isolated test instance exits automatically after writing its report.
"""
import json
import subprocess
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
profile = root / '.dev' / 'zotero-test-profile'
extensions = profile / 'extensions'
extensions.mkdir(parents=True, exist_ok=True)
(profile / 'library').mkdir(exist_ok=True)
subprocess.run(['python3', str(root / 'scripts/build.py')], check=True)
(extensions / 'zotero-explain@local.xpi').write_bytes((root / ('dist/zotero-explain-' + json.loads((root / 'addon/manifest.json').read_text())['version'] + '.xpi')).read_bytes())
prefs = {
    'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
    'xpinstall.signatures.required': False,
    'extensions.logging.enabled': True,
    'browser.dom.window.dump.enabled': True,
    'devtools.console.stdout.chrome': True,
    'extensions.zotero.httpServer.port': 23129,
    'extensions.zotero.firstRun': False,
    'extensions.zotero.useDataDir': True,
    'extensions.zotero.dataDir': str(profile / 'library'),
    'extensions.zotero.sync.autoSync': False,
    'toolkit.telemetry.reportingpolicy.firstRun': False,
}
(profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k, v in prefs.items()))
harness = r'''
async function startup() {
  await Zotero.initializationPromise;
  setTimeout(async () => {
    const result = { version: Zotero.version, checks: [] };
    const record = (name, ok, detail = '') => result.checks.push({ name, ok: !!ok, detail });
    const restartFlag = 'extensions.zotero-explain.test.restartPending';
    const restarting = Services.prefs.getBoolPref(restartFlag, false);
    if (!restarting && Services.prefs.prefHasUserValue('extensions.zotero-explain.generation')) {
      Services.prefs.clearUserPref('extensions.zotero-explain.generation');
    }
    try {
      const win = Zotero.getMainWindow();
      let menu = win.document.getElementById('zotero-explain-menu');
      record('Tools menu', menu);
      if (!menu) throw new Error('Plugin did not initialize');
      const countWindows = () => {
        const windows = Services.wm.getEnumerator(null); let count = 0;
        while (windows.hasMoreElements()) { windows.getNext(); count++; }
        return count;
      };
      const windowsBefore = countWindows();
      win.fullScreen = true;
      await Zotero.Promise.delay(1200);
      menu.doCommand();
      await Zotero.Promise.delay(3500);
      let panel = win.document.getElementById('zotero-explain-frame')?.contentWindow;
      record('Embedded panel', panel);
      record('Reader remains fullscreen', win.fullScreen);
      record('Opening explanation creates no native window', countWindows() === windowsBefore);
      if (!panel) throw new Error('Panel did not open');
      const doc = panel.document;
      if (restarting) {
        result.phase = 'after-process-restart';
        record('Restart restores selected model', doc.getElementById('model').value === 'test-model');
        record('Restart restores selected effort', doc.getElementById('effort').value === 'high');
        record('Restart displays restored effort', doc.getElementById('effortLabel').textContent === '高');
        Services.prefs.clearUserPref(restartFlag); Services.prefs.savePrefFile(null);
        await IOUtils.writeUTF8(RESULT_PATH.replace('native-result.json', 'native-restart-result.json'), JSON.stringify(result, null, 2));
        Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); return;
      }
      record('App Server initialized', !doc.getElementById('login').disabled,
        doc.getElementById('accountState').textContent);
      record('Isolated signed-out account', doc.getElementById('accountState').textContent.includes('登录 ChatGPT 后'));
      record('No startup error', doc.getElementById('error').hidden, doc.getElementById('error').textContent);
      const item = new Zotero.Item('journalArticle');
      item.setField('title', 'Native test: understanding contrastive learning');
      await item.saveTx();
      const listener = Zotero.Reader._registeredListeners.find(x => x.pluginID === 'zotero-explain@local' && x.type === 'renderTextSelectionPopup');
      record('Reader listener', listener);
      let button;
      listener.handler({ reader: { itemID: item.id, _window: win }, doc: win.document,
        params: { annotation: { text: 'Contrastive learning pulls positive pairs together and pushes negative pairs apart.', pageLabel: '1' } }, append: value => { button = value; } });
      record('Selection action', button?.textContent.includes('ChatGPT'));
      button.click(); await Zotero.Promise.delay(200);
      record('Selected passage transferred', doc.getElementById('passage').value.startsWith('Contrastive learning'));
      record('Paper metadata transferred', doc.getElementById('paperTitle').textContent.includes('Native test'));
      record('Generation disabled until login', doc.getElementById('explain').disabled);
      result.panel = { width: panel.innerWidth, height: panel.innerHeight };
      record('Compact panel fits screen', panel.innerWidth === 460 && panel.innerHeight === 600);
      const host = win.document.getElementById('zotero-explain-panel');
      record('Panel lives inside reader window', panel.frameElement.ownerDocument === win.document);
      record('Panel has no opening animation', win.getComputedStyle(host).animationName === 'none');
      record('Default model is GPT-6 Sol', doc.getElementById('model').value === 'gpt-6-sol');
      record('Default layout fits without horizontal scroll', doc.documentElement.scrollWidth === panel.innerWidth);
      record('Current compact stylesheet loaded', panel.getComputedStyle(doc.querySelector('.toolbar')).height === '44px');
      record('Default layout needs no outer scrolling', doc.querySelector('main').scrollHeight <= doc.querySelector('main').clientHeight + 1);
      // Synthetic selection geometry exercises native frame positioning and drag handlers.
      let selectionBox = [win.innerWidth - 380, 160, win.innerWidth - 40, 450];
      const geometryReader = { itemID: item.id, _window: win, _internalReader: { _primaryView: {
        _iframeWindow: win, getClientRectForPopup: () => selectionBox,
      } } };
      const chooseGeometry = text => {
        let action;
        listener.handler({ reader: geometryReader, doc: win.document,
          params: { annotation: { text, position: { pageIndex: 0, rects: [[1, 1, 2, 2]] } } }, append: value => { action = value; } });
        action.click();
      };
      chooseGeometry('Right column'); await Zotero.Promise.delay(50);
      record('Geometry: right selection stays visible', host.getBoundingClientRect().right <= selectionBox[0] - 12);
      selectionBox = [30, 160, 380, 450]; chooseGeometry('Left column'); await Zotero.Promise.delay(50);
      record('Geometry: left selection stays visible', host.getBoundingClientRect().left >= selectionBox[2] + 12);
      const titlebar = doc.querySelector('.toolbar');
      const beforeDrag = host.getBoundingClientRect();
      titlebar.dispatchEvent(new panel.PointerEvent('pointerdown', { button: 0, pointerId: 11, screenX: 1000, screenY: 200, bubbles: true }));
      titlebar.dispatchEvent(new panel.PointerEvent('pointermove', { pointerId: 11, screenX: 950, screenY: 250, bubbles: true }));
      titlebar.dispatchEvent(new panel.PointerEvent('pointerup', { pointerId: 11, bubbles: true }));
      const afterDrag = host.getBoundingClientRect();
      record('Native titlebar drag moves panel', afterDrag.left !== beforeDrag.left || afterDrag.top !== beforeDrag.top);
      record('Dragging preserves selection visibility and fullscreen', afterDrag.left >= selectionBox[2] + 12 && win.fullScreen);
      titlebar.dispatchEvent(new panel.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      record('Keyboard can move titlebar', host.getBoundingClientRect().top > afterDrag.top);
      const beforeCrossing = host.getBoundingClientRect();
      titlebar.dispatchEvent(new panel.PointerEvent('pointerdown', { button: 0, pointerId: 12, screenX: 1000, screenY: 200, bubbles: true }));
      titlebar.dispatchEvent(new panel.PointerEvent('pointermove', { pointerId: 12, screenX: 1000 + 30 - beforeCrossing.left, screenY: 200, bubbles: true }));
      titlebar.dispatchEvent(new panel.PointerEvent('pointerup', { pointerId: 12, bubbles: true }));
      record('Manual drag can cross selected text to the left', Math.abs(host.getBoundingClientRect().left - 30) <= 1);
      win.dispatchEvent(new win.Event('scroll')); win.dispatchEvent(new win.Event('resize'));
      await Zotero.Promise.delay(100);
      record('Scroll and resize preserve manual placement', Math.abs(host.getBoundingClientRect().left - 30) <= 1);
      chooseGeometry('New left selection'); await Zotero.Promise.delay(50);
      record('New selection resumes automatic avoidance', host.getBoundingClientRect().left >= selectionBox[2] + 12);
      // A separately labelled fake backend checks the real native UI without an account.
      const bridge = panel.frameElement.ZEBridge;
      const realStart = bridge.platform.start;
      const mockCalls = [];
      let mockAccount = true, turnNumber = 0, threadDelay = 0;
      const mock = new bridge.core.RPC(line => {
        const request = JSON.parse(line); mockCalls.push(request);
        if (!request.id) return;
        let value = {};
        if (request.method === 'account/read') value = { account: mockAccount ? { type: 'chatgpt', email: 'ui-test@example.invalid', planType: 'test' } : null };
        if (request.method === 'account/logout') mockAccount = false;
        if (request.method === 'model/list') value = { data: [{ model: 'gpt-6-sol', displayName: 'GPT-6 Sol', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }, { model: 'test-model', displayName: '测试模型', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] };
        if (request.method === 'thread/start') {
          value = { thread: { id: 'mock-thread' } };
          if (threadDelay) {
            setTimeout(() => mock.feed(JSON.stringify({ id: request.id, result: value }) + '\n'), threadDelay);
            return;
          }
        }
        if (request.method === 'turn/start') {
          const id = 'mock-turn-' + (++turnNumber);
          value = { turn: { id } };
          setTimeout(() => {
            mock.feed(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'mock-thread', turnId: id, itemId: id, delta: '示例解释：正样本对在表示空间中更接近。' } }) + '\n');
            mock.feed(JSON.stringify({ method: 'item/completed', params: { threadId: 'mock-thread', turnId: id, item: { id, type: 'agentMessage', text: '示例解释：正样本对在表示空间中更接近。\n<img src=x onerror="alert(1)"> 这是纯文本。' } } }) + '\n');
            mock.feed(JSON.stringify({ method: 'turn/completed', params: { threadId: 'mock-thread', turn: { id, status: 'completed' } } }) + '\n');
          }, 60);
        }
        mock.feed(JSON.stringify({ id: request.id, result: value }) + '\n');
      });
      bridge.platform.start = async () => mock;
      try {
        doc.getElementById('reconnect').click(); await Zotero.Promise.delay(250);
        record('Mock UI: logged-in state', !doc.getElementById('explain').disabled);
        record('Mock UI: model list without duplicates', doc.querySelectorAll('#modelMenu .model-option').length === 2);
        doc.getElementById('modelToggle').click();
        record('Mock UI: model menu opens', !doc.getElementById('modelMenu').hidden);
        doc.querySelector('[data-model="test-model"]').click();
        record('Mock UI: model selection updates label and value', doc.getElementById('model').value === 'test-model' && doc.getElementById('modelLabel').textContent === '测试模型' && doc.getElementById('modelMenu').hidden);
        record('Mock UI: model compatibility adjusts effort', doc.getElementById('effort').value === 'high' && doc.getElementById('effortLabel').textContent === '高');
        record('Mock UI: model and effort saved together', bridge.platform.getGenerationSettings().model === 'test-model' && bridge.platform.getGenerationSettings().effort === 'high');
        doc.getElementById('modelToggle').click();
        doc.querySelector('[data-model="gpt-6-sol"]').click();
        doc.getElementById('effortToggle').click();
        record('Mock UI: effort menu opens with model capabilities', !doc.getElementById('effortMenu').hidden && doc.querySelectorAll('#effortMenu .model-option').length === 3);
        doc.querySelector('[data-effort="medium"]').click();
        record('Mock UI: effort selection updates label and persists', doc.getElementById('effortLabel').textContent === '中等' && bridge.platform.getGenerationSettings().effort === 'medium' && doc.getElementById('effortMenu').hidden);
        doc.getElementById('explain').click(); await Zotero.Promise.delay(250);
        record('Mock UI: requested default model and medium effort', mockCalls.find(x => x.method === 'thread/start')?.params.model === 'gpt-6-sol' && mockCalls.find(x => x.method === 'turn/start')?.params.effort === 'medium');
        record('Mock UI: streamed explanation', doc.getElementById('messages').textContent.includes('正样本对'));
        record('Mock UI: text is not executable HTML', !doc.getElementById('messages').querySelector('img') && doc.getElementById('messages').textContent.includes('<img'));
        record('Mock UI: followup enabled', !doc.getElementById('send').disabled);
        doc.getElementById('modelToggle').click(); doc.querySelector('[data-model="test-model"]').click();
        doc.getElementById('followup').value = '可以举个例子吗？';
        doc.getElementById('send').click(); await Zotero.Promise.delay(250);
        record('Mock UI: conversation reused for followup', mockCalls.filter(x => x.method === 'thread/start').length === 1 && mockCalls.filter(x => x.method === 'turn/start').length === 2);
        record('Mock UI: changed model applies to followup', mockCalls.filter(x => x.method === 'turn/start').at(-1)?.params.model === 'test-model');
        record('Mock UI: changed effort applies to followup', mockCalls.filter(x => x.method === 'turn/start').at(-1)?.params.effort === 'high');
        record('Mock UI: generation recovered idle state', !doc.getElementById('explain').disabled && doc.getElementById('stop').hidden);
        threadDelay = 160;
        const previousTurns = turnNumber;
        doc.getElementById('explain').click(); await Zotero.Promise.delay(25);
        doc.getElementById('stop').click(); await Zotero.Promise.delay(250);
        record('Mock UI: stopping during thread creation prevents generation', turnNumber === previousTurns);
        record('Mock UI: stopped startup restores controls', !doc.getElementById('explain').disabled && doc.getElementById('stop').hidden);
        doc.getElementById('explain').click(); await Zotero.Promise.delay(25);
        await panel.ZEPanel.select({ text: 'A new sentence selected while creating a session.', title: 'New paper' });
        await Zotero.Promise.delay(250);
        record('Mock UI: new selection prevents stale generation', turnNumber === previousTurns && doc.getElementById('passage').value.startsWith('A new sentence'));
        threadDelay = 0;
        doc.getElementById('logout').click(); await Zotero.Promise.delay(250);
        record('Mock UI: logout gates requests', doc.getElementById('explain').disabled);
        record('Mock UI: logout retains generation preferences', bridge.platform.getGenerationSettings().model === 'test-model' && bridge.platform.getGenerationSettings().effort === 'high');
      } finally {
        bridge.platform.start = realStart;
        doc.getElementById('reconnect').click(); await Zotero.Promise.delay(1500);
        mock.close();
        await panel.ZEPanel.select({ text: 'Contrastive learning pulls positive pairs together and pushes negative pairs apart.', title: 'Native test: understanding contrastive learning', page: '1' });
      }
      const realRPC = await bridge.platform.start();
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID('zotero-explain@local');
      await addon.disable(); await Zotero.Promise.delay(500);
      record('Disable cleanup: menu removed', !win.document.getElementById('zotero-explain-menu'));
      record('Disable cleanup: reader listener removed', !Zotero.Reader._registeredListeners.some(x => x.pluginID === 'zotero-explain@local'));
      record('Disable cleanup: panel removed', !win.document.getElementById('zotero-explain-panel'));
      record('Disable cleanup: transport closed', realRPC.closed);
      await addon.enable(); await Zotero.Promise.delay(300);
      record('Re-enable restores plugin', win.document.getElementById('zotero-explain-menu'));
      win.document.getElementById('zotero-explain-menu').doCommand();
      await Zotero.Promise.delay(800);
      let reopened = win.document.getElementById('zotero-explain-frame')?.contentWindow;
      record('Reopen restores selected model', reopened?.document.getElementById('model').value === 'test-model');
      record('Reopen restores selected effort', reopened?.document.getElementById('effort').value === 'high');
      reopened.document.getElementById('close').click();
      record('Close button removes only the panel', !win.document.getElementById('zotero-explain-panel') && !win.closed && win.fullScreen);
      const reserve = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      reserve.style.cssText = 'position:fixed;left:30px;top:120px;width:800px;height:600px;display:flex';
      const browser = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'iframe');
      browser.style.cssText = 'flex:1;min-width:0;border:0;margin-right:9px';
      reserve.append(browser); win.document.documentElement.append(reserve);
      geometryReader._iframe = browser;
      selectionBox = [0, 0, win.innerWidth, win.innerHeight];
      const originalMargin = browser.style.marginRight;
      const beforeReserve = browser.getBoundingClientRect().width;
      // Refresh listener after disabling/re-enabling the addon.
      const newListener = Zotero.Reader._registeredListeners.find(x => x.pluginID === 'zotero-explain@local' && x.type === 'renderTextSelectionPopup');
      let reserveAction;
      newListener.handler({ reader: geometryReader, doc: win.document,
        params: { annotation: { text: 'Crowded viewport', position: { pageIndex: 0, rects: [[1, 1, 2, 2]] } } }, append: value => { reserveAction = value; } });
      reserveAction.click(); await Zotero.Promise.delay(500);
      const reservedHost = win.document.getElementById('zotero-explain-panel');
      record('Crowded layout reserves reader space', browser.getBoundingClientRect().width < beforeReserve);
      record('Reserved panel does not overlay reader', reservedHost.getBoundingClientRect().left >= browser.getBoundingClientRect().right);
      const dockedBridge = win.document.getElementById('zotero-explain-frame').ZEBridge;
      const dockedBox = reservedHost.getBoundingClientRect();
      dockedBridge.beginMove({ x: 1000, y: 200 });
      dockedBridge.move({ x: 1000 + 30 - dockedBox.left, y: 200 }); dockedBridge.endMove();
      record('Docked panel can be dragged to the left', Math.abs(reservedHost.getBoundingClientRect().left - 30) <= 1);
      record('Undocking restores reader and preserves panel size', browser.style.marginRight === originalMargin && reservedHost.getBoundingClientRect().width === dockedBox.width);
      win.dispatchEvent(new win.Event('scroll')); await Zotero.Promise.delay(100);
      record('Scrolling does not redock a manually moved panel', browser.style.marginRight === originalMargin && Math.abs(reservedHost.getBoundingClientRect().left - 30) <= 1);
      win.document.getElementById('zotero-explain-frame').contentWindow.document.getElementById('close').click();
      record('Closing restores original reader margin', browser.style.marginRight === originalMargin);
      reserve.remove();
      menu = win.document.getElementById('zotero-explain-menu');
      menu.doCommand(); await Zotero.Promise.delay(500);
      reopened = win.document.getElementById('zotero-explain-frame')?.contentWindow;
      reopened.document.dispatchEvent(new reopened.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      record('Escape closes panel and preserves fullscreen', !win.document.getElementById('zotero-explain-panel') && win.fullScreen);
      menu.doCommand(); await Zotero.Promise.delay(500);
      reopened = win.document.getElementById('zotero-explain-frame')?.contentWindow;
      reopened.document.dispatchEvent(new reopened.KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true, cancelable: true }));
      record('Cmd-W closes only the panel', !win.document.getElementById('zotero-explain-panel') && !win.closed && win.fullScreen);
      win.fullScreen = false; await Zotero.Promise.delay(1200);
      menu.doCommand(); await Zotero.Promise.delay(500);
      record('Windowed mode also embeds without a native window', !!win.document.getElementById('zotero-explain-frame') && !win.fullScreen && countWindows() === windowsBefore);
      Services.prefs.setBoolPref(restartFlag, true); Services.prefs.savePrefFile(null);
    } catch (error) { result.error = error.message + '\n' + error.stack; }
    await IOUtils.writeUTF8(RESULT_PATH, JSON.stringify(result, null, 2));
    Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }, 5000);
}
function install() {}
function shutdown() {}
function uninstall() {}
'''.replace('RESULT_PATH', json.dumps(str(root / '.dev/native-result.json')))
with ZipFile(extensions / 'zotero-explain-test@local.xpi', 'w') as archive:
    archive.writestr('manifest.json', json.dumps({
        'manifest_version': 2, 'name': 'Zotero Explain isolated smoke harness', 'version': '0.1',
        'applications': {'zotero': {'id': 'zotero-explain-test@local', 'update_url': 'https://zotero-explain.invalid/test-updates.json', 'strict_min_version': '10.0', 'strict_max_version': '10.0.*'}},
    }))
    archive.writestr('bootstrap.js', harness)
print(f'Prepared isolated profile: {profile}')
