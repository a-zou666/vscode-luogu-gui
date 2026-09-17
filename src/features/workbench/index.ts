import * as vscode from 'vscode';
import type { ProblemSummary } from 'luogu-api';
import { getReactWebviewHtml } from '@/utils/html';
import {
  getProblemData,
  normalizeListResult,
  searchProblemList,
  searchTrainingdetail,
  searchTraininglist,
  submitCode
} from '@/utils/api';
import { askForLanguage, getWebviewViewColumn } from '@/utils/workspaceUtils';
import {
  getAcceptedCount,
  getTrainingCategories
} from '@/commands/traininglist/trainingData';
import useWebviewResponseHandle from '@/utils/webviewResponse';
import { pickTrainingProblems, pickTrainings } from './normalize';
import { trackRecord } from '@/features/recordTrack';

/** 左侧活动栏里的工作台视图 id，与 package.json 的 contributes.views 保持一致。 */
export const WORKBENCH_VIEW_ID = 'luogu.workbenchView';

/** 面板单例：同一个 workbench 面板只允许存在一个，重复触发就把它显到前面。 */
let currentPanel: vscode.WebviewPanel | undefined;

/**
 * 已经接过处理器的 webview。
 *
 * `resolveWebviewView` 不只在视图首次加载时调用 —— 用户切走再切回活动栏图标时，
 * 视图本身保留但 webview 文档被释放并重建，`resolveWebviewView` 会**再次**触发。
 * 若每次都注册一遍 `onDidReceiveMessage`，同一个请求会被处理多次（重复打接口、
 * 重复提交）。用 WeakSet 记一下，同一个 webview 只接一次。
 */
const attachedWebviews = new WeakSet<vscode.Webview>();

/**
 * 提交页的核心动作：从「当前活动的代码文件」取内容，按扩展名自动配好语言与
 * O2 后提交，返回真实的 rid。
 *
 * 为什么不用 `luogu.sumbitCode`：它只回 boolean，拿不到 rid，也就没法在提交页
 * 里内联跟踪评测。这里保留同一套前置校验（有活动编辑器 / 文件已保存），
 * 但把语言选择交给 `askForLanguage`（会走用户的默认语言配置），行为一致。
 */
async function submitFromWorkbench(pid: string, cid?: number) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('请先打开要提交的代码文件');
  const document = editor.document;
  if (document.isDirty) {
    const name = document.fileName.split(/[\\/]/).pop();
    const choice = await vscode.window.showWarningMessage(
      `${name} 有未保存的修改，将按编辑器中的当前内容提交。`,
      '仍然提交',
      '保存并提交'
    );
    if (choice === undefined) throw new Error('已取消提交');
    if (choice === '保存并提交') await document.save();
  }
  const ext = document.fileName.split('.').pop() ?? '';
  const lang = await askForLanguage(ext);
  if (lang === undefined) throw new Error('已取消提交');
  return {
    rid: await submitCode({ pid, cid }, document.getText(), lang.id, lang.O2)
  };
}

/** webview 选项：活动栏视图与浮动面板共用（含 command: 链接白名单）。 */
const getWebviewOptions = () => ({
  enableScripts: true,
  localResourceRoots: [vscode.Uri.file(globalThis.distPath)],
  enableCommandUris: ['luogu.signin', 'luogu.searchProblem', 'luogu.sumbitCode']
});

/** 读取当前登录态。请求响应与推送两条路都用它，避免两处判定漂移。 */
async function getLoginStatus() {
  const sessions = await globalThis.luogu.authProvider?.getSessions();
  const session = sessions?.[0];
  return {
    loggedIn: session !== undefined,
    username: session?.account.label
  };
}

/**
 * 给一个 webview 接上工作台的全部请求处理器，并注入页面。
 *
 * 活动栏视图（WebviewView）与浮动面板（WebviewPanel）共用这一份实现 —— 两套
 * 入口各写一份的话，行为迟早会漂移。`onDispose` 由调用方提供，用于宿主销毁时
 * 停掉评测跟踪。
 *
 * 注意这里刻意用「函数内直接调 useWebviewResponseHandle」而不是先建好一个
 * handlers 对象再传：泛型 K 要从 handles 的键推导，对象字面量才有上下文类型，
 * 单独抽出去会让每个参数退化成隐式 any。
 */
