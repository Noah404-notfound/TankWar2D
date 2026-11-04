'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const port = Number(process.env.PORT || process.argv[2] || 5173);
const wsPort = Number(process.env.WS_PORT || 8081);
const host = process.env.HOST || process.argv[3] || '0.0.0.0';
const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, filePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404).end('Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

// Proxy WebSocket requests (e.g. /ws from Cloudflare tunnel or reverse proxy) to Haskell server
server.on('upgrade', (req, socket, head) => {
  const proxySocket = net.connect(wsPort, '127.0.0.1', () => {
    proxySocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      proxySocket.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    proxySocket.write('\r\n');
    if (head && head.length > 0) proxySocket.write(head);
    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
  });
  proxySocket.on('error', () => {
    socket.destroy();
  });
  socket.on('error', () => {
    proxySocket.destroy();
  });
});

server.listen(port, host, () => {
  const localUrl = `http://127.0.0.1:${port}/`;
  console.log(`TankWar web server running at: ${localUrl}`);
  console.log(`WebSocket /ws proxied to 127.0.0.1:${wsPort}`);
});
