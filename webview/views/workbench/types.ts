import type { ProblemData } from 'luogu-api';
import type { UpdateRecordData } from '@w/views/record/data';

/** 题目列表里的一项（与扩展侧 workbenchSearchProblem 的返回对齐）。 */
export interface ProblemItem {
  pid: string;
  title: string;
  difficulty: number | null;
}

/** 题单广场频道。 */
export interface TrainingChannel {
  key: string;
  name: string;
}

/** 题单广场里的一个题单。 */
export interface TrainingItem {
  id: number;
  name: string;
  problemCount: number;
  acceptedCount: number;
}

/** 题单里的题目。 */
export interface TrainingProblemItem {
  pid: string;
  title: string;
  difficulty: number | null;
  status?: number;
}

/** 题单详情。 */
export interface TrainingDetail {
  id: number;
  name: string;
  problems: TrainingProblemItem[];
}

/** 一页题单列表。 */
export interface TrainingPage {
  trainings: TrainingItem[];
  count: number;
  perPage: number | null;
}

/** 提交页的一句话状态（分阶段）。 */
export type SubmitStage =
  | { phase: 'idle' }
  | { phase: 'getting-file' }
  | { phase: 'submitting' }
  | { phase: 'judging' }
  | { phase: 'done' }
  | { phase: 'error'; stage: string; message: string };

/** 工作台登录态（请求响应与推送共用同一形状）。 */
export interface LoginStatus {
  loggedIn: boolean;
  username?: string;
}

/**
 * 扩展侧主动推给工作台的消息（非请求-响应）。
 *
 * 这些消息走 `{type, ...}` 包络、不带 uuid，与请求-响应通道（`{data|error, uuid}`）
 * 严格分开：`webviewRequest.ts` 只认 uuid，`webviewMessage.d.ts` 里也不登记推送类型。
 */
export type PushMessage =
  | { type: 'updateRecord'; data: UpdateRecordData }
  | { type: 'trackError'; stage: string; message: string }
  | { type: 'trackTimeout'; waitedMs: number }
  | { type: 'loginStatus'; data: LoginStatus };

export type { ProblemData, UpdateRecordData };
