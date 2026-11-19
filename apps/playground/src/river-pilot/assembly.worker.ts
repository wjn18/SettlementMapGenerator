import { buildRiverScene } from '@settlement/renderer-three';
import type { TownData } from '@settlement/core';

self.onmessage = (event: MessageEvent<TownData>) => {
  try {
    const scene = buildRiverScene(event.data);
    const transfer = [scene.terrain, scene.town].flatMap(mesh =>
      [mesh.positions.buffer, mesh.colors.buffer, mesh.patterns.buffer, mesh.ink.buffer] as ArrayBuffer[]);
    self.postMessage({ scene }, { transfer });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
