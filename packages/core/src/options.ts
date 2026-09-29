import type { GenerateOptions, NormalizedOptions } from './types.js';
export class OptionsError extends Error {}
export function normalizeOptions(options: GenerateOptions): NormalizedOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new OptionsError('Options must be an object');
  const allowed = ['seed', 'size', 'plaza', 'castle', 'walls', 'maxAttempts'];
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new OptionsError(`Unknown option: ${key}`);
  const integer = (value: unknown, min: number, max: number, name: string): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new OptionsError(`${name} must be an integer in ${min}..${max}`);
    return value;
  };
  const feature = (key: 'plaza' | 'castle' | 'walls') => {
    const value = options[key] === undefined ? 'auto' : options[key];
    if (value !== 'auto' && typeof value !== 'boolean') throw new OptionsError(`${key} must be boolean or "auto"`);
    return value;
  };
  return {
    seed: integer(options.seed, 1, 2147483646, 'seed'), size: integer(options.size, 6, 40, 'size'),
    plaza: feature('plaza'), castle: feature('castle'), walls: feature('walls'),
    maxAttempts: integer(options.maxAttempts === undefined ? 20 : options.maxAttempts, 1, 100, 'maxAttempts'),
  };
}
