const { default: React, useEffect, useState } = await import('react');
const { default: send } = await import('@w/webviewRequest');
const { Spinner } = await import('@w/components');
const { RecordStatus } = await import('@/utils/shared');

import './app.css';
import type { PushMessage, UpdateRecordData } from './types';

/** 评测阶段 → 进度条百分比。提交链路是「取文件 → 提交 → 排队 → 评测 → 结果」。 */
const STAGE_PERCENT: Record<string, number> = {
  idle: 0,
  submitting: 25,
  queued: 45,
  judging: 70,
  done: 100
};

interface TrackError {
  stage: string;
  message: string;
}

export default function SubmitPage({
  target
}: {
  target?: { pid: string; cid?: number };
}) {
  const [pid, setPid] = useState(target?.pid ?? '');
  const [state, setState] = useState<
    'idle' | 'submitting' | 'judging' | 'done' | 'error'
  >('idle');
  const [record, setRecord] = useState<UpdateRecordData | undefined>(undefined);
  const [errors, setErrors] = useState<TrackError[]>([]);
  const [fatal, setFatal] = useState<string | undefined>(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [rid, setRid] = useState<number | undefined>(undefined);

  // 目标题目变化（在题目页点了「提交本题」）时同步过来
  useEffect(() => {
    if (target?.pid) setPid(target.pid);
  }, [target?.pid, target?.cid]);

  // 接收扩展侧主动推来的跟踪事件
  useEffect(() => {
    // 具名 handler：匿名箭头函数没法 removeEventListener，组件重挂载后
    // 旧监听器会一直挂在 window 上（每次提交都多叠一个，且写入已卸载的 state）。
    const onMessage = ({ data }: MessageEvent<PushMessage>) => {
      if (data.type === 'updateRecord') {
        // 推送是增量的：只带 status/score 时不能整体替换，否则会把
        // 已有的 detail / judgeResult 冲掉，结果页就只剩“评测中”。
        setRecord(prev => ({
          ...prev,
          ...data.data,
          detail: data.data.detail ?? prev?.detail
        }));
        const s = data.data.status;
        setState(s === 0 || s === 1 ? 'judging' : 'done');
      } else if (data.type === 'trackError') {
        setErrors(prev => [
          ...prev,
          { stage: data.stage, message: data.message }
        ]);
      } else if (data.type === 'trackTimeout') {
        setErrors(prev => [
          ...prev,
          {
            stage: '跟踪评测',
            message: '等待评测结果超时，请稍后在记录页查看'
          }
        ]);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 评测期间走秒
  useEffect(() => {
    if (state !== 'judging') return;
    const t = setInterval(() => setElapsedMs(x => x + 1000), 1000);
    return () => clearInterval(t);
  }, [state]);

  const submit = async () => {
    if (!pid.trim()) {
      setFatal('请先填写题号');
      return;
    }
    setState('submitting');
    setErrors([]);
    setFatal(undefined);
    setRecord(undefined);
    setRid(undefined);
    setElapsedMs(0);
    try {
      const res = await send('workbenchSubmit', {
        pid: pid.trim(),
        cid: target?.cid
      });
      setRid(res.rid);
      // 提交成功 → 立马进入「评测中」，后续由扩展侧推送更新
      setState('judging');
    } catch (e) {
      setState('error');
      setFatal(e instanceof Error ? e.message : String(e));
    }
  };

  const percent = state === 'done' ? 100 : STAGE_PERCENT[state] ?? 0;
  const judging = state === 'submitting' || state === 'judging';

  return (
    <div className="wb-submit">
      <div className="wb-card">
        <h3>提交目标</h3>
        <input
          className="wb-input wb-target"
          placeholder="题号，如 P1001"
          value={pid}
          onChange={e => setPid(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void submit()}
          disabled={judging}
        />
        <h3>当前文件</h3>
        <FileCard />
        <button
          className="wb-btn primary"
          onClick={() => void submit()}
          disabled={judging || !pid.trim()}
        >
          {judging ? '提交中……' : '提交评测'}
        </button>

        <h3>进度</h3>
        <div
          className={
            judging && state === 'submitting'
              ? 'wb-progress indeterminate'
              : 'wb-progress'
          }
        >
          <i style={{ width: `${percent}%` }} />
        </div>
        <StageLine state={state} elapsedMs={elapsedMs} />
        {fatal && (
          <div className="wb-errbox">
            <b>提交失败</b>
            <div>{fatal}</div>
          </div>
        )}
        {errors.map((e, i) => (
          <div className="wb-errbox" key={i}>
            <b>{e.stage}</b>
            <div>{e.message}</div>
          </div>
        ))}
      </div>

      <div className="wb-card">
        <h3>评测结果{rid !== undefined ? ` · R${rid}` : ''}</h3>
        {record ? (
          <Result record={record} />
        ) : state === 'error' ? (
          <div className="wb-empty">提交未完成，暂无结果</div>
        ) : (
          <div className="wb-empty">
            {judging ? (
              <>
                <Spinner /> 等待评测结果……
              </>
            ) : (
              '提交后这里会实时显示评测进度与结果'
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 当前编辑文件卡片：展示文件名/路径/行数，并提示语言与 O2 将按后缀自动配置。 */
function FileCard() {
  // webview 拿不到 VS Code 的编辑器状态，这里只能如实说明「提交时取当前活动文件」。
  return (
    <div className="wb-file">
      <div className="wb-file-name">当前活动编辑器中的文件</div>
      <div className="wb-file-path">
        提交时取 VS Code 当前活动的代码文件；语言与 O2 优化按文件后缀自动匹配，
        仍会弹出确认框供你修改。
      </div>
      <div className="wb-kv" style={{ marginTop: 10 }}>
        <span>支持后缀</span>
        <b>.cpp / .c / .py / .java / .js / .pas / .go / .rs …</b>
      </div>
    </div>
  );
}

const STAGE_TEXT: Record<string, string> = {
  idle: '待提交',
  submitting: '正在读取文件并提交',
  judging: '评测中',
  done: '评测完成',
  error: '提交失败'
};

function StageLine({ state, elapsedMs }: { state: string; elapsedMs: number }) {
  const cls =
    state === 'error'
      ? 'wb-stage error'
      : state === 'done'
        ? 'wb-stage done'
        : state === 'judging' || state === 'submitting'
          ? 'wb-stage running'
          : 'wb-stage';
  return (
    <div className={cls}>
      <span className="dot" />
      <span>
        {STAGE_TEXT[state] ?? state}
        {state === 'judging' && elapsedMs > 0
          ? ` · 已等待 ${Math.round(elapsedMs / 1000)}s`
          : ''}
      </span>
    </div>
  );
}

function Result({ record }: { record: UpdateRecordData }) {
  const info = RecordStatus[record.status] ?? {
    name: `未知状态 (${record.status})`,
    shortName: '?',
    color: '#999'
  };
  const pending = record.status === 0 || record.status === 1;
  const fmt = (v: number | null | undefined, unit: string) =>
    v == null || Number.isNaN(v) ? '—' : `${v}${unit}`;
  return (
    <div className="wb-result">
      <div className="wb-verdict">
        {pending && <Spinner size={22} />}
        <span className="wb-verdict-name" style={{ color: info.color }}>
          {info.name}
        </span>
      </div>
      <div className="wb-statgrid">
        <div className="wb-stat">
          <div className="k">得分</div>
          <div className="v">{record.score ?? '—'}</div>
        </div>
        <div className="wb-stat">
          <div className="k">耗时</div>
          <div className="v">{fmt(record.time, 'ms')}</div>
        </div>
        <div className="wb-stat">
          <div className="k">内存</div>
          <div className="v">
            {record.memory == null || Number.isNaN(record.memory)
              ? '—'
              : `${(record.memory / 1024 / 1024).toFixed(2)}MB`}
          </div>
        </div>
        <div className="wb-stat">
          <div className="k">O2 优化</div>
          <div className="v">{record.enableO2 ? '开' : '关'}</div>
        </div>
      </div>
      {pending && (
        <div className="wb-meta">
          评测尚未结束，结果会在这里自动刷新，无需手动重开面板。
        </div>
      )}
    </div>
  );
}
