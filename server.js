const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'notes.json');
let notes = [];
try {
  notes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (err) {
  notes = [];
}
function saveNotes() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(notes));
}
function serveStatic(req, res) {
  const filePath = path.join(
    __dirname,
    req.url === '/' ? 'index.html' : req.url
  );
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  };
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(content);
  });
}
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/notes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(notes));
  } else if (req.method === 'POST' && req.url === '/notes') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { cipher, iv } = JSON.parse(body);
        if (!cipher || !iv) {
          res.writeHead(400);
          res.end('Invalid');
          return;
        }
        notes.push({ cipher, iv });
        saveNotes();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
  } else if (req.method === 'DELETE' && req.url.startsWith('/notes/')) {
    const index = parseInt(req.url.split('/')[2], 10);
    if (Number.isNaN(index) || index < 0 || index >= notes.length) {
      res.writeHead(400);
      res.end('Invalid index');
      return;
    }
    notes.splice(index, 1);
    saveNotes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  } else {
    serveStatic(req, res);
  }
});
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));
