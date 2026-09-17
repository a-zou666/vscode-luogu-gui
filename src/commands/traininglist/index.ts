import SuperCommand from '../SuperCommand';
import * as vscode from 'vscode';

/**
 * 题单广场已并入统一工作台面板（`luogu.workbench` 的「题目」页）。
 *
 * 这里不再单独开一个 HTML 面板——否则同一个功能会有两个入口、两套 UI，且旧
 * 面板的列表归一化逻辑与工作台重复。命令名与快捷键 Ctrl+Alt+G T 都保留，
 * 直接唤起工作台，老用户的操作习惯不变。
 *
 * 旧的 HTML 生成逻辑（`generategeneralHTML` / `generateOfficialListHTML` /
 * `generateSelectedListHTML`）随面板一并删除，题单渲染改由
 * `webview/views/workbench/problemPage.tsx` 负责。
 */
export default new SuperCommand({
  onCommand: 'traininglist',
  handle: () => vscode.commands.executeCommand('luogu.workbench')
});
