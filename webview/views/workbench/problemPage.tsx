const {
  default: React,
  useEffect,
  useMemo,
  useRef,
  useState
} = await import('react');
const { default: send } = await import('@w/webviewRequest');
const { Spinner, ProblemDifficultyTag } = await import('@w/components');
const { default: ArticleViewer } = await import('@w/markdownViewer');
const { getDifficulty } = await import('@/utils/shared');

import './app.css';
import type {
  ProblemData,
  ProblemItem,
  TrainingChannel,
  TrainingDetail,
  TrainingPage,
  TrainingProblemItem
} from './types';

type Mode = 'search' | 'plaza';
type View =
  | { kind: 'list' }
  | { kind: 'training'; id: number; name: string }
  | { kind: 'problem'; pid: string; from?: { id: number; name: string } };

const PAGE_SIZE_HINT = '第 {page} 页';

/** 题目页：搜索框 + 题单广场（频道 → 题单 → 题目，逐级下钻）+ 题目详情内嵌渲染。 */
export default function ProblemPage({
  onSubmitProblem
}: {
  onSubmitProblem: (pid: string, cid?: number) => void;
}) {
  const [mode, setMode] = useState<Mode>('plaza');
  const [view, setView] = useState<View>({ kind: 'list' });

  // 题目详情：从题单里进来的话，返回时回到该题单的题目列表，而不是一级页。
  if (view.kind === 'problem') {
    const from = view.from;
    return (
      <ProblemDetail
        pid={view.pid}
        onBack={() =>
          setView(from ? { kind: 'training', ...from } : { kind: 'list' })
        }
        onSubmitProblem={onSubmitProblem}
      />
    );
  }

  return (
    <div className="wb-pane">
      <div className="wb-toolbar">
        <button
          className={mode === 'plaza' ? 'wb-btn primary' : 'wb-btn'}
          onClick={() => setMode('plaza')}
        >
          题单广场
        </button>
        <button
          className={mode === 'search' ? 'wb-btn primary' : 'wb-btn'}
          onClick={() => setMode('search')}
        >
          搜索题目
        </button>
      </div>
      {mode === 'plaza' ? (
        <Plaza
          openTraining={view.kind === 'training' ? view : undefined}
          onOpenTraining={t =>
            setView(t ? { kind: 'training', ...t } : { kind: 'list' })
          }
          onOpenProblem={pid =>
            setView({
              kind: 'problem',
              pid,
              from:
                view.kind === 'training'
                  ? { id: view.id, name: view.name }
                  : undefined
            })
          }
          onSubmitProblem={onSubmitProblem}
        />
      ) : (
        <SearchPane
          onOpenProblem={pid => setView({ kind: 'problem', pid })}
          onSubmitProblem={onSubmitProblem}
        />
      )}
    </div>
  );
}

