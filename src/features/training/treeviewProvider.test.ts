import { beforeEach, describe, expect, it, vi } from 'vitest';

class EventEmitter<T> {
  readonly event = vi.fn();
  fire = vi.fn<(event?: T) => void>();
  dispose = vi.fn();
}

vi.mock('vscode', () => ({
  EventEmitter,
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  MarkdownString: class {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }
}));

const processAxiosError = vi.fn(() => vi.fn());
vi.mock('@/utils/workspaceUtils', () => ({ processAxiosError }));

const searchTraininglist = vi.fn();
const searchTrainingdetail = vi.fn();
vi.mock('@/utils/api', () => ({ searchTraininglist, searchTrainingdetail }));

const { default: TrainingTreeviewProvider } = await import(
  './treeviewProvider'
);

const page = (
  trainings: Array<{ id: number; name: string; problemCount: number }>,
  count = trainings.length
) => ({
  categories: [{ key: 'srqc-jc', name: '深入浅出基础篇' }],
  acceptedCounts: { 1: 2 },
  trainings: { count, result: trainings }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('trainingTreeviewProvider channels', () => {
  it('lists the channels reported by the API', async () => {
    searchTraininglist.mockResolvedValueOnce(page([]));
    const provider = new TrainingTreeviewProvider();

    const children = await provider.getChildren();

    expect(searchTraininglist).toHaveBeenCalledWith('official', '', 1);
    expect(children.map(node => node.kind === 'channel' && node.key)).toEqual([
      'srqc-jc'
    ]);
  });

  it('returns an empty root and reports the error when loading fails', async () => {
    searchTraininglist.mockRejectedValueOnce(new Error('boom'));
    const provider = new TrainingTreeviewProvider();

    await expect(provider.getChildren()).resolves.toEqual([]);
    expect(processAxiosError).toHaveBeenCalledWith('加载题单');
  });
});

describe('trainingTreeviewProvider trainings', () => {
  it('expands a channel into training nodes with completion info', async () => {
    searchTraininglist.mockResolvedValueOnce(
      page([{ id: 1, name: '题单甲', problemCount: 10 }], 1)
    );
    const provider = new TrainingTreeviewProvider();
    const channel = {
      kind: 'channel' as const,
      key: 'srqc-jc',
      name: '基础篇'
    };

    const children = await provider.getChildren(channel);

    expect(searchTraininglist).toHaveBeenCalledWith('srqc-jc', '', 1);
    expect(children).toEqual([
      {
        kind: 'training',
        id: 1,
        name: '题单甲',
        accepted: 2,
        problemCount: 10,
        channelKey: 'srqc-jc'
      }
    ]);
  });

  it('appends a more node only when further pages exist', async () => {
    searchTraininglist.mockResolvedValueOnce(
      page([{ id: 1, name: '题单甲', problemCount: 10 }], 51)
    );
    const provider = new TrainingTreeviewProvider();
    const channel = {
      kind: 'channel' as const,
      key: 'srqc-jc',
      name: '基础篇'
    };

    const children = await provider.getChildren(channel);

    expect(children.at(-1)).toEqual({
      kind: 'more',
      channelKey: 'srqc-jc',
      page: 2
    });
  });

  it('caches an expanded channel instead of re-requesting', async () => {
    searchTraininglist.mockResolvedValue(
      page([{ id: 1, name: '题单甲', problemCount: 10 }])
    );
    const provider = new TrainingTreeviewProvider();
    const channel = {
      kind: 'channel' as const,
      key: 'srqc-jc',
      name: '基础篇'
    };

    await provider.getChildren(channel);
    await provider.getChildren(channel);

    expect(searchTraininglist).toHaveBeenCalledTimes(1);

    // refresh() drops the cache so the next expansion refetches.
    provider.refresh();
    await provider.getChildren(channel);
    expect(searchTraininglist).toHaveBeenCalledTimes(2);
  });
});

describe('trainingTreeviewProvider paging', () => {
  it('appends the next page and replaces the more node', async () => {
    searchTraininglist
      .mockResolvedValueOnce(
        page([{ id: 1, name: '题单甲', problemCount: 10 }], 101)
      )
      .mockResolvedValueOnce(
        page([{ id: 2, name: '题单乙', problemCount: 20 }], 101)
      );
    const provider = new TrainingTreeviewProvider();
    const channel = {
      kind: 'channel' as const,
      key: 'srqc-jc',
      name: '基础篇'
    };
    const first = await provider.getChildren(channel);
    expect(first.map(node => node.kind)).toEqual(['training', 'more']);

    await provider.loadMore({ channelKey: 'srqc-jc', page: 2 });

    expect(searchTraininglist).toHaveBeenLastCalledWith('srqc-jc', '', 2);
    // The consumed page-2 node is replaced by the page-3 node at the end.
    const children = await provider.getChildren(channel);
    expect(children.map(node => node.kind)).toEqual([
      'training',
      'training',
      'more'
    ]);
    expect(children.at(-1)).toMatchObject({ page: 3 });
  });

  it('wires the more node up to the load-more command', () => {
    const provider = new TrainingTreeviewProvider();

    const item = provider.getTreeItem({
      kind: 'more',
      channelKey: 'srqc-jc',
      page: 4
    });

    expect(item.command).toEqual({
      command: 'luogu.training.loadMore',
      title: '加载更多题单',
      arguments: [{ channelKey: 'srqc-jc', page: 4 }]
    });
  });

  it('stops offering more once the last page is loaded', async () => {
    searchTraininglist
      .mockResolvedValueOnce(
        page([{ id: 1, name: '题单甲', problemCount: 10 }], 51)
      )
      .mockResolvedValueOnce(
        page([{ id: 2, name: '题单乙', problemCount: 20 }], 51)
      );
    const provider = new TrainingTreeviewProvider();
    const channel = {
      kind: 'channel' as const,
      key: 'srqc-jc',
      name: '基础篇'
    };
    await provider.getChildren(channel);

    await provider.loadMore({ channelKey: 'srqc-jc', page: 2 });

    expect(await provider.getChildren(channel)).toHaveLength(2);
  });

  it('does not render stale siblings when a page fails', async () => {
    searchTraininglist
      .mockResolvedValueOnce(
        page([{ id: 1, name: '题单甲', problemCount: 10 }], 51)
      )
      .mockRejectedValueOnce(new Error('boom'));
    const provider = new TrainingTreeviewProvider();
    const channel = {
      kind: 'channel' as const,
      key: 'srqc-jc',
      name: '基础篇'
    };
    await provider.getChildren(channel);

    await provider.loadMore({ channelKey: 'srqc-jc', page: 2 });

    expect(processAxiosError).toHaveBeenCalledWith('加载题单');
    expect(await provider.getChildren(channel)).toHaveLength(2);
  });
});

describe('trainingTreeviewProvider problems', () => {
  it('expands a training into problem nodes', async () => {
    searchTrainingdetail.mockResolvedValueOnce({
      training: {
        problems: [
          { pid: 'P1000', title: '超级玛丽', status: 1 },
          { problem: { pid: 'P1001', title: 'A+B', status: 2 } }
        ]
      }
    });
    const provider = new TrainingTreeviewProvider();
    const training = {
      kind: 'training' as const,
      id: 7,
      name: '题单甲',
      accepted: 1,
      problemCount: 2,
      channelKey: 'srqc-jc'
    };

    const children = await provider.getChildren(training);

    expect(searchTrainingdetail).toHaveBeenCalledWith(7);
    expect(children).toEqual([
      { kind: 'problem', pid: 'P1000', name: '超级玛丽', status: 1 },
      { kind: 'problem', pid: 'P1001', name: 'A+B', status: 2 }
    ]);
  });

  it('opens the problem from the tree item and maps the status icon', async () => {
    const provider = new TrainingTreeviewProvider();

    const accepted = provider.getTreeItem({
      kind: 'problem',
      pid: 'P1000',
      name: '超级玛丽',
      status: 1
    });
    const submitted = provider.getTreeItem({
      kind: 'problem',
      pid: 'P1001',
      name: 'A+B',
      status: 2
    });
    const untouched = provider.getTreeItem({
      kind: 'problem',
      pid: 'P1002',
      name: '未做'
    });

    expect(accepted.command).toEqual({
      command: 'luogu.searchProblem',
      title: '打开题目',
      arguments: [{ pid: 'P1000' }]
    });
    expect(accepted.contextValue).toBe('luogu.training.problemItem');
    expect((accepted.iconPath as unknown as { id: string }).id).toBe('pass');
    expect((submitted.iconPath as unknown as { id: string }).id).toBe(
      'history'
    );
    expect((untouched.iconPath as unknown as { id: string }).id).toBe(
      'circle-large-outline'
    );
  });

  it('returns an empty problem list and reports the error on failure', async () => {
    searchTrainingdetail.mockRejectedValueOnce(new Error('boom'));
    const provider = new TrainingTreeviewProvider();
    const training = {
      kind: 'training' as const,
      id: 7,
      name: '题单甲',
      accepted: 0,
      problemCount: 0,
      channelKey: 'srqc-jc'
    };

    await expect(provider.getChildren(training)).resolves.toEqual([]);
    expect(processAxiosError).toHaveBeenCalledWith('加载题单');
  });
});
