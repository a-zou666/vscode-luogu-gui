const { default: React } = await import('react');
import { SubtaskStatus, TestCaseStatus } from 'luogu-api';
import useRecordStatus from './data';

const { formatMemory, formatTime } = await import('@/utils/stringUtils');
const { ProblemNameWithDifficulty, Spinner } = await import('@w/components');
import type { TrackingState } from './data';
const { RecordStatus, getScoreColor, LanguageString, vscodeLanguageId } =
  await import('@/utils/shared');
const { default: Time } = await import('@w/components/time');
await import('@w/copyablePreElement');

import '@w/common.css';
import './app.css';

export default function App() {
  const record = useRecordStatus();
  // 服务端可能下发本表未收录的状态码，直接 RecordStatus[status] 会读到
  // undefined 再炸一次（“评测状态”整块白屏），这里统一回退到 Unknown。
  const statusInfo = RecordStatus[record.status] ?? {
    name: `Unknown (${record.status})`,
    shortName: '?',
    color: 'rgb(38, 38, 38)'
  };
  console.log(record);
  return (
    <>
      <h1>
        <a href={`https://www.luogu.com.cn/record/` + record.id}>
          R{record.id}
        </a>{' '}
        记录详情
      </h1>
      <div>
        <div>
          <span>所属题目</span>
          <a
            href={
              'command:luogu.searchProblem?' +
              encodeURIComponent(
                JSON.stringify([
                  { pid: record.problem.pid, cid: record.contest?.id }
                ])
              )
            }
          >
            <ProblemNameWithDifficulty
              {...record.problem}
              difficulty={record.problem?.difficulty || 0}
              contestId={record.contest?.id}
            />
          </a>
        </div>
        <div>
          <span>评测状态</span>
          <span
            style={{
              color: statusInfo.color,
              fontWeight: 'bold'
            }}
          >
            {statusInfo.name}
          </span>
        </div>
        {(record.trackingState.tracking ||
          record.trackingState.timedOut ||
          record.trackingState.errors.length > 0) && (
          <TrackingPanel state={record.trackingState} rid={record.id} />
        )}
        {typeof record.score === 'number' && (
          <div>
            <span>评测分数</span>
            <span
              style={{ fontWeight: 'bold', color: getScoreColor(record.score) }}
            >
              {record.score}
            </span>
          </div>
        )}
        <div>
          <span>提交时间</span>
          <span>
            <Time time={record.submitTime * 1000} />
          </span>
        </div>
        <div>
          <span>语言</span>
          <span>
            {LanguageString[record.language]}
            {record.enableO2 && ' O2'}
          </span>
        </div>
        <div>
          <span>代码长度</span>
          <span>
            {record.sourceCodeLength < 2 ** 10
              ? record.sourceCodeLength + 'B'
              : (record.sourceCodeLength / 2 ** 10).toFixed(2) + 'KiB'}
          </span>
        </div>
        <div>
          <span>用时/内存</span>
          <span>
            {record.time !== null ? formatTime(record.time) : '-'} /{' '}
            {record.memory !== null
              ? formatMemory(record.memory * 2 ** 10)
              : '-'}
          </span>
        </div>
        {record.sourceCode !== undefined && (
          <div>
            <span>源代码</span>
            <a
              href={
                'command:luogu.openUntitledTextDocument?' +
                encodeURIComponent(
                  JSON.stringify({
                    content: record.sourceCode,
                    language: vscodeLanguageId[record.language]
                  })
                )
              }
            >
              在 vscode 中查看
            </a>
          </div>
        )}
      </div>
      {record.status !== 0 && record.status !== -1 && record.status !== 2 && (
        <>
          <hr />
          <div className="testCaseData">
            <h2>测试点信息</h2>
            {record.detail.judgeResult && (
              <TestCaseWarp>{record.detail.judgeResult.subtasks}</TestCaseWarp>
            )}
          </div>
        </>
      )}
      {record.detail.compileResult !== null && record.status === 2 && (
        <>
          <hr />
          <div>
            <h2>编译信息</h2>
            <p>编译失败</p>
            {record.detail.compileResult.message !== null && (
              <pre is="copyable-pre">{record.detail.compileResult.message}</pre>
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * 评测跟踪面板：进度条 + 已等待时间 + 各阶段错误。
 * 目的很直接——让用户一眼看出「在等什么、等多久了、哪一步出错了」，
 * 而不是对着一动不动的快照猜。
 */
function TrackingPanel({ state, rid }: { state: TrackingState; rid: number }) {
  const { tracking, errors, elapsedMs, timedOut } = state;
  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <div
      style={{
        margin: '8px 0',
        padding: '8px 12px',
        border: '1px solid var(--vscode-panel-border, #444)',
        borderRadius: '4px'
      }}
    >
      {tracking && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Spinner />
            <span>正在评测…已等待 {seconds} 秒</span>
          </div>
          {/* 不确定进度条：评测耗时无法预知，只表示“正在进行” */}
          <div
            style={{
              marginTop: '6px',
              height: '4px',
              borderRadius: '2px',
              overflow: 'hidden',
              backgroundColor: 'var(--vscode-progressBar-background, #333)',
              opacity: 0.4
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                backgroundColor:
                  'var(--vscode-progressBar-background, #0e70c0)',
                animation: 'luogu-indeterminate 1.2s ease-in-out infinite'
              }}
            />
          </div>
        </div>
      )}
      {timedOut && !tracking && (
        <div>
          等待超过 {Math.floor(elapsedMs / 1000 / 60) || 5} 分钟仍未拿到结果，
          已停止自动刷新。可点上方 R{rid} 去洛谷查看，或重新执行“查看上次记录”。
        </div>
      )}
      {errors.length > 0 && (
        <div style={{ marginTop: tracking ? '8px' : 0 }}>
          <div style={{ fontWeight: 'bold' }}>跟踪过程中的问题：</div>
          <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
            {errors.map((e, i) => (
              <li key={i}>
                [{e.stage}] {e.message}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: '4px', opacity: 0.8 }}>
            结果可能仍是好的——自动刷新失败通常只是网络或 WebSocket 问题，点上方
            R{rid} 去洛谷可直接确认。
          </div>
        </div>
      )}
    </div>
  );
}

function TestCaseWarp({
  children: data
}: {
  children: { [group: number]: SubtaskStatus };
}) {
  return (
    <div>
      {Object.entries(data).map(([subtaskId, subtask]) => (
        <div key={subtaskId}>
          <h3>Subtask #{subtaskId}</h3>
          <div>
            {Object.entries(subtask.testCases).map(([testcase, data]) => (
              <TestCase key={testcase}>{data}</TestCase>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TestCase({ children: data }: { children: TestCaseStatus }) {
  return (
    <div>
      <div
        style={{
          backgroundColor: RecordStatus[data.status].color
        }}
      >
        <div>#{data.id + 1}</div>
        <div>
          {data.status !== 1 ? (
            RecordStatus[data.status].shortName
          ) : (
            <Spinner />
          )}
        </div>
        {data.status !== 1 && (
          <div>
            {formatTime(data.time)}/{formatMemory(data.memory * 2 ** 10)}
          </div>
        )}
      </div>
      <div>
        {[
          data.description ? data.description : undefined,
          data.signal ? 'Received signal ' + data.signal : undefined,
          data.score + ' points',
          'Exit with code ' + data.exitCode
        ]
          .filter(x => x !== undefined)
          .join('\n')}
      </div>
    </div>
  );
}
