import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require(process.argv[2] || '@babel/parser');
const files = fs.readdirSync('src', { recursive: true }).filter(file => /\.tsx?$/.test(file));
let issues = 0;
for (const file of files) {
  const full = path.join('src', file);
  try {
    const source = fs.readFileSync(full, 'utf8');
    const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    for (const item of ast.program.body) {
      if (item.type === 'ImportDeclaration' && item.source.value.startsWith('.')) {
        const base = path.resolve(path.dirname(full), item.source.value);
        if (![base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].some(p => fs.existsSync(p))) {
          console.error(`${full}: unresolved import ${item.source.value}`); issues++;
        }
      }
    }
  } catch (error) { console.error(`${full}: ${error.message}`); issues++; }
}
if (issues) process.exitCode = 1;
else console.log(`Parsed ${files.length} TypeScript/TSX files; all relative imports resolve.`);
