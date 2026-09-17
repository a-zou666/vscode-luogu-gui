import * as vscode from 'vscode';
import { fetchRecords, fetchResult } from '@/utils/api';
import { getReactWebviewHtml } from '@/utils/html';
import {
  processAxiosError,
  getWebviewViewColumn
} from '@/utils/workspaceUtils';
import { RecordData } from 'luogu-api';
import { MessageTypes } from '@w/views/record/data';
import { getLatestRecordId } from './recordList';
import { isPendingStatus, trackRecord } from './recordTrack';

async function record(record: RecordData) {
  const panel = vscode.window.createWebviewPanel(
    'luogu.recordPanel',
    `R${record.record.id} 记录详情`,
    getWebviewViewColumn(),
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(globalThis.distPath)],
      enableCommandUris: [
        'luogu.searchProblem',
        'luogu.openUntitledTextDocument'
      ]
    }
  );
  panel.webview.html = getReactWebviewHtml(panel.webview, 'webview-record.js', {
    'lentille-context': record satisfies RecordData
  });
  // 还没出结果才去跟踪；已完成的记录直接展示快照即可。
  if (isPendingStatus(record.record.status))
    trackRecord(
      record.record.id,
      event => void panel.webview.postMessage(event satisfies MessageTypes),
      listener => panel.onDidDispose(() => listener.dispose())
    );
}

export default function registerRecord(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('luogu.record', async rid => {
      if (typeof rid !== 'number') throw new TypeError('rid must be a number');
      // 提交后（submit.ts）会调用本命令，需要真正把记录详情面板打开；
      // 原先这里漏了调用 record()，导致“提交成功但看不到记录”。
      let data: RecordData;
      try {
        data = await fetchResult(rid);
      } catch (e) {
        processAxiosError('获取记录')(e);
        return false;
      }
      if (!data?.record) {
        vscode.window.showErrorMessage('获取记录失败：记录数据为空');
        return false;
      }
      // 注意：`showStatus` 只表示“状态是否对当前用户可见”（如比赛封榜、他人记录），
      // 它和 `record.status` 是两回事。曾经这里把 showStatus 为假当成“状态不可知”
      // 并把 status 强行改成 -1（Unshown），结果连正常的评测结果也一起被隐藏了。
      // 状态以服务端下发的 record.status 为准，不要在这里改写它。
      void record(data);
      return true;
    }),
    vscode.commands.registerCommand('luogu.lastRecord', async () => {
      const records = await fetchRecords().catch(
        processAxiosError('获取上次提交记录')
      );
      if (records === undefined) return;
      const rid = getLatestRecordId(records.result);
      if (rid === undefined) {
        vscode.window.showInformationMessage('暂无提交记录');
        return false;
      }
      await vscode.commands.executeCommand('luogu.record', rid);
      return true;
    })
  );
}
