import type { GenerateOptions, GenerationProgress, GenerationResult } from '@settlement/core';

export type GenerationWorkerMessage =
  | { type: 'progress'; progress: GenerationProgress }
  | { type: 'result'; result: GenerationResult }
  | { type: 'exception'; exception: string };

const stageLabels: Record<string, string> = {
  buildPatches: '地块规划', optimizeJunctions: '道路衔接', terrain: '水系规划',
  planRoadSkeleton: '道路骨架', subdivideDistricts: '街区划分', buildWalls: '城墙布局',
  planWalledInfill: '墙内补建', buildStreets: '道路与桥梁', createWards: '街区分配',
  planGateApproaches: '城门通道', buildGeometry: '建筑绘制', export: '地图整理',
};
export function generationStageLabel(stage: string): string { return stageLabels[stage] ?? '地图规划'; }

export class GenerationTask {
  private cancelCurrent: (() => void) | null = null;
  cancel(): void { this.cancelCurrent?.(); }
  run(options: GenerateOptions, onProgress?: (progress: GenerationProgress) => void): Promise<GenerationResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
      // Larger layouts can spend longer inside one synchronous geometry stage.
      const inactivityMs = options.size > 40 ? 30_000 : 15_000;
      const seen = new Set<string>();
      let settled = false, lastProgress: GenerationProgress | null = null;
      let inactivityTimer: ReturnType<typeof setTimeout>, totalTimer: ReturnType<typeof setTimeout>;
      const finish = (result?: GenerationResult, error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(inactivityTimer); clearTimeout(totalTimer);
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
        worker.terminate();
        if (this.cancelCurrent === cancel) this.cancelCurrent = null;
        if (error) reject(error); else resolve(result!);
      };
      const cancel = () => finish(undefined, new DOMException('已取消生成', 'AbortError'));
      const watch = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          const message = lastProgress
            ? `生成进度停滞超过 ${inactivityMs / 1000} 秒（第 ${lastProgress.attempt} 次尝试，${generationStageLabel(lastProgress.stage)}），请重试`
            : `生成线程在 ${inactivityMs / 1000} 秒内未返回进度，请重试`;
          finish(undefined, new Error(message));
        }, inactivityMs);
      };
      this.cancelCurrent = cancel;
      worker.onmessage = (event: MessageEvent<GenerationWorkerMessage>) => {
        if (settled) return;
        const message = event.data;
        if (message.type === 'progress') {
          const key = `${message.progress.attempt}/${message.progress.stage}`;
          if (seen.has(key)) return;
          seen.add(key); lastProgress = message.progress; watch();
          try { onProgress?.(message.progress); }
          catch (error) { finish(undefined, error instanceof Error ? error : new Error(String(error))); }
        } else if (message.type === 'result') finish(message.result);
        else if (message.type === 'exception') finish(undefined, new Error(message.exception));
      };
      worker.onerror = event => { event.preventDefault(); finish(undefined, new Error(event.message || '生成线程启动失败')); };
      worker.onmessageerror = () => finish(undefined, new Error('无法读取生成线程结果'));
      watch();
      totalTimer = setTimeout(() => finish(undefined, new Error('生成总耗时超过 120 秒，已停止，请重试')), 120_000);
      try { worker.postMessage(options); }
      catch (error) { finish(undefined, error instanceof Error ? error : new Error(String(error))); }
    });
  }
}
