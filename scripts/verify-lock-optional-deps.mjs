#!/usr/bin/env node
// Guards against npm pruning cross-platform optionalDependencies from
// package-lock.json (it can record only binaries matching the machine that last
// regenerated the lock). A pruned lockfile makes Linux CI installs silently miss
// native binaries and fail far downstream with cryptic errors such as:
//   SyntaxError: Cannot find module '../lightningcss.linux-x64-gnu.node'
//
// Scans every package's optionalDependencies and verifies each declared dep has
// a lockfile entry resolvable via normal node_modules nesting (nearest ancestor
// wins, falling back to the workspace root). Exits non-zero listing offenders.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const ROOT = process.cwd();
const require2 = createRequire(path.join(ROOT, 'package.json'));
const semver = require2('semver');

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const pkgs = lock.packages ?? {};

function candidateLocations(parentKey) {
  if (parentKey === '') return [''];
  const locs = [parentKey];
  let cur = parentKey;
  while (true) {
    const i = cur.lastIndexOf('/node_modules/');
    if (i === -1) break;
    cur = cur.slice(0, i);
    locs.push(cur);
  }
  if (!locs.includes('')) locs.push('');
  return locs;
}
const entryKey = (loc, dep) => (loc === '' ? `node_modules/${dep}` : `${loc}/node_modules/${dep}`);
const compatible = (e, spec) =>
  e && (!spec || !semver.validRange(spec) || semver.satisfies(e.version, spec));

let offending = 0;
for (const [key, v] of Object.entries(pkgs)) {
  if (!v.optionalDependencies) continue;
  for (const [dep, spec] of Object.entries(v.optionalDependencies)) {
    if (!candidateLocations(key).some((loc) => compatible(pkgs[entryKey(loc, dep)], spec))) {
      offending++;
      console.error(`missing optional dependency entry: ${key || '(root)'} -> ${dep}@${spec}`);
    }
  }
}
if (Object.keys(pkgs).some((k) => k.includes('node_modules/node_modules/'))) {
  console.error('malformed keys containing doubled node_modules segments found');
  process.exitCode = 1;
}
if (offending > 0) {
  console.log(
    `\nFAIL: ${offending} optionalDependencies lack lockfile entries.\n` +
      'Fix by adding them manually with registry metadata, or reinstalling the\n' +
      'lockfile on the target platform before regenerating it.'
  );
  process.exitCode = 1;
} else {
  console.log(`OK: ${Object.keys(pkgs).length} lockfile packages, every optionalDependency resolvable`);
}
