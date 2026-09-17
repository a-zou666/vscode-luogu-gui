// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent
} from '@testing-library/react';

// 项目 JSX 走 classic transform（tsconfig "jsx": "react"），需显式引入 React。
const { default: React } = await import('react');

// 真实 webview 里通信能力由宿主注入的 acquireVsCodeApi() 提供，jsdom 没有这个全局；
// app.tsx / submitPage.tsx 都经由 @w/webviewRequest 发请求，这里整体替换。
// 顺带避免真实模块在顶层注册的 window message 监听干扰监听器计数断言。
const send = vi.fn();
vi.mock('@w/webviewRequest', () => ({
  default: (...args: unknown[]) => send(...args)
}));

// markdownViewer 在模块加载期就读 document.body 上的 VS Code 主题属性并抛错，
// 它只服务于题目页的题面渲染，与登录门控/推送链路无关，这里替身掉。
vi.mock('@w/markdownViewer', () => ({ default: () => null }));

/** 模拟扩展侧 postMessage 推送到 webview（推送包络：{type, data}，不带 uuid）。 */
const push = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });

const loggedOut = { loggedIn: false };
const loggedIn = { loggedIn: true, username: 'azhou' };

const { default: App } = await import('./app');
const { default: SubmitPage } = await import('./submitPage');

