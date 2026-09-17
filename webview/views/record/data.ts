import {
  RecordData,
  RecordStatus,
  SubtaskStatus,
  TestCaseStatus,
  ClientboundUpdateRecordStatusMessageData
} from 'luogu-api';

const { default: React } = await import('react');

const context = JSON.parse(
  document.getElementById('lentille-context')!.innerText
) as RecordData;

const isLuoguProblem =
  context.record.problem.type === 'P' ||
  context.record.problem.type === 'B' ||
  context.record.problem.type === 'T' ||
  context.record.problem.type === 'U';

export function processTestcaseData({
  status,
  detail: recordStatus
}: {
  status: number;
  detail: RecordStatus;
}) {
  if (!isLuoguProblem) return recordStatus;
  // not judging
  if (status !== 1) return recordStatus;
  const newJudgeResult = Object.fromEntries(
    Object.entries(context.testCaseGroup).map(([subtask, testcase]) => [
      subtask,
      {
        id: +subtask,
        score: 0,
        status: 1, // Judging
        testCases: Object.fromEntries(
          testcase.map(testcaseId => [
            testcaseId,
            {
              id: testcaseId,
              status: 1, // Judging
              time: NaN,
              memory: NaN,
              score: 0,
              signal: null,
              exitCode: NaN,
              description: 0,
              subtaskID: +subtask
            } satisfies TestCaseStatus
          ])
        ),
        judger: '',
        time: NaN,
        memory: NaN
      } satisfies SubtaskStatus as SubtaskStatus
    ])
  );
  if (!recordStatus.judgeResult)
    recordStatus.judgeResult = {
      subtasks: [],
      finishedCaseCount: 0,
      score: 0,
      status: 0,
      time: 0,
      memory: 0
    };
  Object.entries(recordStatus.judgeResult.subtasks).forEach(
    ([subtask, subtaskStatus]) =>
      Object.entries(subtaskStatus.testCases).forEach(
        ([testcaseID, testcaseStatus]) =>
          (newJudgeResult[subtask].testCases[testcaseID] = testcaseStatus)
      )
  );
  return {
    ...recordStatus,
    judgeResult: {
      ...recordStatus.judgeResult,
      subtasks: newJudgeResult
    }
  };
}

export interface TrackingState {
  /** 是否仍在等待评测结果 */
  tracking: boolean;
  /** 跟踪过程中的问题（阶段 + 原因），按发生顺序累积 */
  errors: { stage: string; message: string }[];
  /** 已等待毫秒数，用于进度显示 */
  elapsedMs: number;
  /** 是否已超时放弃 */
  timedOut: boolean;
}

export default function useRecordStatus() {
  const [recordStatus, setRecordStatus] = React.useState<UpdateRecordData>(
    context.record
  );
  const [tracking, setTracking] = React.useState(
    context.record.status === 0 || context.record.status === 1
  );
  const [errors, setErrors] = React.useState<
    { stage: string; message: string }[]
  >([]);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [timedOut, setTimedOut] = React.useState(false);

  React.useEffect(() => {
    window.addEventListener(
      'message',
      ({ data }: MessageEvent<MessageTypes>) => {
        if (data.type === 'updateRecord') {
          // 服务端推送的是「增量」：往往只带 status/score 等少数字段，
          // 不含 detail/judgeResult。曾经这里直接 setRecordStatus(data.data)
          // 整体替换，把初始 context 里的评测详情一并冲掉，于是面板
          // 只剩 “评测中 / 0ms / 0B”，看不出对错。这里改成合并：
          // detail 缺失时沿用已有值，保证结果一出就能看到。
          setRecordStatus(prev => {
            const merged: UpdateRecordData = {
              ...prev,
              ...data.data,
              detail: data.data.detail ?? prev.detail
            };
            merged.detail = processTestcaseData(merged);
            if (merged.status !== 0 && merged.status !== 1) setTracking(false);
            return merged;
          });
        } else if (data.type === 'trackError') {
          setErrors(prev => [
            ...prev,
            { stage: data.stage, message: data.message }
          ]);
        } else if (data.type === 'trackTimeout') {
          setTimedOut(true);
          setTracking(false);
        }
      }
    );
  }, []);

  // 评测期间走秒，让用户看到「在动」，而不是静默干等
  React.useEffect(() => {
    if (!tracking) return;
    const timer = setInterval(() => setElapsedMs(x => x + 1000), 1000);
    return () => clearInterval(timer);
  }, [tracking]);

  const trackingState: TrackingState = {
    tracking,
    errors,
    elapsedMs,
    timedOut
  };
  return { ...context.record, ...recordStatus, trackingState };
}

export type UpdateRecordData = Omit<
  ClientboundUpdateRecordStatusMessageData['record'],
  'score' | 'memory' | 'time'
> & {
  score?: number | null;
  memory: number | null;
  time: number | null;
};

export type MessageTypes =
  | {
      type: 'updateRecord';
      data: UpdateRecordData;
    }
  | {
      /** 评测跟踪过程中出问题：阶段 + 原因，直接展示给用户，便于定位 */
      type: 'trackError';
      stage: string;
      message: string;
    }
  | {
      /** 轮询到超时仍未出结果 */
      type: 'trackTimeout';
      waitedMs: number;
    };
