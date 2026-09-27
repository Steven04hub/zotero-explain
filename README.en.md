# Zotero Explain · ChatGPT

[简体中文](README.md) | **English**

Explain selected passages from papers in Zotero using your ChatGPT account. No API key is required. Answers appear in a compact reading panel, with streaming output and follow-up questions.

The plugin uses the **official Codex App Server** and your account's **Codex access, available models, and usage limits**. It does not automate the ChatGPT website or use its conversation history. The interface and default explanations are currently in Simplified Chinese; this file provides English documentation.

## Features

- Select text in a PDF and choose **✦ 用 ChatGPT 解释** (“Explain with ChatGPT”).
- Review the selected text and optionally add surrounding context before sending it.
- Stream explanations, ask follow-up questions, stop generation, and copy answers.
- Choose a model and reasoning effort. Effort options come from the selected model's capabilities.
- Automatically remember both choices across panel closures, plugin reloads, and Zotero restarts.
- Start with **GPT-6 Sol / medium** when no preferences have been saved.
- Use a compact 460 × 600 panel with light and dark appearances, no minimization, and suppressed window animations.

## Requirements

- **Zotero 10**. Tested on macOS with **Zotero 10.0.4**.
- An official local **Codex executable** supporting App Server.
- A ChatGPT account with available Codex access and usage allowance.

The plugin starts Codex directly over standard input/output. With a native executable, it requires **no Node.js runtime, API key, or separately managed bridge service**. Explanation requests do not require a local HTTP server; the official sign-in flow may open a local OAuth callback listener.

On macOS, the plugin looks for Codex inside installed ChatGPT/Codex desktop applications and in common executable locations. If it cannot find Codex, install the official [Codex CLI](https://developers.openai.com/codex/cli), or provide the executable's absolute path under **账号与设置** (“Account and settings”).

Use the native `codex` or `codex.exe` executable. On Windows, do not select `codex.cmd`. An npm launcher requires Node.js to be available in Zotero's process environment; a native binary is preferred.

Windows and Linux have not been tested on real machines. The plugin does not bundle or download Codex. App Server evolves over time, so older Codex versions may lack required interfaces.

## Install and use

1. Download [`zotero-explain-0.3.0.xpi`](dist/zotero-explain-0.3.0.xpi), or build it from source. Checksums are provided in [`dist/SHA256SUMS`](dist/SHA256SUMS).
2. In Zotero, open **Tools → Plugins**. Drag the XPI into the window, or use the gear menu's **Install Plugin From File…** option.
3. Open **Tools → 论文解释 · ChatGPT**, then click **登录 ChatGPT** (“Sign in to ChatGPT”). Complete sign-in on the official OpenAI page in your browser and return to Zotero.
4. Open a PDF, select a sentence or passage, and click **✦ 用 ChatGPT 解释** in the selection popup.
5. Check the source text, optionally expand **补充上下文** (“Additional context”), choose a model and effort, and click **解释** (“Explain”).
6. Use the follow-up field to continue the conversation, or close the panel with its close button, Escape, or ⌘W.

Selecting text does not send a model request. The plugin sends the selected passage, paper title, and any context you add only when you click Explain. It does not automatically upload the entire paper. Scanned PDFs need a selectable text layer.

## Model and effort preferences

Selections are saved immediately to the Zotero profile; there is no separate Save step. Only the model identifier and effort are stored in these preferences, not credentials or paper text.

When switching models, a compatible effort is retained. If the new model does not support it, the plugin chooses a supported setting, displays a notice, and saves the new combination. Both initial explanations and follow-up requests use the current settings.

A temporary catalog failure or an unavailable saved model does not silently reset the saved model. If that model is unavailable, select another available model to continue.

## Authentication and data handling

- Authentication and token refresh are handled by the official Codex executable. The plugin does not collect passwords or implement its own OAuth token exchange.
- Codex uses a separate `zotero-explain` directory within the Zotero profile. The plugin does not import existing Codex desktop login credentials.
- Credential storage uses Codex's `auto` policy: system credential storage when available, with the official local-file fallback.
- Signing out affects this plugin's isolated Codex login.
- Requests contain the selected passage, paper title, optional context, and follow-up questions. Treat these as information sent to OpenAI under your account/workspace settings.
- Conversations use ephemeral threads and are released when the panel closes. This is not a promise of zero server-side retention.
- Responses are rendered as plain text. Shell, browser, app, and other agent tool features are disabled; the plugin requests a read-only sandbox and declines server-initiated tool approval requests.
- Disabling or uninstalling the plugin removes its menus and reader handlers, closes its panel, and stops its Codex subprocess. The isolated configuration directory is retained; sign out before uninstalling if you want to remove the plugin's active login.

## Updates

Automatic updates are not configured. Install a new XPI to upgrade.

Zotero requires an `update_url` in the manifest. The current manifest uses a reserved `.invalid` placeholder, which intentionally does not provide updates. Hosting an automatic update service would require replacing it with a real HTTPS update manifest.

## Development

Building requires Python 3. Syntax checks and automated tests require Node.js 20 or newer. There are no third-party npm dependencies.

```sh
npm run check
npm test
npm run build
```

The build creates `dist/zotero-explain-<version>.xpi` as a reproducible ZIP archive. To verify the published installer:

```sh
cd dist
shasum -a 256 -c SHA256SUMS
```

### Source layout

| Path | Purpose |
| --- | --- |
| `addon/bootstrap.js` | Plugin startup and shutdown |
| `addon/controller.js` | Zotero menus and reader selection events |
| `addon/core.js` | JSON-RPC transport, prompts, conversations, and effort handling |
| `addon/platform.js` | Gecko subprocess management and persistent preferences |
| `addon/panel.*` | Reading panel and model/effort menus |
| `scripts/build.py` | Reproducible XPI packaging |
| `tests/` | Dependency-free automated tests |
| `docs/` | Verification reports |

### Native integration checks

`scripts/native-smoke.py` prepares an **isolated test profile and library** under `.dev/`. Its test extension is not included in the distributable XPI. Never point it at your normal Zotero profile.

```sh
python3 scripts/native-smoke.py
/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile "$PWD/.dev/zotero-test-profile" -ZoteroDebugText
```

The test instance exits after writing `.dev/native-result.json`. Run the same Zotero command again to check persistence across a full process restart; that result is written to `.dev/native-restart-result.json`.

`node scripts/probe-codex.cjs` checks real App Server initialization, signed-out account state, official login URL generation, and login cancellation. It uses an isolated configuration, does not open a browser, and does not submit model requests.

### Verification

For **0.3.0**, 21 automated tests, 45 native checks, and 5 startup/persistence checks passed on macOS with Zotero 10.0.4. Native checks include explicitly labeled mock-backend tests. A real ChatGPT-authenticated explanation using GPT-6 Sol / medium was verified during 0.2.0 development. Windows/Linux operation and server-side quota exhaustion have not been verified.

See the [verification log](docs/verification.md) and machine-readable [native](docs/native-verification-0.3.0.json) / [restart](docs/restart-verification-0.3.0.json) reports.

## References

- [Zotero 10 developer notes](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero custom reader events](https://www.zotero.org/support/dev/zotero_7_for_developers#custom_reader_event_handlers)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [ChatGPT account authentication](https://developers.openai.com/codex/auth)

This is an independent plugin, not affiliated with Zotero or OpenAI.