beforeEach(() => {
  send.mockReset();
  // 默认：挂载时那次「查登录态」返回未登录
  send.mockImplementation((type: string) => {
    if (type === 'workbenchLoginStatus')
      return Promise.resolve({ loggedIn: false });
    return new Promise(() => {});
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('工作台登录门控（缺陷 1 回归）', () => {
  it('未登录时显示门控，且不渲染业务页面', async () => {
    render(<App />);
    expect(await screen.findByText('需要登录')).toBeTruthy();
    expect(screen.getByText('登录洛谷账号')).toBeTruthy();
    // 门控只替换正文：页签仍在（header 常驻），但题目/提交页正文不应挂载
    expect(document.querySelector('.wb-gate')).toBeTruthy();
    expect(document.querySelector('.wb-col')).toBeNull();
  });

  it('收到 loginStatus 推送后门控消失、显示用户名（这是原先不生效的路径）', async () => {
    render(<App />);
    await screen.findByText('需要登录');

    // 用户在扩展宿主里完成登录 → 扩展侧订阅 onDidChangeSessions 推来 loginStatus
    push({ type: 'loginStatus', data: loggedIn });

    expect(await screen.findByText('azhou')).toBeTruthy();
    expect(screen.queryByText('需要登录')).toBeNull();
    // 登录后业务页面接管，页签可见（按 role 取，避免与题单列表的列标题重名）
    expect(screen.getByRole('button', { name: '题目' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交' })).toBeTruthy();
  });

  it('登出推送会把门控重新显示出来', async () => {
    render(<App />);
    await screen.findByText('需要登录');
    push({ type: 'loginStatus', data: loggedIn });
    await screen.findByText('azhou');

    push({ type: 'loginStatus', data: loggedOut });

    expect(await screen.findByText('需要登录')).toBeTruthy();
    expect(screen.queryByText('azhou')).toBeNull();
  });

  it('推送只按 type 分发：其它 type 不会误改登录态', async () => {
    render(<App />);
    await screen.findByText('需要登录');

    push({ type: 'trackTimeout', stage: '跟踪评测', message: '超时' });

    expect(screen.getByText('需要登录')).toBeTruthy();
  });
});

describe('监听器不泄漏（缺陷 2 回归）', () => {
  const messageListeners = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(c => c[0] === 'message').length;

  it('App 卸载后 message 监听器成对注销', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const view = render(<App />);
    await screen.findByText('需要登录');
    expect(messageListeners(add)).toBe(1);

    view.unmount();
    expect(messageListeners(remove)).toBe(1);
  });

  it('SubmitPage 卸载后 message 监听器成对注销', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const view = render(<SubmitPage />);
    expect(messageListeners(add)).toBe(1);

    view.unmount();
    expect(messageListeners(remove)).toBe(1);
  });

  it('重复挂载/卸载不会累积监听器', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    for (let i = 0; i < 3; i++) {
      const view = render(<SubmitPage />);
      view.unmount();
    }
    expect(messageListeners(add)).toBe(3);
    expect(messageListeners(remove)).toBe(3);
  });
});

describe('评测推送的增量合并（缺陷 3 回归）', () => {
  it('增量推送（只带 status/score）不会冲掉已有的耗时/内存', async () => {
    render(<SubmitPage target={{ pid: 'P1001' }} />);

    // 首帧：判题中，带 time/memory
    push({
      type: 'updateRecord',
      data: { status: 1, score: 0, time: 500, memory: 1048576 }
    });
    expect(await screen.findByText('500ms')).toBeTruthy();
    expect(screen.getByText('1.00MB')).toBeTruthy();

    // 增量帧：洛谷只推 status/score，不带 time/memory。
    // 若整体替换（丢掉 ...prev），耗时/内存会被清成「—」，用户就看不到评测开销了。
    push({ type: 'updateRecord', data: { status: 2, score: 100 } });

    expect(await screen.findByText('Compile Error')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    // 合并生效的直接证据：增量帧没有 time/memory，但旧值必须还在
    expect(screen.getByText('500ms')).toBeTruthy();
    expect(screen.getByText('1.00MB')).toBeTruthy();
  });

  it('trackError 推送会渲染到错误区', async () => {
    render(<SubmitPage target={{ pid: 'P1001' }} />);

    push({ type: 'trackError', stage: '跟踪评测', message: '连接中断' });

    expect(await screen.findByText('连接中断')).toBeTruthy();
  });
});

describe('题单广场二级页面（布局回归）', () => {
  const channels = [{ key: 'official', name: '官方题单' }];
  const list = {
    trainings: [{ id: 7, name: '入门题单', problemCount: 2, acceptedCount: 1 }],
    count: 1,
    perPage: 50
  };
  const detail = {
    id: 7,
    name: '入门题单',
    problems: [{ pid: 'P1001', title: 'A+B Problem', difficulty: 1, status: 1 }]
  };

  const renderPlaza = async () => {
    send.mockImplementation((type: string) => {
      if (type === 'workbenchTrainingChannels')
        return Promise.resolve(channels);
      if (type === 'workbenchTrainingList') return Promise.resolve(list);
      if (type === 'workbenchTrainingDetail') return Promise.resolve(detail);
      return new Promise(() => {});
    });
    const { default: ProblemPage } = await import('./problemPage');
    render(<ProblemPage onSubmitProblem={() => {}} />);
    await screen.findByText('入门题单');
  };

  it('一级页只渲染频道横排 + 全宽题单列表，不再有三列布局', async () => {
    await renderPlaza();
    // 旧的「频道|题单|题目」三列被移除：题目列不再与题单列并排挤占宽度
    expect(document.querySelector('.wb-col')).toBeNull();
    expect(document.querySelector('.wb-chips-row')).toBeTruthy();
    expect(screen.getByText('官方题单')).toBeTruthy();
  });

  it('点开题单进入二级页展示题目，且能返回题单列表', async () => {
    await renderPlaza();

    fireEvent.click(screen.getByText('入门题单'));

    // 二级页：题单内题目铺满整宽，返回按钮可用
    expect(await screen.findByText('A+B Problem')).toBeTruthy();
    expect(screen.getByText('← 返回题单')).toBeTruthy();
    expect(send).toHaveBeenCalledWith('workbenchTrainingDetail', { id: 7 });
    // 二级页里不再并排渲染一级页的频道横排
    expect(document.querySelector('.wb-chips-row')).toBeNull();

    fireEvent.click(screen.getByText('← 返回题单'));

    expect(await screen.findByText('官方题单')).toBeTruthy();
    expect(screen.queryByText('A+B Problem')).toBeNull();
  });
});
