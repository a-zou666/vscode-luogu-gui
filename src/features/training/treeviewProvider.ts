import * as vscode from 'vscode';
import { searchTrainingdetail, searchTraininglist } from '@/utils/api';
import { processAxiosError } from '@/utils/workspaceUtils';
import {
  getAcceptedCount,
  normalizeTrainingProblems,
  type TrainingCategory
} from '@/commands/traininglist/trainingData';

/** The Luogu training list API returns 50 trainings per page. */
const PER_PAGE = 50;

export type TrainingTreeNode =
  | { kind: 'channel'; key: string; name: string }
  | {
      kind: 'training';
      id: number;
      name: string;
      accepted: number;
      problemCount: number;
      channelKey: string;
    }
  | { kind: 'problem'; pid: string; name: string; status?: number }
  | { kind: 'more'; channelKey: string; page: number };

type TrainingListData = Parameters<typeof getAcceptedCount>[0] & {
  categories?: TrainingCategory[];
  trainings?: {
    count?: number;
    result?:
      | Array<Record<string, unknown>>
      | Record<string, Record<string, unknown>>;
  };
};

const getTrainingList = async (channelKey: string, page: number) =>
  (await searchTraininglist(channelKey, '', page)) as TrainingListData;

/**
 * Sidebar tree of the training plaza. Its data flow mirrors the training-list
 * webview: the root lists the channels reported by the official API, expanding
 * a channel loads one page of trainings at a time, and expanding a training
 * loads every problem it contains.
 */
