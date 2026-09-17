import { resolveSubmissionProblem, submitCode } from '@/utils/api';
import { getContestMonitor } from './contest/contestMonitor';
import {
  askForLanguage,
  askForPid,
  guessProblemId,
  processAxiosError
} from '@/utils/workspaceUtils';
import * as vscode from 'vscode';

type SubmissionProblem =
  | import('@/features/history/historyItem').ProblemHistoryItem
  | { pid: string; cid?: number };

export default function registerSubmitFeature(
  context: vscode.ExtensionContext
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'luogu.sumbitCode',
      async (problem?: SubmissionProblem, document?: vscode.TextDocument) => {
        // 提交内容一律以“当前显示的代码文件”为准：
        //  - 传了 document（题单/题目面板触发，用于固定提交哪个文件）就用它，
        //    且**不再把它显示出来**——用户已经开着的窗口不该被抢焦点；
        //  - 否则用当前正在编辑的文件；
        //  - 都没有才退回“弹出文件选择框”。
        const target = document ?? vscode.window.activeTextEditor?.document;
        if (!target) {
          const picked = await selectOpenDocument();
          if (!picked) {
            vscode.window.showErrorMessage(
              '您没有选择任何文件，请选择一个文件后重试'
            );
            return false;
          }
          return vscode.commands.executeCommand(
            'luogu.sumbitCode',
            problem,
            picked
          );
        }
        if (!(await ensureSaved(target))) return false;

        let resolved = problem;
        if (!resolved) {
          const guessed = guessProblemId(target.fileName);
          if (
            guessed &&
            vscode.workspace
              .getConfiguration('luogu')
              .get('guessProblemID', false)
          )
            resolved = guessed;
          else if (
            !(resolved = await askForPid(guessProblemId(target.fileName)))
          )
            return false;
        }
        if ('type' in resolved)
          resolved = { pid: resolved.pid, cid: resolved.contest?.contestId };
        resolved = resolveSubmissionProblem(resolved, getContestMonitor());
        const lang = await askForLanguage(
          target.fileName.split('.').pop() ?? ''
        );
        if (lang === undefined) return false;
        vscode.window.showInformationMessage('正在提交……');
        try {
          const rid = await submitCode(
            resolved,
            target.getText(),
            lang.id,
            lang.O2
          );
          vscode.commands.executeCommand('luogu.record', rid);
          return true;
        } catch (e) {
          processAxiosError('提交代码')(e);
          return false;
        }
      }
    ),
    // “提交当前文件”：直接从当前编辑器取文件，不弹任何选择框。
    vscode.commands.registerCommand('luogu.submitCurrentFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('请先打开一个文件再提交');
        return false;
      }
      return vscode.commands.executeCommand(
        'luogu.sumbitCode',
        undefined,
        editor.document
      );
    })
  );
}

/**
 * `document.getText()` 读的是文档缓冲区，未保存的修改本来就在缓冲区里，
 * 所以内容不会丢；但用未保存的内容提交通常不是本意（洛谷上看到的和磁盘对不上），
 * 这里明确问一句再决定，避免“提交了却没生效”的困惑。
 */
async function ensureSaved(document: vscode.TextDocument) {
  if (!document.isDirty) return true;
  const name = document.fileName.split(/[\\/]/).pop();
  const choice = await vscode.window.showWarningMessage(
    `${name} 有未保存的修改，将按编辑器中的当前内容提交。`,
    '仍然提交',
    '保存并提交'
  );
  if (choice === undefined) return false;
  if (choice === '保存并提交') await document.save();
  return true;
}

async function selectOpenDocument(): Promise<vscode.TextDocument | undefined> {
  const res = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    canSelectFolders: false,
    title: '选择要提交的文件'
  });
  if (res && res.length > 0)
    return await vscode.workspace.openTextDocument(res[0]);
  return undefined;
}
