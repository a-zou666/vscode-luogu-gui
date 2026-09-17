/**
 * workbench 的数据归一化。
 *
 * 洛谷 API 的「列表」有历史包袱：`List<T>.result` 现在是数组，早期是以下标为
 * 键的对象；题单里的题目既可能是 `{ problem: T }` 也可能是裸的 `T`。
 * 这些坑在侧边栏 treeviewProvider 里踩过一遍，这里统一收口，别在新面板里
 * 再踩第二次。
 */
import { normalizeTrainingProblems } from '@/commands/traininglist/trainingData';

/** 题单列表里的一项（只保留面板需要的字段）。 */
export interface WorkbenchTraining {
  id: number;
  name: string;
  problemCount: number;
}

/** 题单内的一道题。 */
export interface WorkbenchProblem {
  pid: string;
  title: string;
  difficulty: number | null;
  status?: number;
}

type RawList = {
  result?: unknown;
  count?: number;
  perPage?: number | null;
};

/** `List<T>.result` 归一化成数组（数组 / 下标对象 / 缺失都能吃）。 */
export const toArray = <T>(raw: unknown): T[] => {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'object') return Object.values(raw as Record<string, T>);
  return [];
};

/** 从 `searchTraininglist` 的响应里取题单数组。 */
export const pickTrainings = (data: unknown): WorkbenchTraining[] => {
  const trainings = (data as { trainings?: RawList } | null)?.trainings;
  return toArray<Record<string, unknown>>(trainings?.result).map(item => ({
    id: Number(item['id']),
    name: String(item['name'] ?? item['title'] ?? item['id'] ?? ''),
    problemCount: Number(item['problemCount'] ?? 0)
  }));
};

/**
 * 从 `searchTrainingdetail` 的 `training` 里取题目数组。
 *
 * 两代结构都认：新版 `training.problems` 是 `{ problem: T }[]`（或下标对象），
 * 旧版直接把题目摊在 `training.trainingProblems.result` 下。
 */
export const pickTrainingProblems = (training: unknown): WorkbenchProblem[] => {
  const t = training as
    | {
        problems?: unknown;
        trainingProblems?: RawList;
      }
    | null
    | undefined;
  const raw =
    t?.problems !== undefined
      ? t.problems
      : (t?.trainingProblems as { result?: unknown } | undefined)?.result;
  const list = toArray<Record<string, unknown> | { problem: unknown }>(raw);
  return normalizeTrainingProblems(list as never[]).map(problem => {
    const p = problem as Record<string, unknown>;
    return {
      pid: String(p['pid'] ?? ''),
      title: String(p['title'] ?? p['name'] ?? p['pid'] ?? ''),
      difficulty: (p['difficulty'] as number | null | undefined) ?? null,
      status: p['status'] as number | undefined
    };
  });
};
