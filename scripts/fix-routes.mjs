/**
 * Pós-build: reescreve dist/_routes.json para que TODOS os arquivos
 * estáticos em dist/ (incluindo qualquer *.ofx) sejam servidos
 * diretamente pelo Cloudflare Pages sem passar pelo Worker.
 */
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
if (!fs.existsSync(dist)) {
  console.error('dist/ não encontrado. Rode `vite build` antes.');
  process.exit(1);
}

// Lista todos os arquivos/dirs no topo de dist/ (exceto _worker.js e _routes.json)
const entries = fs
  .readdirSync(dist, { withFileTypes: true })
  .filter((e) => e.name !== '_worker.js' && e.name !== '_routes.json');

const excludes = ['/favicon.ico'];
for (const e of entries) {
  if (e.isDirectory()) {
    excludes.push(`/${e.name}/*`);
  } else {
    excludes.push(`/${e.name}`);
  }
}

const routes = {
  version: 1,
  include: ['/*'],
  exclude: [...new Set(excludes)].sort(),
};

fs.writeFileSync(
  path.join(dist, '_routes.json'),
  JSON.stringify(routes),
  'utf-8'
);
console.log('✔ _routes.json atualizado:', routes.exclude);
