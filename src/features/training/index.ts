import * as vscode from 'vscode';
import TrainingTreeviewProvider from './treeviewProvider';

export default function registerTraining(context: vscode.ExtensionContext) {
  const view = new TrainingTreeviewProvider();
  context.subscriptions.push(view);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('luogu.training', view)
  );

  // The view is gated on `luoguLoginStatus` like the other account-backed
  // views, but VS Code never hides a view whose cached children are stale on
  // its own, so drop them whenever the session changes. The consumer-side event
  // only carries the provider, so any Luogu session change triggers a reload.
  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(e => {
      if (e.provider.id === 'luogu-auth') view.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('luogu.training.refresh', () =>
      view.refresh()
    ),
    vscode.commands.registerCommand('luogu.training.openPlaza', () =>
      vscode.commands.executeCommand('luogu.traininglist')
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
      (node: { kind: 'problem'; pid: string }) =>
        vscode.commands.executeCommand('luogu.sumbitCode', { pid: node.pid })
    )
  );
}
