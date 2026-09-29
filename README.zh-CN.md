# 论文解释 · ChatGPT

[English](README.md) | **简体中文**

适配 Zotero 10 的桌面插件。选中论文中的文字，通过 **ChatGPT 账号登录官方 Codex App Server** 获取中文解释，在 Zotero 紧凑面板中显示，并可继续追问。

不需要 API Key。使用的是账号的 **Codex 可用模型和额度**，不是 ChatGPT 网页聊天的模型选择器或聊天记录。账号必须具有可用的 Codex 权限与额度。

## 安装和使用

1. 从 [最新 Release](https://github.com/Steven04hub/zotero-explain/releases/latest) 下载 [zotero-explain-0.3.6.xpi](https://github.com/Steven04hub/zotero-explain/releases/download/v0.3.6/zotero-explain-0.3.6.xpi)。校验和见 Release 中的 [SHA256SUMS](https://github.com/Steven04hub/zotero-explain/releases/download/v0.3.6/SHA256SUMS)。
2. 在 Zotero 中打开 **工具 → 插件**，将 XPI 拖入窗口，或使用齿轮菜单的“从文件安装插件”。
3. 打开 **工具 → 论文解释 · ChatGPT**，点击“登录 ChatGPT”。在系统浏览器的 OpenAI 官方页面完成登录，再返回 Zotero。
4. 打开论文 PDF，选中一句或一段文字，在选区弹出框中点击 **✦ 用 ChatGPT 解释**。
5. 在解释窗口确认原文，按需补充前后段落，点击“解释”。首次使用默认为 **GPT-6 Sol，思考度中等**；可打开模型和思考度菜单选择，之后会记住最近一次选择。支持停止生成、继续追问或复制回答。

插件不会自动发送整篇论文。选中文字但没有点击“解释”时，不会提交模型请求。扫描版 PDF 需要先具有可选择的文字层。

## 主要功能

- 流式解释、继续追问、停止生成与复制回答。
- 自由拖动面板到阅读器左右两边；选择另一段文字时恢复自动避让。
- 从上下左右四边及四角调整大小；面板打开期间保留手动尺寸。
- 模型与思考度选择会在面板关闭、插件重载及 Zotero 重启后恢复。
- 支持 macOS 全屏阅读及浅色、深色外观。面板下方和周围继续显示论文。

## 0.3.6 面板下方空白修复

- 移除整列侧栏预留：面板始终浮在阅读器上，面板下方和周围继续显示论文，不再出现挡住论文的整块灰色空白。
- 选区滚出屏幕或暂时拿不到坐标时，保留浮动位置，不改变阅读器宽度。
- 空间不足时只缩小面板；整页选区等确实无法完全避让的情况仍保持浮动，可手动移动。保留四边缩放及新选区自动避让。

本版本也包含 0.3.4 的自由拖动修复与 0.3.5 的四边、四角缩放功能。拖动标题栏或六点手柄即可移动；聚焦标题栏或缩放边缘后可用方向键操作。正常最小尺寸为 322 × 262，小窗口会进一步收缩以保持控件可操作；关闭后重新打开恢复默认尺寸。

完整发布说明见 [v0.3.6 Release](https://github.com/Steven04hub/zotero-explain/releases/tag/v0.3.6)。

## 运行依赖

插件直接启动本机官方 Codex 运行程序，通过标准输入输出通信。**不需要 Node.js、API Key、单独启动桥接服务或开放本地 HTTP 端口来解释文字**。官方登录流程会按需使用本机 OAuth 回调端口。

macOS 会优先查找已安装的 ChatGPT / Codex 桌面应用中的原生 Codex 程序，再查找常见命令路径。

Windows 会查询 Microsoft Store 注册的安装目录，并查找其中的 `app\resources\codex.exe` 等内置 CLI 位置；不会使用桌面 GUI 的 `app\Codex.exe`。也会查找 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`、`%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`、用户 `.local\bin` 和 PATH。

若提示未找到程序：安装官方 [Codex CLI](https://developers.openai.com/codex/cli)，或在插件的“账号与设置”中指定原生 `codex` / `codex.exe` 的绝对路径。Windows 不要填写 `codex.cmd`、快捷方式或桌面 GUI 的 EXE。若系统拒绝启动 WindowsApps 中的内置程序，可改用独立安装的官方 Windows CLI。

目前在 **macOS + Zotero 10.0.4** 实机验证。Windows 的程序发现逻辑有模拟测试，Windows / Linux 原生运行尚未实机验证。插件不内置或下载 Codex 二进制，其他机器仍需自行安装官方运行程序。Codex App Server 仍在演进，旧版本可能不支持部分接口。

安装包通过 GitHub Releases 发布，目前未配置自动更新服务。Zotero 强制要求清单提供 `update_url`，因此填写了保留的 `.invalid` 域名作为明确不可用的占位地址；更新请重新安装新 XPI。配置自动更新时需换成真实的 HTTPS 更新清单。

## 数据和登录

- 发送内容：论文标题、选中的文字、用户主动补充的上下文以及当前会话的追问。
- 使用插件配置目录下独立的 `zotero-explain` 子目录作为子进程的 Codex 配置目录，不读取或复制用户现有 Codex 登录凭据。
- 由官方 Codex 管理 OAuth 和令牌刷新；优先使用其系统凭据存储，无法使用时按官方 `auto` 策略退回本地文件。插件不接收密码，不实现自己的 OpenAI 令牌交换。
- 点击“退出登录”只退出这个插件使用的独立 Codex 登录。
- 临时线程不写入普通本地 Codex 对话列表，窗口关闭后释放会话；这不代表 OpenAI 端零保留，服务端数据规则取决于账号和工作区。
- 插件只渲染纯文本，不把回答作为 HTML 执行。已关闭 shell、浏览器、应用连接、其他插件等工具能力，使用只读沙箱，拒绝服务器发起的工具授权请求。
- 禁用或卸载插件会移除菜单与阅读器事件、关闭窗口并终止它启动的 Codex 子进程。卸载前可先退出登录；独立配置目录不会被自动删除。

## 开发

构建只需 Python 3；检查与单元测试需要 Node.js 20+，无 npm 第三方依赖。

```sh
npm run check
npm test
npm run build
```

源码分工：`addon/core.js` 管理协议、流式会话和提示；`platform.js` 管理 Gecko 子进程；`controller.js` 接入阅读器，`layout.js` 计算选区避让位置；`panel.*` 是解释窗口；`bootstrap.js` 管理生命周期。

`scripts/native-smoke.py` 准备一个**独立测试配置与空论文库**，仅用于开发检查，测试扩展不会打包进正式 XPI。测试结果写入 `.dev/native-result.json`，测试实例自行退出。再次使用同一 `-profile` 启动会执行跨进程重启验证，结果写入 `.dev/native-restart-result.json`。不要把测试配置覆盖到真实 Zotero 配置中。

## 验证范围

0.3.6：55 项自动化测试、99 项 macOS 原生检查通过。已在当前 Zotero 的实际论文中确认：选区滚出视野和缩短面板后，面板下方仍显示论文，不再留下整列空白。

0.3.5：54 项自动化测试、98 项 macOS 原生检查、7 项独立进程重启检查通过。已安装到当前 Zotero，验证连续拖动顶部和右侧边缘调整尺寸。

0.3.4：50 项自动化测试、65 项 macOS 原生检查、7 项独立进程重启检查通过。已更新当前 Zotero，并在实际论文中验证面板可从右侧跨过左栏选区拖到左侧，松手后不弹回。

0.3.3：47 项自动化测试、59 项 macOS 原生检查、7 项独立进程重启检查通过。已在实际论文中验证右栏选区避让、标题栏鼠标拖动及更换选区后的自动移位。

0.3.2：36 项自动化测试、51 项 macOS 原生检查、7 项独立进程重启检查通过。包含全屏打开不新增系统窗口、关闭/快捷键保持全屏、窗口内嵌入、阅读器归属及卸载清理。

0.3.1：31 项自动化测试、45 项 macOS 原生检查、5 项独立进程重启检查通过。新增 10 项 Windows 路径发现和错误恢复模拟测试；Windows 登录与解释仍待实机确认。详见 [验证记录](docs/verification.md)。

0.3.0：21 项自动化测试、45 项原生检查、5 项独立进程重启恢复检查通过。

- 自动化测试覆盖：Unicode 与长度校验、官方登录 URL 校验、分包与乱序通信、错误与断线、请求超时、流式文本合并、提前完成、取消期间的竞态、拒绝工具授权。
- 使用真实 Codex App Server 进行无凭据连接和账号状态验证。
- `node scripts/probe-codex.cjs` 验证官方登录发起、登录 URL 域名及取消流程，不打开浏览器、不使用现有凭据、不提交模型请求。
- 原生 Zotero 测试包含明确标记的模拟后端，用于检查界面中的流式显示、追问、退出登录与纯文本渲染。模拟结果不等于账号真实生成已通过。
- 0.2.0 已在用户实际 Zotero 中验证登录状态恢复、真实模型菜单和 GPT-6 Sol / medium 的完整解释生成。另有 17 项自动化测试、37 项独立 Zotero 原生检查通过；详细范围见 `docs/verification.md`。测试不读取账号令牌或伪造真实登录状态。

## 官方接口依据

- [Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero 阅读器自定义事件](https://www.zotero.org/support/dev/zotero_7_for_developers#custom_reader_event_handlers)
- [Codex App Server](https://developers.openai.com/codex/app-server)
- [ChatGPT 账号认证](https://developers.openai.com/codex/auth)

本项目为独立插件，与 Zotero / OpenAI 无隶属关系。
