import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'scripts/verify-upstream.mjs')], { stdio: 'inherit' });
const instrumented = process.argv.includes('--instrumented');
const target = path.join(root, 'artifacts', instrumented ? 'legacy-instrumented' : 'legacy-original');
mkdirSync(target, { recursive: true });
for (const entry of ['Source', 'Assets', 'project.xml', 'LICENSE', 'README.md']) {
  cpSync(path.join(root, 'legacy/TownGeneratorOS', entry), path.join(target, entry), { recursive: true });
}
if (instrumented) {
  function replace(file, before, after) {
    const full = path.join(target, file);
    const text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    if (text.split(before).length !== 2) throw new Error(`Expected exactly one instrumentation site: ${file}: ${before}`);
    writeFileSync(full, text.replace(before, after));
  }
  const model = 'Source/com/watabou/towngenerator/building/Model.hx';
  replace(model, 'private function build():Void {', 'private function build():Void {\n\t\tBaseline.begin();');
  replace(model, 'trace( e.message );', 'trace( e.message );\n\t\t\tBaseline.failed(e.message);');
  for (const method of ['buildPatches', 'optimizeJunctions', 'buildWalls', 'buildStreets', 'createWards', 'buildGeometry']) {
    replace(model, `\t\t${method}();`, `\t\t${method}();\n\t\tBaseline.capture("${method}", this);`);
  }
  replace('Source/com/watabou/towngenerator/Main.hx', 'new Model( StateManager.size, StateManager.seed );',
    'new Model( StateManager.size, StateManager.seed );\n\t\tBaseline.finish();');
  cpSync(path.join(root, 'tools/legacy-harness/Baseline.hx'), path.join(target, 'Source/Baseline.hx'));
}
console.log(`Prepared ${instrumented ? 'instrumented' : 'unchanged'} legacy build at ${target}`);
