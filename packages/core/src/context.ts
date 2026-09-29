// Algorithm derived from watabou/TownGeneratorOS (GPL-3.0); see repository LICENSE.
export class Random {
  constructor(public state: number) {}
  next(): number { return this.state = Math.trunc((this.state * 48271) % 2147483647); }
  float(): number { return this.next() / 2147483647; }
  int(min: number, max: number): number { return Math.trunc(min + this.float() * (max - min)); }
  bool(chance = 0.5): boolean { return this.float() < chance; }
  normal(): number { return (this.float() + this.float() + this.float()) / 3; }
  fuzzy(f = 1): number { return f === 0 ? 0.5 : (1 - f) / 2 + f * this.normal(); }
}

/** Only expected geometric failures are retried. Programming errors propagate. */
export class RetryableError extends Error {}
export class ResourceLimitError extends Error {}
export class GenerationContext {
  readonly random: Random;
  stage = 'options';
  private operations = 0;
  private geometryCount = 0;
  constructor(seed: number, readonly operationLimit = 2_000_000) { this.random = new Random(seed); }
  step(depth = 0): void {
    if (++this.operations > this.operationLimit || depth > 128) {
      throw new ResourceLimitError('Geometry operation or recursion budget exceeded');
    }
  }
  geometry(count = 1): void {
    this.geometryCount += count;
    if (this.geometryCount > 50_000) throw new ResourceLimitError('Generated polygon budget exceeded');
  }
}
export function remove<T>(array: T[], value: T): void {
  const i = array.indexOf(value); if (i !== -1) array.splice(i, 1);
}
export function add<T>(array: T[], value: T): void { if (!array.includes(value)) array.push(value); }
export function minimum<T>(array: readonly T[], score: (value: T) => number): T {
  if (!array.length) throw new RetryableError('Empty candidate set');
  let result = array[0], best = score(result);
  for (let i = 1; i < array.length; i++) {
    const value = score(array[i]); if (value < best) { best = value; result = array[i]; }
  }
  return result;
}
export const sign = (value: number): number => value === 0 ? 0 : value < 0 ? -1 : 1;
