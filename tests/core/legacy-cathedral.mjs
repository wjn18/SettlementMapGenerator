// Immutable migration fixtures retain the old ring/subdivision church strategy.
// Public generation always uses the regular, explicitly labelled church plan.
import { Ward, createOrthoBuilding } from '../../packages/core/dist/wards.js';
import { ring } from '../../packages/core/dist/cutter.js';
export function installLegacyCathedrals() {
  const original = Ward.prototype.createGeometry;
  Ward.prototype.createGeometry = function() {
    if (this.type !== 'Cathedral') return original.call(this);
    const c = this.model.context;
    if (!c.random.bool(0.4)) this.geometry = createOrthoBuilding(c, this.getCityBlock(), 50, 0.8);
    else { this.geometry = ring(this.getCityBlock(), 2 + c.random.float() * 4); c.geometry(this.geometry.length); }
  };
  return () => { Ward.prototype.createGeometry = original; };
}
