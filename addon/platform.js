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
  const discoveryProcesses = new Set();
  const dataDir = PathUtils.join(PathUtils.profileDir, "zotero-explain");
  const workDir = PathUtils.join(dataDir, "empty-workspace");

  function envValue(env, name) {
    const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
    return key ? env[key] : "";
  }

  function cleanPath(value) {
    let path = String(value || "").trim().replace(/^"(.*)"$/, "$1");
    if (Zotero.isWin) {
      const env = Subprocess.getEnvironment();
      path = path.replace(/%([^%]+)%/g, (match, name) => envValue(env, name) || match);
    }
    return path;
  }

  async function isFile(path) {
    try { return (await IOUtils.stat(path)).type === "regular"; } catch (_) { return false; }
  }

  async function windowsStorePaths() {
    const env = Subprocess.getEnvironment();
    const systemRoot = envValue(env, "SystemRoot");
    if (!systemRoot) return [];
    // Query packages registered for this user, including installations on other drives.
    // Never enumerate WindowsApps directly, elevate, or change directory permissions.
    const command = PathUtils.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
      "$packages = @(Get-AppxPackage -Name 'OpenAI.Codex') + @(Get-AppxPackage -Name 'OpenAI.ChatGPT')",
      "$roots = @($packages | Sort-Object -Property Version -Descending | Select-Object -ExpandProperty InstallLocation -Unique)",
      "ConvertTo-Json -InputObject $roots -Compress",
    ].join("; ");
    let child, timer, finished = false;
    const before = generation;
    try {
      child = await Subprocess.call({ command,
        arguments: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], stderr: "pipe" });
      discoveryProcesses.add(child);
      if (closed || before !== generation) return [];
      const read = async (pipe, keep) => {
        let output = "";
        while (true) {
          const chunk = await pipe.readString();
          if (!chunk) return output;
          if (keep) {
            output += chunk;
            if (output.length > 1024 * 1024) throw new Error("Package query output too large");
          }
        }
      };
      const [result, output] = await Promise.race([
        Promise.all([child.wait(), read(child.stdout, true), read(child.stderr, false)]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Package query timed out")), 8000); }),
      ]);
      finished = true;
      if (result.exitCode !== 0) return [];
      const roots = JSON.parse(output.replace(/^\uFEFF/, "").trim());
      if (!Array.isArray(roots)) return [];
      return roots.filter(root => typeof root === "string" && /^(?:[a-z]:[\\/]|\\\\)/i.test(root))
        .flatMap(root => [
          PathUtils.join(root, "app", "resources", "codex.exe"),
          PathUtils.join(root, "resources", "codex.exe"),
          PathUtils.join(root, "app", "resources", "codex-cli", "codex.exe"),
          PathUtils.join(root, "resources", "codex-cli", "codex.exe"),
        ]);
    } catch (_) { return []; }
    finally {
      clearTimeout(timer);
      if (child) {
        discoveryProcesses.delete(child);
        if (!finished) await child.kill().catch(() => {});
      }
    }
  }

  async function findExecutable() {
    const custom = cleanPath(Zotero.Prefs.get(pref, true));
    if (custom) {
      if (Zotero.isWin && !/\.exe$/i.test(custom)) {
        throw new Error("请选择原生 codex.exe 文件，不能填写文件夹、codex.cmd 或快捷方式。清空路径并保存可恢复自动查找。");
      }
      if (await isFile(custom)) return custom;
      throw new Error("设置的 Codex 路径不存在、无法访问或不是文件。清空路径并保存可恢复自动查找（适用于应用更新后的路径变化）。");
    }
    if (Zotero.isWin) {
      // Prefer the desktop's bundled CLI, never app\\Codex.exe (the GUI launcher).
      for (const path of await windowsStorePaths()) if (await isFile(path)) return path;
      const local = envValue(Subprocess.getEnvironment(), "LOCALAPPDATA");
      if (local) {
        for (const path of [
          PathUtils.join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
          PathUtils.join(local, "OpenAI", "Codex", "bin", "codex.exe"),
        ]) if (await isFile(path)) return path;
      }
    }
    const candidates = Zotero.isMac ? [
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
      PathUtils.join(homeDir, "Applications", "ChatGPT.app", "Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
      "/opt/homebrew/bin/codex", "/usr/local/bin/codex",
    ] : [PathUtils.join(homeDir, ".local", "bin", Zotero.isWin ? "codex.exe" : "codex")];
    for (const path of candidates) if (await isFile(path)) return path;
    try {
      const path = await Subprocess.pathSearch(Zotero.isWin ? "codex.exe" : "codex");
      // Store execution aliases can start the desktop GUI instead of App Server.
      if ((!Zotero.isWin || !/[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(path)) && await isFile(path)) return path;
    } catch (_) {}
    throw new Error(Zotero.isWin
      ? "未找到可用的 Codex 运行程序。已查找 Microsoft Store 应用与常见 CLI 路径；请确认当前 Windows 用户已安装 Codex。若系统限制应用目录访问，可安装官方 Windows Codex CLI，并在账号与设置中填写原生 codex.exe 的完整路径。"
      : "未找到 Codex 运行程序。请安装官方 Codex，或在运行设置中填写原生可执行文件的完整路径。");
  }

  async function start() {
    if (closed) throw new Error("插件已关闭。");
    if (starting) return starting;
    if (rpc && !rpc.closed) return rpc;
    const startGeneration = ++generation;
    starting = (async () => {
      const command = await findExecutable();
      if (closed || startGeneration !== generation) throw new Error("连接已取消。");
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
      let child;
      try {
        child = await Subprocess.call({ command, arguments: args, workdir: workDir,
          environment: env, stderr: "pipe" });
      } catch (error) {
        throw new Error(`已找到 Codex，但无法启动：${command}。请确认文件可执行且有访问权限。` +
          (Zotero.isWin ? "若 Microsoft Store 目录拒绝访问，可改用官方 Windows Codex CLI。" : "") + error.message);
      }
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
          name: "zotero_explain", title: "Zotero Paper Explain", version: "0.3.2",
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
    await Promise.all([...discoveryProcesses].map(child => child.kill().catch(() => {})));
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
    setPath(path) {
      Zotero.Prefs.set(pref, cleanPath(path), true);
      Services.prefs.savePrefFile(null);
    },
    copy: text => Components.classes["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Components.interfaces.nsIClipboardHelper).copyString(text),
    openLogin: url => Zotero.launchURL(ZECore.loginURL(url)),
  };
})();
