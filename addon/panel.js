"use strict";
var ZEPanel;
window.addEventListener("DOMContentLoaded", () => {
  const { core, platform, selection, close: closePanel } = window.frameElement.ZEBridge;
  const $ = id => document.getElementById(id);
  let rpc = null, off = null, account = null, loginID = null;
  let conversation = null, busy = false, connecting = false, epoch = 0, title = "", lastAnswer = "";
  let disposed = false, accountRevision = 0;
  const saved = platform.getGenerationSettings();
  $("model").value = saved.model; $("effort").value = saved.effort;
  const modelName = model => model.model === core.DEFAULT_MODEL ? "GPT-6 Sol" : model.displayName || model.model;
  let availableModels = [{ model: saved.model }];
  const selectedModel = () => availableModels.find(model => model.model === $("model").value);
  const effortLabel = () => core.EFFORT_LABELS[$("effort").value] || $("effort").value;
  const showError = error => { if (disposed) return; $("error").textContent = error?.message || String(error); $("error").hidden = false; };
  const clearError = () => { $("error").hidden = true; $("error").textContent = ""; };
  function update() {
    if (disposed) return;
    $("login").hidden = !!account || !!loginID;
    $("login").disabled = !rpc || connecting;
    $("cancelLogin").hidden = !loginID;
    $("logout").hidden = !account;
    $("logout").disabled = busy || connecting;
    $("reconnect").disabled = busy || connecting || !!loginID;
    $("savePath").disabled = busy || connecting || !!loginID;
    $("explain").disabled = busy || connecting || !account || !!selectedModel()?.unavailable;
    $("stop").hidden = !busy;
    $("modelToggle").disabled = busy || connecting;
    $("effortToggle").disabled = busy || connecting || !!selectedModel()?.unavailable;
    if (busy || connecting) closeMenus();
    $("followup").disabled = busy || connecting || !conversation?.threadID || !account || !!selectedModel()?.unavailable;
    $("send").disabled = $("followup").disabled;
    $("copy").disabled = !lastAnswer;
    $("passage").disabled = busy;
    $("context").disabled = busy;
  }
  function saveChoices() {
    try { platform.setGenerationSettings({ model: $("model").value, effort: $("effort").value }); }
    catch (error) { showError(new Error("无法保存选择，下次启动可能无法恢复。" + error.message)); }
  }
  function closeMenu(kind, restoreFocus = false) {
    $(kind + "Menu").hidden = true;
    $(kind + "Toggle").setAttribute("aria-expanded", "false");
    if (restoreFocus) $(kind + "Toggle").focus();
  }
  function closeMenus() { closeMenu("model"); closeMenu("effort"); }
  function reconcileEffort() {
    const previous = $("effort").value;
    const next = core.compatibleEffort(selectedModel(), previous);
    if (previous === next) return;
    $("effort").value = next;
    $("status").textContent = `此模型不支持原思考度，已调整为${effortLabel()}。`;
    saveChoices();
  }
  function renderOptions(kind, options, choose) {
    const menu = $(kind + "Menu"), chosen = $(kind).value;
    menu.replaceChildren();
    for (const item of options) {
      const option = document.createElement("button");
      option.className = "model-option"; option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(item.value === chosen));
      option.dataset[kind] = item.value; option.disabled = !!item.disabled;
      if (item.description) option.title = item.description;
      const check = document.createElement("span"); check.className = "check";
      check.textContent = item.value === chosen ? "✓" : ""; check.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.textContent = item.label;
      option.append(check, name);
      option.addEventListener("click", () => { choose(item.value); closeMenu(kind, true); });
      menu.appendChild(option);
    }
  }
  function renderPickers() {
    const current = selectedModel();
    const label = current ? modelName(current) : $("model").value;
    $("modelLabel").textContent = label;
    $("modelToggle").title = label;
    $("modelToggle").setAttribute("aria-label", `选择模型，当前 ${label}`);
    $("effortLabel").textContent = effortLabel();
    $("effortToggle").title = `思考度：${effortLabel()}（${$("effort").value}）`;
    $("effortToggle").setAttribute("aria-label", `选择思考度，当前${effortLabel()}`);
    renderOptions("model", availableModels.map(model => ({ value: model.model,
      label: modelName(model) + (model.unavailable ? "（暂不可用）" : ""), disabled: model.unavailable })), value => {
      $("model").value = value; reconcileEffort(); saveChoices(); renderPickers(); update();
    });
    renderOptions("effort", core.effortOptions(current, $("effort").value), value => {
      $("effort").value = value; saveChoices(); renderPickers();
    });
  }
  function openMenu(kind) {
    if ($(kind + "Toggle").disabled) return;
    closeMenus();
    const menu = $(kind + "Menu"), rect = $(kind + "Toggle").getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - menu.offsetHeight - 8))}px`;
    $(kind + "Toggle").setAttribute("aria-expanded", "true");
    (menu.querySelector('[aria-selected="true"]:not(:disabled)') || menu.querySelector("button:not(:disabled)"))?.focus();
  }
  async function refreshAccount() {
    const source = rpc, revision = ++accountRevision;
    if (!source || disposed) return;
    const data = await source.request("account/read", { refreshToken: false });
    if (disposed || rpc !== source || revision !== accountRevision) return;
    account = data.account?.type === "chatgpt" ? data.account : null;
    $("accountState").textContent = account
      ? "已连接 ChatGPT"
      : "登录 ChatGPT 后即可开始";
    $("accountState").title = account ? `${account.email || "ChatGPT"}${account.planType ? ` · ${account.planType}` : ""}` : "";
    update();
    if (account) {
      const models = new Map();
      let cursor;
      const seen = new Set();
      do {
        const page = await source.request("model/list", cursor ? { cursor } : {});
        if (disposed || rpc !== source || revision !== accountRevision) return;
        for (const model of page.data || []) if (model.model && !model.hidden) models.set(model.model, model);
        cursor = page.nextCursor;
        if (seen.has(cursor)) break;
        seen.add(cursor);
      } while (cursor);
      const chosen = $("model").value;
      if (!models.has(chosen)) {
        models.set(chosen, { ...selectedModel(), model: chosen, unavailable: true });
        $("status").textContent = "上次选择的模型暂不可用，请选择其他模型；原偏好仍已保留。";
      }
      availableModels = [...models.values()];
      if (!selectedModel()?.unavailable) reconcileEffort();
      closeMenus(); renderPickers(); update();
    }
  }
  async function connect() {
    if (connecting || disposed) return;
    connecting = true; clearError(); update();
    $("accountState").textContent = "正在连接本机 Codex…";
    try {
      off?.(); rpc = await platform.start();
      if (disposed) return;
      off = rpc.on((method, params) => {
        if (method === "account/login/completed") {
          if (loginID && params.loginId !== loginID) return;
          loginID = null;
          if (!params.success) showError(new Error(params.error || "登录未完成，请重试。"));
          refreshAccount().catch(showError);
        }
        if (method === "account/updated") refreshAccount().catch(showError);
        if (method === "connection/closed") {
          ++accountRevision;
          account = null; rpc = null; loginID = null;
          $("accountState").textContent = "连接已断开";
          showError(new Error("与 Codex 的连接已断开，请点击重新连接。")); update();
        }
      });
      await refreshAccount();
    } catch (error) { showError(error); if (!disposed) $("accountState").textContent = "尚未连接"; }
    finally { connecting = false; update(); }
  }
  function append(role, text) {
    $("messages").querySelector(".empty")?.remove();
    const div = document.createElement("div"); div.className = `message ${role}`;
    div.textContent = text; $("messages").appendChild(div); return div;
  }
  async function generate(followup = null) {
    if (busy || connecting || disposed || !account || !rpc || selectedModel()?.unavailable) return;
    let prompt;
    try { prompt = followup || core.makePrompt({ text: $("passage").value, context: $("context").value, title }); }
    catch (error) { showError(error); return; }
    const ownEpoch = ++epoch;
    busy = true; clearError(); update(); $("status").textContent = "正在思考…";
    let output, session = conversation;
    try {
      if (!followup) {
        conversation = null;
        await session?.dispose();
        if (ownEpoch !== epoch || disposed) return;
        session = new core.Conversation(rpc, platform.workDir);
        conversation = session;
        $("messages").replaceChildren(); lastAnswer = "";
        await session.create($("model").value, $("effort").value);
      } else append("user", followup);
      if (ownEpoch !== epoch || disposed) { await session?.dispose(); return; }
      output = append("assistant", "");
      await session.turn(prompt, text => {
        if (ownEpoch !== epoch) return;
        const messages = $("messages");
        const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
        output.textContent = text; lastAnswer = text;
        $("status").textContent = "正在生成…"; $("copy").disabled = false;
        if (nearBottom) messages.scrollTop = messages.scrollHeight;
      }, $("model").value, $("effort").value);
      if (ownEpoch === epoch) $("status").textContent = "回答完成 · 可继续追问";
    } catch (error) {
      if (ownEpoch === epoch) { showError(error); $("status").textContent = "本次生成已结束"; }
    } finally { if (ownEpoch === epoch) { busy = false; update(); } }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ++epoch; ++accountRevision; off?.(); conversation?.dispose().catch(() => {});
    if (loginID && rpc) rpc.request("account/login/cancel", { loginId: loginID }).catch(() => {});
  }
  ZEPanel = {
    dispose,
    async select(value) {
      ++epoch; busy = false;
      const old = conversation; conversation = null;
      title = value.title || "";
      $("paperTitle").textContent = title;
      $("paperTitle").title = title;
      $("page").textContent = value.page && value.page !== "-" ? `第 ${value.page} 页` : "";
      $("passage").value = value.text || ""; $("context").value = "";
      $("messages").replaceChildren(); $("followup").value = "";
      lastAnswer = ""; $("status").textContent = "点击「解释」开始";
      clearError(); update(); await old?.dispose();
    },
  };
  $("close").addEventListener("click", closePanel);
  for (const kind of ["model", "effort"]) {
    $(kind + "Toggle").addEventListener("click", () => $(kind + "Menu").hidden ? openMenu(kind) : closeMenu(kind, true));
    $(kind + "Toggle").addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(kind); }
    });
    $(kind + "Menu").addEventListener("keydown", event => {
      const options = [...$(kind + "Menu").querySelectorAll("button:not(:disabled)")];
      const index = options.indexOf(document.activeElement);
      let next;
      if (event.key === "ArrowDown") next = (index + 1) % options.length;
      if (event.key === "ArrowUp") next = (index + options.length - 1) % options.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = options.length - 1;
      if (next !== undefined) { event.preventDefault(); options[next]?.focus(); }
      if (event.key === "Tab") closeMenu(kind, true);
    });
  }
  document.addEventListener("pointerdown", event => {
    for (const kind of ["model", "effort"]) {
      if (!$(kind + "Menu").contains(event.target) && !$(kind + "Toggle").contains(event.target)) closeMenu(kind);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      const open = ["model", "effort"].find(kind => !$(kind + "Menu").hidden);
      if (open) closeMenu(open, true); else closePanel();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
      event.preventDefault(); event.stopPropagation(); closePanel();
    }
  });
  window.addEventListener("blur", closeMenus);
  document.querySelector("main").addEventListener("scroll", closeMenus);
  renderPickers();
  $("codexPath").value = platform.getPath();
  $("login").addEventListener("click", async () => {
    clearError(); connecting = true; update();
    try {
      const result = await rpc.request("account/login/start", { type: "chatgpt" });
      loginID = result.loginId;
      platform.openLogin(result.authUrl);
      $("accountState").textContent = "请在浏览器完成登录，然后回到这里";
    } catch (error) { showError(error); }
    finally { connecting = false; update(); }
  });
  $("cancelLogin").addEventListener("click", async () => {
    try { await rpc.request("account/login/cancel", { loginId: loginID }); loginID = null; await refreshAccount(); }
    catch (error) { showError(error); } finally { update(); }
  });
  $("logout").addEventListener("click", async () => {
    if (busy || connecting) return;
    connecting = true; update();
    try {
      await conversation?.dispose(); conversation = null;
      await rpc.request("account/logout"); account = null; await refreshAccount();
    } catch (error) { showError(error); }
    finally { connecting = false; update(); }
  });
  $("reconnect").addEventListener("click", async () => {
    if (busy || connecting || disposed) return;
    connecting = true; update();
    try {
      ++accountRevision;
      await conversation?.dispose(); conversation = null;
      off?.(); await platform.stop(); rpc = null; account = null;
    } catch (error) { showError(error); }
    finally { connecting = false; }
    await connect();
  });
  $("savePath").addEventListener("click", async () => {
    platform.setPath($("codexPath").value);
    $("reconnect").click();
  });
  $("explain").addEventListener("click", () => generate());
  $("stop").addEventListener("click", async () => {
    ++epoch;
    const old = conversation; conversation = null;
    busy = false; connecting = true; update();
    try { await old?.cancel(); await old?.dispose(); }
    catch (error) { showError(error); await platform.stop(); }
    finally {
      connecting = false;
      if (!disposed) $("status").textContent = "已停止生成，可重新解释";
      update();
    }
  });
  $("followupForm").addEventListener("submit", event => {
    event.preventDefault(); const question = $("followup").value.trim();
    if (!question || busy || connecting || !conversation?.threadID) return;
    $("followup").value = ""; generate(question);
  });
  $("copy").addEventListener("click", () => {
    try { platform.copy(lastAnswer); $("status").textContent = "回答已复制"; } catch (error) { showError(error); }
  });
  window.addEventListener("unload", dispose, { once: true });
  if (selection) ZEPanel.select(selection);
  connect();
}, { once: true });
