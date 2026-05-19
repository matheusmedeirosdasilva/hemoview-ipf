const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const port = Number(process.argv[2] || 4173);
const root = process.cwd();
const rendererRoot = path.join(root, 'src', 'renderer');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8']
]);

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const cleanPath = decoded.replace(/^\/+/, '');
  const basePath = decoded === '/'
    ? path.join(rendererRoot, 'index.html')
    : path.resolve(rendererRoot, cleanPath);
  const absolutePath = cleanPath.startsWith('node_modules/')
    ? path.resolve(root, cleanPath)
    : basePath;

  if (!absolutePath.startsWith(root)) {
    return null;
  }

  return absolutePath;
}

const server = http.createServer(async (request, response) => {
  const filePath = resolvePath(request.url || '/');
  if (!filePath) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream'
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Renderer preview: http://127.0.0.1:${port}`);
});