/** 搜索题目：关键词 + 难度筛选 + 分页。 */
function SearchPane({
  onOpenProblem,
  onSubmitProblem
}: {
  onOpenProblem: (pid: string) => void;
  onSubmitProblem: (pid: string, cid?: number) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [difficulty, setDifficulty] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProblemItem[] | undefined>(undefined);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // 只有点「搜索」或翻页才发起请求，避免每敲一个字符打一次接口。
  const [query, setQuery] = useState({ keyword: '', difficulty, page: 1 });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    send('workbenchSearchProblem', {
      page: query.page,
      keyword: query.keyword,
      difficulty: query.difficulty
    })
      .then(res => {
        if (!alive) return;
        setItems(res.problems);
        setCount(res.count);
      })
      .catch(e => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(count / 50));

  return (
    <>
      <div className="wb-toolbar">
        <input
          className="wb-input"
          placeholder="输入题号 / 题目名关键词，回车搜索"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              setPage(1);
              setQuery({ keyword, difficulty, page: 1 });
            }
          }}
        />
        <select
          className="wb-input"
          style={{ flex: '0 0 130px' }}
          value={difficulty ?? ''}
          onChange={e => {
            const v =
              e.target.value === '' ? undefined : Number(e.target.value);
            setDifficulty(v);
            setPage(1);
            setQuery({ keyword, difficulty: v, page: 1 });
          }}
        >
          <option value="">全部难度</option>
          <option value="1">入门</option>
          <option value="2">普及-</option>
          <option value="3">普及/提高-</option>
          <option value="4">普及+/提高</option>
          <option value="5">提高+/省选-</option>
          <option value="6">省选/NOI-</option>
          <option value="7">NOI/NOI+/CTS</option>
        </select>
        <button
          className="wb-btn primary"
          onClick={() => {
            setPage(1);
            setQuery({ keyword, difficulty, page: 1 });
          }}
        >
          搜索
        </button>
      </div>
      <div className="wb-scroll">
        {error && <div className="wb-errbox">{error}</div>}
        {loading && !items ? (
          <div className="wb-empty">
            <Spinner /> 正在加载题目……
          </div>
        ) : items && items.length === 0 ? (
          <div className="wb-empty">没有匹配的题目</div>
        ) : (
          <>
            <div className="wb-list">
              {items?.map(p => (
                <ProblemRow
                  key={p.pid}
                  item={p}
                  onOpen={() => onOpenProblem(p.pid)}
                  onSubmit={() => onSubmitProblem(p.pid)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="wb-pager">
                <button
                  className="wb-btn"
                  disabled={page <= 1}
                  onClick={() => {
                    const n = page - 1;
                    setPage(n);
                    setQuery({ ...query, page: n });
                  }}
                >
                  上一页
                </button>
                <span>
                  {PAGE_SIZE_HINT.replace('{page}', String(page))} / 共 {count}{' '}
                  题
                </span>
                <button
                  className="wb-btn"
                  disabled={page >= totalPages}
                  onClick={() => {
                    const n = page + 1;
                    setPage(n);
                    setQuery({ ...query, page: n });
                  }}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** 题单广场：一级=频道 + 题单列表（全宽）；二级=点开的题单内题目列表（全宽）。 */
function Plaza({
  openTraining,
  onOpenTraining,
  onOpenProblem,
  onSubmitProblem
}: {
  openTraining: { id: number; name: string } | undefined;
  onOpenTraining: (t: { id: number; name: string } | undefined) => void;
  onOpenProblem: (pid: string) => void;
  onSubmitProblem: (pid: string, cid?: number) => void;
}) {
  const [channels, setChannels] = useState<TrainingChannel[] | undefined>();
  const [channel, setChannel] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<TrainingPage | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<TrainingDetail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 频道只拉一次
  useEffect(() => {
    send('workbenchTrainingChannels', undefined)
      .then(cs => {
        setChannels(cs);
        if (cs.length > 0) setChannel(cs[0].key);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 频道 / 关键词 / 页码变化 → 拉题单列表
  useEffect(() => {
    if (channel === undefined) return;
    let alive = true;
    setLoadingList(true);
    setError(undefined);
    send('workbenchTrainingList', { channel, page, keyword })
      .then(res => alive && setList(res))
      .catch(e => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoadingList(false));
    return () => {
      alive = false;
    };
  }, [channel, page, keyword]);

  // 点开题单 → 拉该题单的题目（二级页）
  useEffect(() => {
    if (openTraining === undefined) return;
    let alive = true;
    setLoadingDetail(true);
    setDetail(undefined);
    send('workbenchTrainingDetail', { id: openTraining.id })
      .then(res => alive && setDetail(res))
      .catch(e => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoadingDetail(false));
    return () => {
      alive = false;
    };
  }, [openTraining]);

  const totalPages = Math.max(
    1,
    Math.ceil((list?.count ?? 0) / (list?.perPage ?? 50))
  );

  // ── 二级页：题单内的题目，占满整个面板宽度（不再被频道/题单列挤压）──
  if (openTraining !== undefined)
    return (
      <div className="wb-pane">
        <div className="wb-toolbar">
          <button className="wb-btn" onClick={() => onOpenTraining(undefined)}>
            ← 返回题单
          </button>
          <span className="wb-crumb" title={openTraining.name}>
            {openTraining.name}
          </span>
          <span style={{ flex: 1, minWidth: 0 }} />
          {detail && (
            <span className="wb-meta">{detail.problems.length} 题</span>
          )}
        </div>
        <div className="wb-scroll">
          {error && (
            <div className="wb-errbox" style={{ marginBottom: 10 }}>
              {error}
            </div>
          )}
          {loadingDetail ? (
            <div className="wb-empty">
              <Spinner /> 正在加载题目……
            </div>
          ) : !detail || detail.problems.length === 0 ? (
            <div className="wb-empty">该题单暂无题目</div>
          ) : (
            <div className="wb-list">
              {detail.problems.map(p => (
                <TrainingProblemRow
                  key={p.pid}
                  item={p}
                  onOpen={() => onOpenProblem(p.pid)}
                  onSubmit={() => onSubmitProblem(p.pid)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );

  // ── 一级页：频道横排 + 题单列表，纵向排布，题单占满宽度 ──
  return (
    <div className="wb-pane">
      <div className="wb-toolbar">
        <input
          className="wb-input"
          placeholder="在题单广场内搜索题单名，回车搜索"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              setPage(1);
              setKeyword(keyword);
            }
          }}
        />
        <button
          className="wb-btn"
          onClick={() => {
            setPage(1);
            setKeyword(keyword);
          }}
        >
          搜索
        </button>
      </div>
      {error && (
        <div className="wb-errbox" style={{ margin: '10px 16px 0' }}>
          {error}
        </div>
      )}
      <div className="wb-chips-row">
        {channels === undefined ? (
          <Spinner size={18} />
        ) : (
          channels.map(c => (
            <button
              key={c.key}
              className={channel === c.key ? 'wb-chip active' : 'wb-chip'}
              onClick={() => {
                setChannel(c.key);
                setPage(1);
              }}
            >
              {c.name}
            </button>
          ))
        )}
      </div>
      <div className="wb-scroll">
        {loadingList && !list ? (
          <div className="wb-empty">
            <Spinner /> 正在加载题单……
          </div>
        ) : !list || list.trainings.length === 0 ? (
          <div className="wb-empty">该频道下没有题单</div>
        ) : (
          <>
            <div className="wb-list">
              {list.trainings.map(t => (
                <button
                  key={t.id}
                  className="wb-row"
                  onClick={() => onOpenTraining({ id: t.id, name: t.name })}
                >
                  <span className="wb-title">{t.name}</span>
                  <span className="wb-meta">
                    {t.problemCount} 题 · 已过 {t.acceptedCount}
                  </span>
                  <span className="wb-chevron">›</span>
                </button>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="wb-pager">
                <button
                  className="wb-mini"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <span>
                  {page}/{totalPages}
                </span>
                <button
                  className="wb-mini"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProblemRow({
  item,
  onOpen,
  onSubmit
}: {
  item: ProblemItem;
  onOpen: () => void;
  onSubmit: () => void;
}) {
  const d = getDifficulty(item.difficulty);
  return (
    <div className="wb-row" onClick={onOpen}>
      <span className="wb-pid" style={{ color: d.color }}>
        {item.pid}
      </span>
      <span className="wb-title">{item.title}</span>
      {item.difficulty !== null && (
        <ProblemDifficultyTag difficulty={item.difficulty} />
      )}
      <div className="wb-row-actions">
        <button
          className="wb-mini"
          onClick={e => {
            e.stopPropagation();
            onSubmit();
          }}
        >
          提交
        </button>
      </div>
    </div>
  );
}

function TrainingProblemRow({
  item,
  onOpen,
  onSubmit
}: {
  item: TrainingProblemItem;
  onOpen: () => void;
  onSubmit: () => void;
}) {
  const d = getDifficulty(item.difficulty);
  // 洛谷题单里的 status：1=已通过，2=尝试过。用于左侧小圆点。
  const dotClass =
    item.status === 1
      ? 'wb-status-dot pass'
      : item.status === 2
        ? 'wb-status-dot tried'
        : 'wb-status-dot';
  return (
    <div className="wb-row" onClick={onOpen} title={item.title}>
      <span className={dotClass} />
      <span className="wb-pid" style={{ color: d.color }}>
        {item.pid}
      </span>
      <span className="wb-title">{item.title}</span>
      <div className="wb-row-actions">
        <button
          className="wb-mini"
          onClick={e => {
            e.stopPropagation();
            onSubmit();
          }}
        >
          提交
        </button>
      </div>
    </div>
  );
}

/** 题目详情：内嵌渲染题面，不再另开面板。 */
function ProblemDetail({
  pid,
  onBack,
  onSubmitProblem
}: {
  pid: string;
  onBack: () => void;
  onSubmitProblem: (pid: string, cid?: number) => void;
}) {
  const [data, setData] = useState<ProblemData | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setData(undefined);
    setError(undefined);
    send('workbenchProblemDetail', { pid })
      .then(res => alive && setData(res))
      .catch(
        e => alive && setError(e instanceof Error ? e.message : String(e))
      );
    return () => {
      alive = false;
    };
  }, [pid]);

  const problem = data?.problem;
  // `content` 是 ProblemContents 对象（description/background/formatI/formatO/hint），
  // 不是字符串。按洛谷题面顺序拼成一段 markdown 交给 ArticleViewer 渲染。
  const content = useMemo(() => {
    const c = problem?.content;
    if (!c) return '';
    return [
      c.background,
      '## 题目描述',
      c.description,
      c.formatI && '## 输入格式',
      c.formatI,
      c.formatO && '## 输出格式',
      c.formatO,
      c.hint && '## 提示',
      c.hint
    ]
      .filter(x => typeof x === 'string' && x.trim().length > 0)
      .join('\n\n');
  }, [problem]);

  return (
    <div className="wb-pane">
      <div className="wb-toolbar">
        <button className="wb-btn" onClick={onBack}>
          ← 返回列表
        </button>
        <span className="wb-pid" style={{ fontSize: 15 }}>
          {pid}
        </span>
        <span style={{ flex: 1, minWidth: 0 }} />
        <button className="wb-btn primary" onClick={() => onSubmitProblem(pid)}>
          提交本题
        </button>
      </div>
      <div className="wb-detail" ref={ref}>
        {error ? (
          <div className="wb-errbox">
            <b>加载题目失败</b>
            <div>{error}</div>
          </div>
        ) : !problem ? (
          <div className="wb-empty">
            <Spinner /> 正在加载题面……
          </div>
        ) : (
          <>
            <div className="wb-detail-head">
              <h2 style={{ color: getDifficulty(problem.difficulty).color }}>
                {problem.pid !== pid ? `${problem.pid} ` : ''}
                {problem.title}
              </h2>
              <ProblemDifficultyTag difficulty={problem.difficulty ?? 0} />
            </div>
            <div className="wb-detail-meta">
              <span>时间限制 {problem.limits?.time?.join('ms / ')}ms</span>
              <span>内存限制 {problem.limits?.memory?.join('MB / ')}MB</span>
              {problem.totalSubmit !== undefined && (
                <span>提交 {problem.totalSubmit}</span>
              )}
              {problem.totalAccepted !== undefined && (
                <span>通过 {problem.totalAccepted}</span>
              )}
              <span>难度 {getDifficulty(problem.difficulty).name}</span>
            </div>
            <ArticleViewer>{content}</ArticleViewer>
            {problem.samples?.map((s, i) => (
              <div key={i}>
                <h3>样例 {i + 1}</h3>
                <pre>
                  <code>{`输入\n${s[0] ?? ''}\n输出\n${s[1] ?? ''}`}</code>
                </pre>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
