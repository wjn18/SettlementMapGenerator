import type { GenerateOptions, NormalizedOptions } from './types.js';
export class OptionsError extends Error {}
export function normalizeOptions(options: GenerateOptions): NormalizedOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new OptionsError('Options must be an object');
  const allowed = ['seed', 'size', 'plaza', 'castle', 'walls', 'maxAttempts', 'river', 'coast', 'harbor'];
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
  if (options.river !== undefined && typeof options.river !== 'boolean') throw new OptionsError('river must be boolean');
  if (options.coast !== undefined && options.coast !== false && !['auto', 'east', 'south', 'west', 'north'].includes(options.coast)) throw new OptionsError('coast must be false, auto, east, south, west or north');
  if (options.harbor !== undefined && typeof options.harbor !== 'boolean') throw new OptionsError('harbor must be boolean');
  return {
    seed: integer(options.seed, 1, 2147483646, 'seed'), size: integer(options.size, 6, 40, 'size'),
    plaza: feature('plaza'), castle: feature('castle'), walls: feature('walls'),
    maxAttempts: integer(options.maxAttempts === undefined ? 20 : options.maxAttempts, 1, 100, 'maxAttempts'),
    ...(options.river === undefined ? {} : { river: options.river }),
    ...(options.coast === undefined ? {} : { coast: options.coast }),
    ...(options.harbor === undefined ? {} : { harbor: options.harbor }),
  };
}