function attachWorkbench(
  webview: vscode.Webview,
  onDispose: (listener: { dispose: () => void }) => void
) {
  // 同一个 webview 只接一次：活动栏视图切走再切回会重新 resolve，
  // 重复注册监听器会让每个请求被处理多次（见 attachedWebviews 注释）。
  if (attachedWebviews.has(webview)) return;
  attachedWebviews.add(webview);

  // 推送事件走 {type, ...}，响应走 {data|error, uuid}：两条通道靠包络区分，
  // 推送绝不能带上 uuid 之外的响应字段，否则会被 webview 的响应监听吞掉。
  const post = (message: unknown) => void webview.postMessage(message);

  // ── 登录态推送 ──
  // 门控页只在挂载时查一次登录态，而登录是在扩展宿主里完成的（command:luogu.signin），
  // webview 完全不知情 —— 不推的话，用户登录成功后门控不会消失，仍停在「需要登录」。
  // 浮动面板因为 retainContextWhenHidden 更是永远不重挂载，症状最明显。
  // 订阅 authProvider.onDidChangeSessions（登录/登出/换号都会触发），变化时主动推。
  const sessionListener = globalThis.luogu.authProvider?.onDidChangeSessions(
    () => {
      void getLoginStatus()
        .then(status => post({ type: 'loginStatus', data: status }))
        .catch(() => post({ type: 'loginStatus', data: { loggedIn: false } }));
    }
  );
  // webview 被销毁时同步退订，避免往已销毁的 webview 上 postMessage。
  // 注意：`vscode.Webview` 自身没有 onDidDispose（那是 WebviewView / WebviewPanel
  // 的成员），只能用调用方传进来的 onDispose 挂载。
  if (sessionListener) onDispose(sessionListener);

  useWebviewResponseHandle(webview, {
    workbenchLoginStatus: getLoginStatus,
    workbenchSearchProblem: async ({ page, keyword, difficulty, type }) => {
      const data = await searchProblemList(page, keyword, difficulty, type);
      const list = data?.problems;
      return {
        problems: normalizeListResult<ProblemSummary>(list?.result).map(p => ({
          pid: p.pid,
          title: p.title ?? p.pid,
          difficulty: p.difficulty ?? null
        })),
        count: list?.count ?? 0,
        perPage: list?.perPage ?? null
      };
    },
    workbenchTrainingChannels: async () => {
      const data = await searchTraininglist('official', '', 1);
      return getTrainingCategories(data ?? {}).map(c => ({
        key: c.key,
        name: c.name
      }));
    },
    workbenchTrainingList: async ({ channel, page, keyword }) => {
      const data = await searchTraininglist(channel, keyword ?? '', page);
      return {
        trainings: pickTrainings(data).map(t => ({
          id: t.id,
          name: t.name,
          problemCount: t.problemCount,
          acceptedCount: getAcceptedCount(data ?? {}, t.id)
        })),
        count: data?.trainings?.count ?? 0,
        perPage: data?.trainings?.perPage ?? null
      };
    },
    workbenchTrainingDetail: async ({ id }) => {
      const data = await searchTrainingdetail(id);
      const training = data?.training;
      return {
        id,
        name: training?.name ?? training?.title ?? String(id),
        problems: pickTrainingProblems(training).map(p => ({
          pid: p.pid,
          title: p.title ?? p.pid,
          difficulty: p.difficulty ?? null,
          status: p.status
        }))
      };
    },
    workbenchProblemDetail: ({ pid }) => getProblemData(pid),
    workbenchSubmit: async ({ pid, cid }) => {
      // 不复用 luogu.sumbitCode：那条链路只回 boolean，拿不到 rid，
      // 没法在这里实时跟评测。这里自己走一遍提交，然后把 rid 的跟踪
      // 事件推给同一个 webview（提交页内联展示评测进度）。
      const { rid } = await submitFromWorkbench(pid, cid);
      trackRecord(rid, event => post(event), onDispose);
      return { rid };
    }
  });
}

export default function registerWorkbench(context: vscode.ExtensionContext) {
  // ── 入口一：左侧活动栏图标（主要入口）──
  // 点图标即在侧栏里看到完整工作台，不用记快捷键、也不用翻命令面板。
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WORKBENCH_VIEW_ID, {
      resolveWebviewView: view => {
        view.webview.options = getWebviewOptions();
        attachWorkbench(view.webview, listener =>
          view.onDidDispose(() => listener.dispose())
        );
        view.webview.html = getReactWebviewHtml(
          view.webview,
          'webview-workbench.js',
          {}
        );
      }
    })
  );

  // ── 入口二：状态栏按钮 ──
  // 侧栏图标可能被折叠或隐藏，状态栏留一个一眼可见的兜底入口。
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusItem.text = '$(luogu-paper-plane) 洛谷';
  statusItem.tooltip = '打开洛谷工作台';
  statusItem.command = 'luogu.workbench';
  statusItem.show();
  context.subscriptions.push(statusItem);

  // ── 入口三：命令 / 快捷键（Ctrl+Alt+G W）──
  // 打开编辑器区里的浮动面板：侧栏太窄时想看宽版就用这个。
  context.subscriptions.push(
    vscode.commands.registerCommand('luogu.workbench', () => {
      if (currentPanel) {
        currentPanel.reveal(getWebviewViewColumn());
        return currentPanel;
      }
      const panel = vscode.window.createWebviewPanel(
        'luogu.workbenchPanel',
        '洛谷工作台',
        getWebviewViewColumn(),
        {
          ...getWebviewOptions(),
          retainContextWhenHidden: true
        }
      );
      panel.iconPath = vscode.Uri.file(
        `${globalThis.resourcesPath}/img/luogu-very-small.png`
      );
      currentPanel = panel;
      panel.onDidDispose(() => {
        if (currentPanel === panel) currentPanel = undefined;
      });
      attachWorkbench(panel.webview, listener =>
        panel.onDidDispose(() => listener.dispose())
      );
      panel.webview.html = getReactWebviewHtml(
        panel.webview,
        'webview-workbench.js',
        {}
      );
      return panel;
    }),
    // 命令面板里的「打开工作台」入口。
    vscode.commands.registerCommand('luogu.workbench.open', () =>
      vscode.commands.executeCommand('luogu.workbench')
    )
  );
}
