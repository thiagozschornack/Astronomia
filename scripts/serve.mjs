// Servidor local só para pré-visualizar a pasta www/ no navegador do computador (npm run serve).
// No navegador comum os recursos nativos ficam desligados (notificações, voltar do Android etc.).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const www = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const port = Number(process.env.PORT || 8100);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(www, path || 'index.html');
  if (!file.startsWith(www)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('não encontrado'); }
}).listen(port, () => console.log(`Pré-visualização em http://localhost:${port} (inclua http://localhost:${port} em CORS_ORIGINS da API para testar com dados)`));
