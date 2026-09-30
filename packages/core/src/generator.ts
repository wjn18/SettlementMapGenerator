import { GenerationContext, RetryableError, ResourceLimitError } from './context.js';
import { Model } from './model.js';
import { exportTown } from './export.js';
import { addRiver } from './river.js';
import { normalizeOptions, OptionsError } from './options.js';
import type { GenerateOptions, NormalizedOptions, GenerationResult, GenerationProgress } from './types.js';

/** Stepwise generation supports cooperative scheduling and isolated interleaving. */
export function generateTownSteps(options: GenerateOptions): Generator<GenerationProgress, GenerationResult, void> {
  let request: NormalizedOptions;
  try { request = normalizeOptions(options); }
  catch (e) {
    if (!(e instanceof OptionsError)) throw e;
    return (function* (): Generator<GenerationProgress, GenerationResult, void> {
      return { ok: false, error: { code: 'INVALID_OPTIONS', stage: 'options', message: e.message, attempts: 0 } };
    })();
  }
  return (function* (): Generator<GenerationProgress, GenerationResult, void> {
    const context = new GenerationContext(request.seed), r = context.random;
    const auto = { plaza: r.bool(), castle: r.bool(), walls: r.bool() };
    const model = new Model(context, request.size, {
      plaza: request.plaza === 'auto' ? auto.plaza : request.plaza,
      castle: request.castle === 'auto' ? auto.castle : request.castle,
      walls: request.walls === 'auto' ? auto.walls : request.walls,
    });
    let message = '', lastStage = '';
    for (let attempt = 1; attempt <= request.maxAttempts; attempt++) {
      try {
        for (const stage of model.build()) yield { attempt, stage };
        context.stage = 'export';
        const town = exportTown(model, request, attempt);
        if (request.river) { context.stage = 'river'; addRiver(town); yield { attempt, stage: 'river' }; }
        return { ok: true, town };
      } catch (e) {
        if (e instanceof ResourceLimitError) return { ok: false, error: { code: 'RESOURCE_LIMIT', stage: context.stage, message: e.message, attempts: attempt } };
        if (!(e instanceof RetryableError)) throw e;
        message = e.message; lastStage = context.stage;
      }
    }
    return { ok: false, error: { code: 'GENERATION_FAILED', stage: lastStage, message, attempts: request.maxAttempts } };
  })();
}
export function generateTown(options: GenerateOptions): GenerationResult {
  const steps = generateTownSteps(options);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}
