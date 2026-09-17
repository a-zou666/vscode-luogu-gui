# vscode-luogu-gui 开发指南

> 本仓库是 [yltx/vscode-luogu](https://github.com/yltx/vscode-luogu) 的 fork，界面层已重做为统一工作台面板。
> 上游的构建方式与发布约定整体沿用，差异见下文「本 fork 的版本约定」。

**_本指南编写时的环境为node v20.5.0 + npm v9.8.0_**

## 如何构建本项目

- 执行 `npm install` 安装项目依赖。

一切就绪后，使用 `npm run compile` 来编译，或者直接在vscode内按 `F5` 进行调试运行。

> [!TIP]
> 构建前需要执行 `git submodule init` 和 `git submodule update` 确保 `luogu-api-docs` 存在

## 本 fork 的版本约定

本 fork 使用**独立版本号**（从 `1.0.0` 起），不跟随上游的 `4.x` 编号。
上游的「偶数 minor 正式 / 奇数 minor 预发布」约定仍由 `scripts/release-policy.mjs` 强制校验：

- 正式版本使用偶数 minor，例如 `1.0.0`、`1.2.0`。
- 预发布版本使用奇数 minor，例如 `1.1.0`、`1.3.0`。
- Git tag 必须是 `v` 加 package 版本，例如 `v1.0.0`。
- `package.json`、`package-lock.json` 与 tag 三者版本必须一致，否则 `npm run test:release` 与发布工作流会失败。

发布到 VS Code Marketplace 时注意 `publisher` 为 `a-zou666`，需要对应的 PAT（仓库 secret `PAT`）。

## 如何发布新版本

代码全部修改完毕，已经准备好发布新版本时，先运行 `npm run pack` 确保插件可以正确打包，之后请在 `CHANGELOG.md` 中简要说明更新内容，并同步更新 `package.json` 和 `package-lock.json` 中的版本号。

将更新了版本号的代码上传到 GitHub。创建 GitHub Release 并编写发布说明：奇数 minor 必须勾选 **Set as a pre-release**，偶数 minor 不得勾选。Release 发布后，GitHub Actions 会校验 tag、package 版本和发布通道，然后打包、上传 Release 附件并发布到对应的 VS Code Marketplace 正式或预发布通道。

## 自动打包（本地改完就有新 .vsix）

**背景**：手工「改完记得打包」靠不住 —— 曾经出现源码改到 15:31、仓库里的
`vscode-luogu.vsix` 还是 13:26 的旧包，拿去做 F5 实测的就是不含修复的包。

所以本地起一个守护进程，源码一变就自动重打包：

```bash
npm run pack:watch
```

它会监听 `src/ webview/ resources/ scripts/` + `package.json` + `webpack.config.js`，
按下面流水线跑，并把日志同时打到控制台和根目录 `pack-watch.log`：

1. `npm run package` —— 生产构建（`prepackage` 会先清 `dist`）
2. `scripts/check-bundle-features.cjs` —— 特性门禁，新功能真进了生产 bundle 才算数
3. `npm run pack` —— vsce 打出 `vscode-luogu.vsix`
4. **新鲜度自检** —— 产出的 `.vsix` 必须比最新源码新，否则报错（就是上面那次翻车点）

控制台出现 `READY` 即可；`Ctrl+C` 退出。防抖默认 2500ms，可用
`PACK_DEBOUNCE_MS=1000 npm run pack:watch` 调小。

想只打一次（不开守护）：

```bash
npm run pack:local    # 构建 + 特性门禁 + 打包，一步到位
```

> [!NOTE]
> 改完源码等守护打出 `✓ 完成：vscode-luogu.vsix ...` 再去 F5 / 安装实测，
> 就不会拿到旧包。日志 `pack-watch.log` 已在 `.gitignore` 和 `.vscodeignore` 中，
> 不会进 git、也不会进包。

## 文档截图

`README.md` 与文档里的界面截图不是手绘示意图，而是由 `scripts/doc-shots` 用**真实构建产物**渲染生成：

```bash
node scripts/doc-shots/shoot.mjs          # 生成 docs/images/*.png
node scripts/doc-shots/verify-scenes.mjs  # 回归门禁：场景文本断言 + 截图哈希去重
```

- `index.html` —— 截图工坊：内联 VS Code Dark+ 主题变量，`?scene=` 选场景、`?shell=0` 去掉编辑器外壳，加载 `dist/webview-workbench.js` 渲染真实界面。
- `shoot.mjs` —— 用 CDP（Chrome DevTools Protocol）驱动无头 Chrome，轮询页面 `data-ready` 标记后再截图，避免截到空白或半成品。
- `verify-scenes.mjs` —— 门禁：断言每个场景渲染出的 DOM 含有关键词，并要求所有截图哈希两两不同，专门拦住「两个场景渲染成同一张图」这类静默失败。

> [!IMPORTANT]
> 改完界面后请重跑截图与门禁，并**把新的 PNG 一并提交** —— README 直接引用 `docs/images/`。

## 编写时需要注意的问题

上传前运行 `npm run fix;npm run prettier`

暂定，多在群里商量吧。
