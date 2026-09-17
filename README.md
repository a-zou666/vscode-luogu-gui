# vscode-luogu-gui

在 VS Code 里使用洛谷（Luogu）的插件。本项目是 [yltx/vscode-luogu](https://github.com/yltx/vscode-luogu) 的 fork，
在 4.16.0 的基础上重做了主界面：把原先分散在侧边栏的入口收敛成一个**统一工作台面板**。

## 本 fork 相对上游的主要改动

### 统一工作台面板

侧边栏只保留一个「洛谷」视图容器，内嵌 `工作台` webview，用页签组织功能，不再需要在一堆树视图之间来回点。

**题目页**

- 搜索题目：关键词 + 难度筛选 + 分页
- 题单广场：频道 → 题单 → 题目逐级下钻，返回时回到来处而不是一级页
- 题目详情内嵌渲染，支持洛谷新版 Markdown 扩展语法（Tuack 表格、引言、代码行增强、提示块）
- 题面页可直接点「提交本题」，带着题目编号跳到提交页

**提交页**

- 提交目标明确展示当前要提交的题目；未指定时取 VS Code 当前活动文件
- 语言与 O2 优化按文件后缀自动匹配
- 验证码**按需出现**：服务端只在风控/频繁提交时要求，不要求就不占版面
- 提交后实时显示评测进度与结果（WebSocket 推送），评测期间不抢焦点

### 工程改动

- 两个页签常驻挂载（只切显隐），切页签不丢下钻位置和已拉取数据，评测进度也在后台继续更新
- 登录门控：订阅 `authProvider.onDidChangeSessions`，登录/登出后门控立即消失，不必重开面板
- 修复监听器泄漏：提交页监听器正确解绑，不再随每次提交叠加
- 新增回归测试与门禁：
  - `npm run test:layout` —— 提交框布局回归（22 项，覆盖窄面板宽度、验证码按需渲染、单行输入高度）
  - `scripts/check-bundle-features.cjs` —— 打包前核验新功能真进了生产 bundle
  - `scripts/watch-pack.mjs` —— 源码一变自动重打包，避免拿到旧 `.vsix` 去实测

## 使用说明

**请参考 `GitHub` 上的 [wiki](https://www.github.com/yltx/vscode-luogu/wiki) 页面。** 上游 wiki 的功能说明对本 fork 基本适用；
工作台面板相关的差异见上一节。

## 完成功能

- 查看题目 / 搜索题目 / 题单广场
- 登录账号、注销账号
- 提交代码（含按需验证码）
- 查看自己测评、查看最近一次评测（实时进度）
- 打卡
- 题目离线查看
- 查看、发布犇犇
- 查看题解、给题解点赞/踩
- 比赛相关功能
- 根据题目难度及来源随机跳题

## 开发中功能

- 查看、发布讨论

## 如何构建本项目

```bash
npm install
git submodule init && git submodule update   # 确保 luogu-api-docs 存在
npm run compile                              # 或在 VS Code 内按 F5 调试
```

完整流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 如何贡献本项目

- 本 fork 的问题请提到 [a-zou666/vscode-luogu-gui/issues](https://github.com/a-zou666/vscode-luogu-gui/issues)。
- 与上游共有的功能问题，建议同时关注 [上游仓库](https://github.com/yltx/vscode-luogu)。

## 致谢

本项目的绝大部分工作来自上游作者与贡献者，本 fork 只是在其基础上重做了界面层：

- [@yltx](https://github.com/yltx)（引领天下）—— 上游仓库作者与长期维护者
- 上游贡献者：Himself65、YanWQmonad、FangZeLi、andyli、蒟蒻水儿、[宝硕](https://baoshuo.ren)、品小呈、MrPython、Enigma_Soul
- [0f-0b/luogu-api-docs](https://github.com/0f-0b/luogu-api-docs) —— 洛谷 API 文档与类型定义（以 submodule 引入）

## Others

Luogu 图标来自 [Luogu](https://www.luogu.com.cn/)，严禁商业使用

UI 图标来自：[Icons8](https://icons8.cn/) 与 [FontAwesome](https://fontawesome.com/)

上游用户交流群：1141066631

## LICENSE

Follow [MIT](LICENSE) LICENSE.
