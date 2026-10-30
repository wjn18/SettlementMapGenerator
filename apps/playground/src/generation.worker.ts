import { generateTownSteps } from '@settlement/core';
import type { GenerateOptions } from '@settlement/core';
import type { GenerationWorkerMessage } from './generation-task';
// DOM-free core runs off the UI thread. Unexpected defects remain distinct
// from the library's expected typed generation failures.
self.onmessage = (event: MessageEvent<GenerateOptions>) => {
  const send = (message: GenerationWorkerMessage) => self.postMessage(message);
  try {
    const steps = generateTownSteps(event.data);
    for (;;) {
      const next = steps.next();
      if (next.done) { send({ type: 'result', result: next.value }); break; }
      send({ type: 'progress', progress: next.value });
    }
  } catch (error) { send({ type: 'exception', exception: error instanceof Error ? error.message : String(error) }); }
};
