import type { EngineRequest, EngineResponse, EngineResult } from "@/workers/protocol";
import type { GenConfig } from "@/data/generator";
import type { Rule } from "@/analytics/rules/rules";

export type ProgressFn = (phase: string, pct: number) => void;

function createWorker(): Worker {
  return new Worker(new URL("../workers/engine.worker.ts", import.meta.url), {
    type: "module",
  });
}

function run(req: EngineRequest, onProgress?: ProgressFn): Promise<EngineResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress?.(msg.phase, msg.pct);
      else if (msg.type === "result") {
        resolve(msg.result);
        worker.terminate();
      } else if (msg.type === "error") {
        reject(new Error(msg.message));
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message));
      worker.terminate();
    };
    worker.postMessage(req);
  });
}

export function initEngine(config: GenConfig, onProgress?: ProgressFn): Promise<EngineResult> {
  return run({ type: "init", config }, onProgress);
}

export function reconfigureEngine(
  config: GenConfig,
  rules: Rule[],
  onProgress?: ProgressFn,
): Promise<EngineResult> {
  return run({ type: "reconfigure", config, rules }, onProgress);
}
