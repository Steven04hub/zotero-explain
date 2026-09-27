var ZEPlatform = (() => {
  "use strict";
  const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
  const pref = "extensions.zotero-explain.codexPath";
  const generationPref = "extensions.zotero-explain.generation";
  const homeDir = Services.dirsvc.get("Home", Components.interfaces.nsIFile).path;
  const disabledFeatures = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use",
    "browser_use_external", "computer_use", "image_generation", "view_image", "multi_agent",
    "multi_agent_v2", "hooks", "code_mode", "code_mode_host", "memories", "skill_search"];
  let process = null, rpc = null, starting = null, closed = false, generation = 0;
  const dataDir = PathUtils.join(PathUtils.profileDir, "zotero-explain");
  const workDir = PathUtils.join(dataDir, "empty-workspace");

  async function findExecutable() {
    const custom = Zotero.Prefs.get(pref, true);
    if (custom) {
      if (await IOUtils.exists(custom)) return custom;
      throw new Error("设置的 Codex 路径不存在，请在运行设置中更正。");
    }
    const candidates = Zotero.isMac ? [
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
      PathUtils.join(homeDir, "Applications", "ChatGPT.app", "Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
      "/opt/homebrew/bin/codex", "/usr/local/bin/codex",
    ] : [PathUtils.join(homeDir, ".local", "bin", Zotero.isWin ? "codex.exe" : "codex")];
    for (const path of candidates) if (await IOUtils.exists(path)) return path;
    try { return await Subprocess.pathSearch(Zotero.isWin ? "codex.exe" : "codex"); } catch (_) {}
    throw new Error("未找到 Codex 运行程序。请安装官方 Codex，或在运行设置中填写原生可执行文件的完整路径。");
  }

  async function start() {
    if (closed) throw new Error("插件已关闭。");
    if (starting) return starting;
    if (rpc && !rpc.closed) return rpc;
    const startGeneration = ++generation;
    starting = (async () => {
      const command = await findExecutable();
      await IOUtils.makeDirectory(dataDir, { permissions: 0o700, ignoreExisting: true });
      await IOUtils.makeDirectory(workDir, { permissions: 0o700, ignoreExisting: true });
      const env = Subprocess.getEnvironment();
      // Change only the child process environment; keep the user's Codex app isolated.
      for (const name of Object.keys(env)) {
        if (/^(CODEX_|OPENAI_|AZURE_OPENAI_|CHATGPT_)/.test(name)) delete env[name];
      }
      env.CODEX_HOME = dataDir;
      if (Zotero.isMac) env.PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${env.PATH || ""}`;
      const overrides = {
        forced_login_method: '"chatgpt"', cli_auth_credentials_store: '"auto"',
        sandbox_mode: '"read-only"', approval_policy: '"never"', web_search: '"disabled"',
        'history.persistence': '"none"', 'analytics.enabled': "false",
      };
      for (const name of disabledFeatures) overrides[`features.${name}`] = "false";
      const args = ["app-server", "--listen", "stdio://"];
      for (const [key, value] of Object.entries(overrides)) args.push("-c", `${key}=${value}`);
      const child = await Subprocess.call({ command, arguments: args, workdir: workDir,
        environment: env, stderr: "pipe" });
      if (closed || startGeneration !== generation) { await child.kill(); throw new Error("连接已取消。"); }
      process = child;
      const client = new ZECore.RPC(line => child.stdin.write(line));
      rpc = client;
      client.on(method => {
        // Protocol failures must also terminate the underlying process.
        if (method === "connection/closed") child.kill().catch(() => {});
      });
      (async () => {
        try {
          while (true) { const chunk = await child.stdout.readString(); if (!chunk) break; client.feed(chunk); }
          client.close();
        } catch (_) { client.close(); }
      })();
      // Drain stderr to prevent deadlock. Never log tokens, login URLs, or paper text.
      (async () => { try { while (await child.stderr.readString()) {} } catch (_) {} })();
      child.wait().then(() => {
        client.close(); if (process === child) process = null;
      }).catch(() => client.close());
      try {
        await client.request("initialize", { clientInfo: {
          name: "zotero_explain", title: "Zotero Paper Explain", version: "0.3.0",
        }, capabilities: {} });
        await client.notify("initialized");
        return client;
      } catch (error) {
        client.close(); await child.kill();
        throw new Error("无法启动 Codex。请检查运行程序版本及路径。" + error.message);
      }
    })();
    try { return await starting; } finally { starting = null; }
  }
  async function stop(permanent = false) {
    if (permanent) closed = true;
    ++generation;
    // Reject an in-flight handshake immediately, rather than waiting for its timeout.
    rpc?.close(); rpc = null;
    const child = process; process = null;
    if (child) await child.kill();
    if (starting) await starting.catch(() => {});
  }
  return { start, stop, workDir, findExecutable,
    getGenerationSettings() {
      try { return ZECore.generationSettings(JSON.parse(Zotero.Prefs.get(generationPref, true) || "{}")); }
      catch (_) { return ZECore.generationSettings(); }
    },
    setGenerationSettings(value) {
      Zotero.Prefs.set(generationPref, JSON.stringify(ZECore.generationSettings(value)), true);
      // Flush immediately: closing a panel or restarting Zotero must retain the choice.
      Services.prefs.savePrefFile(null);
    },
    getPath: () => Zotero.Prefs.get(pref, true) || "",
    setPath: path => Zotero.Prefs.set(pref, path.trim(), true),
    copy: text => Components.classes["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Components.interfaces.nsIClipboardHelper).copyString(text),
    openLogin: url => Zotero.launchURL(ZECore.loginURL(url)),
  };
})();
