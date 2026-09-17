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

// problemPage 会显式 import copyablePreElement 来注册 <pre is="copyable-pre">。
// 该模块经 @vscode/webview-ui-toolkit 间接触发 window.matchMedia，jsdom 未实现
// （报 "window.matchMedia is not a function"）。复制按钮不是本文件要验的行为，
// 替身掉，让断言聚焦在门控 / 推送 / 页签状态保持上。
vi.mock('@w/copyablePreElement', () => ({ default: {} }));

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

describe('提交页验证码（按需出现）', () => {
  const captchaImage = 'data:image/png;base64,AAAA';

  /** 提交一律被要求验证码；带上 captcha 后成功。 */
  const mockSubmitFlow = () =>
    send.mockImplementation((type: string, data?: { captcha?: string }) => {
      if (type === 'workbenchCaptcha')
        return Promise.resolve({ image: captchaImage });
      if (type === 'workbenchSubmit')
        return Promise.resolve(
          data?.captcha ? { rid: 42 } : { needCaptcha: true }
        );
      return new Promise(() => {});
    });

  const renderSubmit = async () => {
    render(<SubmitPage target={{ pid: 'P1001' }} />);
    await screen.findByText('提交评测');
  };

  it('服务端没要求验证码时，验证码区完全不出现', async () => {
    send.mockImplementation((type: string) =>
      type === 'workbenchSubmit'
        ? Promise.resolve({ rid: 42 })
        : new Promise(() => {})
    );
    await renderSubmit();

    // 常态下版面必须干净：没有验证码框，也不该白拉一张图
    expect(document.querySelector('.wb-captcha')).toBeNull();
    expect(send.mock.calls.some(c => c[0] === 'workbenchCaptcha')).toBe(false);
  });

  it('被要求验证码时，输入框与图形码出现在提交页里（不是弹原生面板）', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));

    // 关键：不再走「红色错误框」，而是把验证码区画出来
    expect(await screen.findByText(/洛谷要求填写验证码/)).toBeTruthy();
    expect(document.querySelector('.wb-captcha')).toBeTruthy();
    const img = document.querySelector<HTMLImageElement>('.wb-captcha-img');
    expect(img?.getAttribute('src')).toBe(captchaImage);
    // 拉图必须真的发生（否则用户看到空框）
    expect(send.mock.calls.some(c => c[0] === 'workbenchCaptcha')).toBe(true);
    // 且不能是失败态
    expect(screen.queryByText('提交失败')).toBeNull();
  });

  it('填入验证码后重发会把 captcha 带上去，并进入评测中', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));
    await screen.findByText(/洛谷要求填写验证码/);

    fireEvent.change(screen.getByPlaceholderText('输入右侧图形验证码'), {
      target: { value: 'abcd' }
    });
    fireEvent.click(screen.getByText('提交评测'));

    // 第二次提交必须带 captcha —— 不带的话服务端还会再要求一次，死循环
    const calls = send.mock.calls.filter(c => c[0] === 'workbenchSubmit');
    expect(calls.length).toBe(2);
    expect(calls[0][1]).toMatchObject({ pid: 'P1001' });
    expect(calls[0][1].captcha).toBeUndefined();
    expect(calls[1][1]).toMatchObject({ pid: 'P1001', captcha: 'abcd' });

    expect(await screen.findByText('评测中')).toBeTruthy();
    expect(screen.queryByText(/洛谷要求填写验证码/)).toBeNull();
  });

  it('点图形码会换一张（重新拉图）', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));
    const img = await screen.findByAltText('验证码');

    const before = send.mock.calls.filter(
      c => c[0] === 'workbenchCaptcha'
    ).length;
    fireEvent.click(img);

    await screen.findByAltText('验证码');
    expect(
      send.mock.calls.filter(c => c[0] === 'workbenchCaptcha').length
    ).toBe(before + 1);
  });

  // 用户反馈：「你的验证码提交按钮在哪里」—— 验证码区里必须有个就地按钮，
  // 不能只靠底部的「提交评测」（它在「当前文件」卡片之下，验证码出现时已滚出视口）。
  it('验证码区里自带提交按钮，且就在验证码容器内', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));
    await screen.findByText(/洛谷要求填写验证码/);

    const btn = screen.getByText('提交验证码');
    expect(btn).toBeTruthy();
    // 关键：它必须挂在 .wb-captcha 内部（就地可用），而不是别处
    expect(btn.closest('.wb-captcha')).toBeTruthy();
  });

  it('验证码区的按钮填码后可提交，并带着 captcha 重发', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));
    await screen.findByText(/洛谷要求填写验证码/);

    fireEvent.change(screen.getByPlaceholderText('输入右侧图形验证码'), {
      target: { value: 'wxyz' }
    });
    fireEvent.click(screen.getByText('提交验证码'));

    const calls = send.mock.calls.filter(c => c[0] === 'workbenchSubmit');
    expect(calls[calls.length - 1][1]).toMatchObject({
      pid: 'P1001',
      captcha: 'wxyz'
    });
    expect(await screen.findByText('评测中')).toBeTruthy();
  });

  it('验证码为空时提交按钮禁用，点了也不会发请求', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));
    await screen.findByText(/洛谷要求填写验证码/);

    const btn = screen.getByText('提交验证码') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fireEvent.click(btn);
    // 只应有第一次（引出验证码的那次）提交，空码不该再发
    const calls = send.mock.calls.filter(c => c[0] === 'workbenchSubmit');
    expect(calls.length).toBe(1);
  });

  it('验证码区出现后输入框自动获得焦点（省一次点击）', async () => {
    mockSubmitFlow();
    await renderSubmit();

    fireEvent.click(screen.getByText('提交评测'));
    await screen.findByText(/洛谷要求填写验证码/);

    const input = screen.getByPlaceholderText('输入右侧图形验证码');
    expect(document.activeElement).toBe(input);
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

describe('页签切换保持题目页状态（提交后不用回根目录重开）', () => {
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

  const renderLoggedIn = async () => {
    send.mockImplementation((type: string) => {
      if (type === 'workbenchLoginStatus') return Promise.resolve(loggedIn);
      if (type === 'workbenchTrainingChannels')
        return Promise.resolve(channels);
      if (type === 'workbenchTrainingList') return Promise.resolve(list);
      if (type === 'workbenchTrainingDetail') return Promise.resolve(detail);
      return new Promise(() => {});
    });
    render(<App />);
    await screen.findByText('官方题单');
  };

  // 顶部页签按 class 取：题单行里也有名为「提交」的按钮，
  // getByRole(name) 会同时命中，用它断言会报 multiple elements。
  const clickTab = (label: '题目' | '提交') => {
    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.wb-tab')
    );
    const tab = tabs.find(t => t.textContent?.trim() === label);
    if (!tab) throw new Error(`找不到页签：${label}`);
    fireEvent.click(tab);
  };

  it('切到提交页再切回，仍停在原题单二级页（回归：以前被卸载，退回一级页）', async () => {
    await renderLoggedIn();

    fireEvent.click(screen.getByText('入门题单'));
    await screen.findByText('A+B Problem');

    clickTab('提交');
    clickTab('题目');

    // 关键：回来还在二级页，而不是从频道根目录重新点一遍
    expect(await screen.findByText('A+B Problem')).toBeTruthy();
    expect(screen.getByText('← 返回题单')).toBeTruthy();
    // 也不该再打一次详情接口（数据仍在内存里，没有被重挂载丢掉）
    expect(
      send.mock.calls.filter(c => c[0] === 'workbenchTrainingDetail').length
    ).toBe(1);
  });

  it('切走时题目页只是隐藏、不卸载（DOM 节点保留）', async () => {
    await renderLoggedIn();
    fireEvent.click(screen.getByText('入门题单'));
    await screen.findByText('A+B Problem');

    clickTab('提交');

    const panes = document.querySelectorAll<HTMLElement>('.wb-tabpane');
    expect(panes.length).toBe(2);
    // 题目页是第一个 pane：隐藏但节点仍在，这是状态得以保留的原因
    expect(panes[0].hidden).toBe(true);
    expect(panes[0].textContent).toContain('A+B Problem');
    expect(panes[1].hidden).toBe(false);
  });
});
