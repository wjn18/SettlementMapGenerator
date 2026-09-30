import { GenerationContext, RetryableError, ResourceLimitError } from './context.js';
import { Model } from './model.js';
import { SkeletonModel, scalePlannedTown } from './skeleton.js';
import { buildTerrainTown } from './terrain.js';
import { createTownAtlas } from './names.js';
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
    // Preserve bounded retry/geometry headroom for the supported city sizes.
    const areaFactor = Math.max(1, (request.size / 40) ** 2);
    const context = new GenerationContext(request.seed, Math.ceil(2_000_000 * areaFactor), Math.ceil(50_000 * areaFactor)), r = context.random;
    const auto = { plaza: r.bool(), castle: r.bool(), walls: r.bool() };
    const model = new Model(context, request.size, {
      plaza: request.plaza === 'auto' ? auto.plaza : request.plaza,
      castle: request.castle === 'auto' ? auto.castle : request.castle,
      walls: request.walls === 'auto' ? auto.walls : request.walls,
    });
    let message = '', lastStage = '';
    for (let attempt = 1; attempt <= request.maxAttempts; attempt++) {
      try {
        const terrain = buildTerrainTown(new SkeletonModel(context, request.size, model.features), request, attempt);
        for (;;) {
          const next = terrain.next();
          if (next.done) { scalePlannedTown(next.value); next.value.atlas = createTownAtlas(next.value); return { ok: true, town: next.value }; }
          yield { attempt, stage: next.value };
        }
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
