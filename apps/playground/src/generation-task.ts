import type { GenerateOptions, GenerationResult } from '@settlement/core';
export class GenerationTask {
  private cancelCurrent: (() => void) | null = null;
  cancel(): void { this.cancelCurrent?.(); }
  run(options: GenerateOptions): Promise<GenerationResult> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
      const finish = (result?: GenerationResult, error?: Error) => {
        clearTimeout(timer); worker.terminate(); this.cancelCurrent = null;
        if (error) reject(error); else resolve(result!);
      };
      const timer = setTimeout(() => finish(undefined, new Error('生成超过 15 秒，请调整参数后重试')), 15_000);
      this.cancelCurrent = () => finish(undefined, new DOMException('已取消生成', 'AbortError'));
      worker.onmessage = event => event.data.exception ? finish(undefined, new Error(event.data.exception)) : finish(event.data.result);
      worker.onerror = event => { event.preventDefault(); finish(undefined, new Error(event.message || '生成线程启动失败')); };
      worker.onmessageerror = () => finish(undefined, new Error('无法读取生成线程结果'));
      worker.postMessage(options);
    });
  }
}