export default class TrainingTreeviewProvider
  implements vscode.TreeDataProvider<TrainingTreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TrainingTreeNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  /** Expanded nodes are cached until `refresh()`, so folding never re-fetches. */
  private cache = new Map<string, TrainingTreeNode[]>();

  /** Root: the channels reported by the API, mapped to expandable nodes. */
  async getChildren(element?: TrainingTreeNode): Promise<TrainingTreeNode[]> {
    if (element === undefined) return this.load('root', this.loadChannels);
    if (element.kind === 'channel')
      return this.load(`channel:${element.key}`, () =>
        this.loadTrainings(element.key, 1)
      );
    if (element.kind === 'training')
      return this.load(`training:${element.id}`, () =>
        this.loadProblems(element.id)
      );
    // A `more` node carries toggled-on page content instead of its own loader.
    // 'more' and 'problem' nodes are leaves.
    return [];
  }

  getTreeItem(element: TrainingTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'channel':
        return {
          label: element.name,
          iconPath: new vscode.ThemeIcon('library'),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          contextValue: 'luogu.training.channelItem'
        };
      case 'training':
        return {
          label: element.name,
          description: `${element.accepted} / ${element.problemCount}`,
          iconPath: new vscode.ThemeIcon('folder-library'),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          tooltip: new vscode.MarkdownString(
            `[${element.id}](https://www.luogu.com.cn/training/${element.id}) ${element.name}  \n` +
              `完成度：${element.accepted} / ${element.problemCount}`
          ),
          contextValue: 'luogu.training.trainingItem'
        };
      case 'problem':
        return {
          label: `${element.pid} ${element.name}`,
          command: {
            command: 'luogu.searchProblem',
            title: '打开题目',
            arguments: [{ pid: element.pid }]
          },
          iconPath: new vscode.ThemeIcon(
            TrainingTreeviewProvider.statusIcon(element.status)
          ),
          tooltip: new vscode.MarkdownString(
            `[${element.pid}](https://www.luogu.com.cn/problem/${element.pid}) ${element.name}`
          ),
          contextValue: 'luogu.training.problemItem'
        };
      case 'more':
        return {
          label: '加载更多…',
          iconPath: new vscode.ThemeIcon('ellipsis'),
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          command: {
            command: 'luogu.training.loadMore',
            title: '加载更多题单',
            arguments: [{ channelKey: element.channelKey, page: element.page }]
          },
          contextValue: 'luogu.training.moreItem'
        };
    }
  }

  /** The status icon tracks the current user's progress on the problem. */
  private static statusIcon(status?: number) {
    if (status === 1) return 'pass';
    if (status === 2) return 'history';
    return 'circle-large-outline';
  }

  async loadChannels() {
    const data = await getTrainingList('official', 1);
    const categories = data?.categories;
    // The API may omit `categories`; the webview falls back in that case.
    if (!Array.isArray(categories) || categories.length === 0)
      throw new Error('题单分类加载失败');
    return categories.map(
      (category): TrainingTreeNode => ({
        kind: 'channel',
        key: category.key,
        name: category.name
      })
    );
  }

  async loadTrainings(channelKey: string, page: number) {
    const data = await getTrainingList(channelKey, page);
    const raw = data?.trainings?.result;
    if (raw === undefined || raw === null) throw new Error('题单加载失败');
    // `result` is an array in the current API and a keyed object historically.
    const list = (
      Array.isArray(raw) ? raw : normalizeTrainingProblems(Object.values(raw))
    ) as Array<Record<string, unknown>>;
    const nodes = list.map(
      (item): TrainingTreeNode => ({
        kind: 'training',
        id: Number(item['id']),
        name: String(item['name'] ?? item['title'] ?? item['id']),
        accepted: getAcceptedCount(data, Number(item['id'])),
        problemCount: Number(item['problemCount'] ?? 0),
        channelKey
      })
    );
    const count = Number(data?.trainings?.count ?? nodes.length);
    if (count > page * PER_PAGE)
      nodes.push({ kind: 'more', channelKey, page: page + 1 });
    return nodes;
  }

  async loadProblems(trainingId: number) {
    const data = await searchTrainingdetail(trainingId);
    const problems = data?.training?.problems;
    if (!Array.isArray(problems)) return [];
    return normalizeTrainingProblems(
      problems as Array<
        Record<string, unknown> | { problem: Record<string, unknown> }
      >
    ).map(
      (problem): TrainingTreeNode => ({
        kind: 'problem',
        pid: String(problem['pid']),
        name: String(problem['title'] ?? problem['name'] ?? ''),
        status: problem['status'] as number | undefined
      })
    );
  }

  /**
   * Loads and caches the children of one node. `getChildren` has no element to
   * attach the cache to on failure, so errors return `[]` and surface once as a
   * toast; otherwise a failure would look like an empty view.
   */
  private load(key: string, fetch: () => Promise<TrainingTreeNode[]>) {
    const cached = this.cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    return fetch().then(
      nodes => {
        this.cache.set(key, nodes);
        return nodes;
      },
      err => {
        processAxiosError('加载题单')(err);
        return [];
      }
    );
  }

  /**
   * Appends the next page to a `more` node's siblings. VS Code re-renders the
   * parent's children after `onDidChangeTreeData`, so the freshly loaded page
   * must already be in the cache before the event fires.
   */
  async loadMore(node: { channelKey: string; page: number }): Promise<void> {
    const key = `channel:${node.channelKey}`;
    // Fetch unconditionally: the channel's first page is already cached, so a
    // cache lookup here would hand back page 1 instead of the requested page.
    const addition = await this.loadTrainings(node.channelKey, node.page).catch(
      err => {
        processAxiosError('加载题单')(err);
        return undefined;
      }
    );
    // A failed load must not resurrect a partial page.
    const existing = addition && this.cache.get(key);
    if (existing) {
      // Drop the consumed `more` node, then append the page, so the next
      // `more` node lands at the very end.
      const consumed = existing.findIndex(
        n => n.kind === 'more' && n.page === node.page
      );
      if (consumed !== -1) existing.splice(consumed, 1);
      existing.push(...addition);
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh() {
    this.cache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose() {
    this._onDidChangeTreeData.dispose();
  }
}
