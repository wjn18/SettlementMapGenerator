import { generateTown } from '@settlement/core';
import type { GenerateOptions } from '@settlement/core';
// DOM-free core runs off the UI thread. Unexpected defects remain distinct
// from the library's expected typed generation failures.
self.onmessage = (event: MessageEvent<GenerateOptions>) => {
  try { self.postMessage({ result: generateTown(event.data) }); }
  catch (error) { self.postMessage({ exception: error instanceof Error ? error.message : String(error) }); }
};
