// Archived multi-part castles for immutable migration fixtures only.
import { Ward, createOrthoBuilding } from '../../packages/core/dist/wards.js';
export function installLegacyCastles() {
  const original = Ward.prototype.createGeometry;
  Ward.prototype.createGeometry = function() {
    if (this.type !== 'Castle') return original.call(this);
    const p = this.patch.shape.shrinkEq(4);
    this.geometry = createOrthoBuilding(this.model.context, p, Math.sqrt(p.square) * 4, 0.6);
  };
  return () => { Ward.prototype.createGeometry = original; };
}
