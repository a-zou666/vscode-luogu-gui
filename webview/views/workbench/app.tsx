const { default: React, useEffect, useState } = await import('react');
const { default: send } = await import('@w/webviewRequest');
const { Spinner } = await import('@w/components');

import '@w/common.css';
import './app.css';
import ProblemPage from './problemPage';
import SubmitPage from './submitPage';
import type { LoginStatus, PushMessage } from './types';

type Tab = 'problem' | 'submit';

export default function App() {
  const [tab, setTab] = useState<Tab>('problem');
  const [login, setLogin] = useState<LoginStatus | undefined>(undefined);
  // 提交页选中的题目：题目页点「提交本题」后带着 pid 切到提交页。
  const [submitTarget, setSubmitTarget] = useState<
    { pid: string; cid?: number } | undefined
  >(undefined);

  useEffect(() => {
    send('workbenchLoginStatus', undefined)
      .then(setLogin)
      .catch(() => setLogin({ loggedIn: false }));
  }, []);

  // 登录/登出发生在扩展宿主里（command:luogu.signin），webview 无从感知 ——
  // 只靠挂载时查一次的话，用户登录成功后门控不会消失。扩展侧订阅了
  // authProvider.onDidChangeSessions 并推 loginStatus，这里消费它。
  useEffect(() => {
    const onMessage = ({ data }: MessageEvent<PushMessage>) => {
      if (data.type === 'loginStatus') setLogin(data.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const openSubmit = (pid: string, cid?: number) => {
    setSubmitTarget({ pid, cid });
    setTab('submit');
  };

  if (login === undefined)
    return (
      <div className="wb-loading">
        <Spinner />
        <span>正在载入工作台……</span>
      </div>
    );

  return (
    <div className="wb-root">
      <header className="wb-topbar">
        <div className="wb-brand">
          <span className="wb-logo">Luogu</span>
          <span className="wb-subtitle">工作台</span>
        </div>
        <nav className="wb-tabs">
          <button
            className={tab === 'problem' ? 'wb-tab active' : 'wb-tab'}
            onClick={() => setTab('problem')}
          >
            题目
          </button>
          <button
            className={tab === 'submit' ? 'wb-tab active' : 'wb-tab'}
            onClick={() => setTab('submit')}
          >
            提交
          </button>
        </nav>
        <div className="wb-user">
          {login.loggedIn ? (
            <span className="wb-user-name">{login.username ?? '已登录'}</span>
          ) : (
            <a className="wb-signin" href="command:luogu.signin">
              登录洛谷
            </a>
          )}
        </div>
      </header>
      <main className="wb-body">
        {!login.loggedIn ? (
          <div className="wb-gate">
            <div className="wb-gate-card">
              <h2>需要登录</h2>
              <p>工作台需要洛谷账号才能加载题目与题单数据。</p>
              <a className="wb-gate-btn" href="command:luogu.signin">
                登录洛谷账号
              </a>
            </div>
          </div>
        ) : (
          // 两个页签都保持挂载，只切显隐 —— 之前是 `tab === 'problem' ? A : B`，
          // 切页签会卸载另一个组件，题目页的下钻位置（频道→题单→题目→题面）
          // 和已拉到的数据全部丢掉，回来只能从根目录重新点一遍。
          // 顺带的好处：切到提交页后，评测进度仍在后台更新，回来即见最新结果。
          <>
            <div className="wb-tabpane" hidden={tab !== 'problem'}>
              <ProblemPage onSubmitProblem={openSubmit} />
            </div>
            <div className="wb-tabpane" hidden={tab !== 'submit'}>
              <SubmitPage target={submitTarget} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
