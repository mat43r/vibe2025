const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // Встроенный модуль для хеширования

const PORT = 3000;

// Хранилище данных в памяти (вместо БД)
const db = {
  users: [
    // Пример пользователя (логин: admin, пароль: 123456)
    { 
      id: 1, 
      username: 'admin', 
      password: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92' // sha256('123456')
    }
  ],
  todos: []
};

// Простая аутентификация через сессии
const sessions = {};

// Хеширование пароля (используем встроенный crypto)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Проверка авторизации
function checkAuth(req) {
  const cookies = req.headers.cookie?.split(';').find(c => c.trim().startsWith('session='));
  const sessionId = cookies?.split('=')[1];
  return sessions[sessionId];
}

// Сервер
const server = http.createServer(async (req, res) => {
  // Отдача статики
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const html = await fs.promises.readFile('./index.html', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    } catch {
      res.writeHead(500).end('Server error');
    }
    return;
  }

  // API endpoints
  if (req.method === 'POST' && req.url === '/auth/login') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const user = db.users.find(u => u.username === username);
        
        if (!user || user.password !== hashPassword(password)) {
          return res.writeHead(401).end('Invalid credentials');
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        sessions[sessionId] = username;
        res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
        res.writeHead(200).end();
      } catch {
        res.writeHead(400).end('Bad request');
      }
    });
    return;
  }

  // Проверка авторизации для защищённых роутов
  const username = checkAuth(req);
  if (!username) return res.writeHead(401).end('Unauthorized');

  // Работа с задачами
  if (req.url === '/todos' && req.method === 'GET') {
    const userTodos = db.todos.filter(t => t.user === username);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(userTodos));
  }

  if (req.url === '/todos' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        const newTodo = {
          id: Date.now(),
          user: username,
          text,
          completed: false
        };
        db.todos.push(newTodo);
        res.writeHead(201).end();
      } catch {
        res.writeHead(400).end('Bad request');
      }
    });
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));