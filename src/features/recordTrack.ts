import { fetchResult } from '@/utils/api';
import { createWebsocket, WebsocketSchema } from '@/utils/websocket';
import { sleep } from '@/utils/workspaceUtils';
import type { UpdateRecordData } from '@w/views/record/data';

type RecordWebsocket = Awaited<
  ReturnType<typeof createWebsocket<WebsocketSchema.RecordTrack>>
>;

/** 评测未结束的状态码：0=Waiting 1=Judging */
export const isPendingStatus = (status: number) => status === 0 || status === 1;

/** 轮询节奏：前 10 次 800ms（评测通常很快出结果），之后退避到 3s */
const POLL_INTERVAL_MS = 800;
const POLL_INTERVAL_SLOW_MS = 3000;
const POLL_FAST_TRIES = 10;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** 跟踪过程中推给 webview 的事件。 */
export type RecordTrackEvent =
  | { type: 'updateRecord'; data: UpdateRecordData }
  | { type: 'trackError'; stage: string; message: string }
  | { type: 'trackTimeout'; waitedMs: number };

/** 跟踪句柄：调用方可用它提前停止 / 查询是否仍在跟踪。 */
export interface RecordTracker {
  stop: () => void;
  readonly finished: boolean;
}

/**
 * 跟踪一条正在评测的记录，把增量事件交给 `emit`。
 *
 * 设计取舍（与记录详情面板一致）：WebSocket 推送是「服务端推什么就有什么」，
 * 遇到 flush / 断连就只能干等，而且它只给增量字段，拿不到完整 detail。所以：
 *   1) WebSocket 作为「加速器」——收到任意推送立刻去拉一次完整记录；
 *   2) 同时开一个轮询兜底——即使 WS 完全没消息，也能靠轮询拿到结果。
 * 两条路都走 `emit({type:'updateRecord'})`，消费端做合并，谁先到用谁的。
 */
export function trackRecord(
  rid: number,
  emit: (event: RecordTrackEvent) => void,
  onDispose?: (listener: { dispose: () => void }) => void
): RecordTracker {
  let disposed = false;
  let finished = false;
  let connection: RecordWebsocket | undefined;
  let wake: (() => void) | undefined;

  const stop = (disposeWs = true) => {
    finished = true;
    if (disposeWs) connection?.dispose();
    connection = undefined;
    wake?.();
  };

  const push = (data: UpdateRecordData) => {
    if (!disposed) emit({ type: 'updateRecord', data });
  };
  const pushError = (stage: string, e: unknown) => {
    if (!disposed)
      emit({
        type: 'trackError',
        stage,
        message: e instanceof Error ? e.message : String(e)
      });
  };

  // 推送记录里 time/memory/score 是字符串（`${number}`），前端要数字；
  // 空值必须保留 null —— `+null === 0` 会把“还没测评”显示成 “0ms / 0B”。
  const normalize = (r: {
    memory?: unknown;
    time?: unknown;
    score?: unknown;
  }): Pick<UpdateRecordData, 'memory' | 'time' | 'score'> => ({
    memory: r.memory == null ? null : Number(r.memory),
    time: r.time == null ? null : Number(r.time),
    score: r.score == null ? null : Number(r.score)
  });

  /** 拉一次完整记录；返回是否已到终态 */
  const pollOnce = async (): Promise<boolean> => {
    const full = await fetchResult(rid);
    if (disposed) return true;
    if (full.record) push({ ...full.record, ...normalize(full.record) });
    return !isPendingStatus(full.record?.status ?? -1);
  };

  // ── WebSocket：只负责「尽快知道有变化」，不再直接信它的字段 ──
  void createWebsocket<WebsocketSchema.RecordTrack>('record.track', String(rid))
    .then(ws => {
      connection = ws;
      if (disposed) return ws.dispose();
      // 握手包里有初始状态：先渲染一版，让面板立刻有内容
      const initial = ws.data.record;
      if (initial) {
        const nums = normalize(initial);
        push({
          ...initial,
          score: nums.score,
          memory: nums.memory,
          time: nums.time
        } as UpdateRecordData);
      }
      if (initial && !isPendingStatus(initial.status)) {
        stop();
        return;
      }
      ws.event.event(e => {
        if (disposed || finished) return;
        if (e.type === 'error') return pushError('WebSocket', e.data);
        if (e.type === 'close') return;
        // status_push / flush 都当作「有变化」的信号：立刻回拉完整记录
        wake?.();
      });
    })
    .catch(e => {
      // WS 连不上不是致命错误：轮询会兜住，但也如实告诉用户
      if (!disposed) pushError('WebSocket 连接', e);
    });

  // ── 轮询兜底 ──
  void (async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let waits = 0;
    while (!disposed && !finished) {
      try {
        const done = await pollOnce();
        if (done) return stop();
      } catch (e) {
        pushError(waits === 0 ? '首次获取记录' : '刷新记录', e);
        // 单次失败不放弃，继续重试直到超时
      }
      if (disposed || finished) return;
      waits++;
      if (Date.now() > deadline) {
        if (!disposed)
          emit({ type: 'trackTimeout', waitedMs: POLL_TIMEOUT_MS });
        return stop();
      }
      // 等待「轮询间隔」或「WS 通知」中先到的那个
      await Promise.race([
        sleep(
          waits <= POLL_FAST_TRIES ? POLL_INTERVAL_MS : POLL_INTERVAL_SLOW_MS
        ),
        new Promise<void>(r => (wake = r))
      ]);
      wake = undefined;
    }
  })();

  const disposeListener = { dispose: () => (disposed = true) };
  onDispose?.(disposeListener);
  return {
    stop: () => {
      disposed = true;
      stop();
    },
    get finished() {
      return finished;
    }
  };
}
