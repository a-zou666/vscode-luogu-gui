import * as vscode from 'vscode';
import TrainingTreeviewProvider from './treeviewProvider';

/**
 * 题单广场已并入统一工作台面板（`luogu.workbench` 的「题目」页），侧边栏视图
 * 不再注册。这里保留 provider 与相关命令：provider 仍是题单数据/分页逻辑的
 * 实现，命令（刷新、加载更多、提交）由工作台与其它入口复用。
 */
export default function registerTraining(context: vscode.ExtensionContext) {
  const view = new TrainingTreeviewProvider();
  context.subscriptions.push(view);

  context.subscriptions.push(
    vscode.commands.registerCommand('luogu.training.refresh', () =>
      view.refresh()
    ),
    vscode.commands.registerCommand('luogu.training.openPlaza', () =>
      vscode.commands.executeCommand('luogu.workbench')
    ),
    vscode.commands.registerCommand(
      'luogu.training.loadMore',
      (node: { channelKey: string; page: number }) => view.loadMore(node)
    ),
    vscode.commands.registerCommand(
      'luogu.training.openDetails',
      (node: { id: number }) =>
        vscode.commands.executeCommand('luogu.traindetails', node.id)
    ),
    vscode.commands.registerCommand(
      'luogu.training.submit',
      async (node: { kind: 'problem'; pid: string }) => {
        // 题单里点提交：题目编号是确定的，文件用“当前正在编辑的代码”。
        // 若当前没有活动编辑器，submit.ts 会退回文件选择框。
        const editor = vscode.window.activeTextEditor;
        return vscode.commands.executeCommand(
          'luogu.sumbitCode',
          { pid: node.pid },
          editor?.document
        );
      }
    )
  );
}
