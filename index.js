const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
const https = require('https');

const PORT = 3000;

// Конфигурация
const CONFIG = {
  db: {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist'
  },
  auth: {
    username: 'Zorin3337',
    password: '12345'
  },
  telegram: {
    token: '7993580399:AAEQdT2wv1ZaAf-6_5cDi7pW7cOz6gI5WUE', // Замените на реальный токен
    chatId: '7993580399' // Замените на ваш chat_id
  }
};

// Глобальные переменные
const activeSessions = {};
let telegramOffset = 0;

// --- Основные функции ---

async function query(sql, params = []) {
  const connection = await mysql.createConnection(CONFIG.db);
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    await connection.end();
  }
}

async function sendTelegramMessage(text) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: CONFIG.telegram.chatId,
      text: text
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegram.token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      res.on('data', () => {}); // Поглощаем ответ
      res.on('end', resolve);
    });

    req.on('error', (e) => {
      console.error('Ошибка Telegram:', e.message);
      resolve();
    });

    req.write(data);
    req.end();
  });
}

async function getTelegramUpdates() {
  return new Promise((resolve) => {
    const url = `https://api.telegram.org/bot${CONFIG.telegram.token}/getUpdates?offset=${telegramOffset + 1}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          console.error('Ошибка парсинга Telegram ответа:', e);
          resolve({ ok: false });
        }
      });
    }).on('error', (e) => {
      console.error('Ошибка запроса к Telegram:', e.message);
      resolve({ ok: false });
    });
  });
}

async function pollTelegram() {
  try {
    const updates = await getTelegramUpdates();
    
    if (updates.ok && updates.result.length > 0) {
      for (const update of updates.result) {
        telegramOffset = update.update_id;
        
        if (update.message && update.message.text) {
          const text = update.message.text.trim();
          
          if (text === '/start') {
            await sendTelegramMessage('🚀 Бот To-Do List активен!\nКоманды:\n/list - показать задачи');
          } else if (text === '/list') {
            const todos = await query('SELECT text FROM items');
            const message = todos.length 
              ? todos.map((t, i) => `${i+1}. ${t.text}`).join('\n')
              : 'Список задач пуст';
            await sendTelegramMessage(message);
          }
        }
      }
    }
  } catch (err) {
    console.error('Ошибка опроса Telegram:', err.message);
  }
  
  setTimeout(pollTelegram, 1000);
}

// --- HTTP сервер ---

async function handleRequest(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    
    // Статический файл
    if (parsedUrl.pathname === '/') {
      const todos = await query('SELECT id, text FROM items');
      const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
      const rows = todos.map(t => `
        <tr>
          <td>${t.id}</td>
          <td>${t.text}</td>
          <td><button onclick="deleteItem(${t.id})">×</button></td>
        </tr>
      `).join('');
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html.replace('{{rows}}', rows));
    }

    // API endpoints
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          
          if (parsedUrl.pathname === '/login') {
            if (data.username === CONFIG.auth.username && data.password === CONFIG.auth.password) {
              const sessionId = Date.now().toString();
              activeSessions[sessionId] = data.username;
              res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
              return res.end();
            }
            return res.writeHead(401).end();
          }

          const cookies = req.headers.cookie?.split(';').find(c => c.trim().startsWith('session='));
          const sessionId = cookies?.split('=')[1];
          if (!activeSessions[sessionId]) {
            return res.writeHead(401).end();
          }

          if (parsedUrl.pathname === '/add') {
            await query('INSERT INTO items (text) VALUES (?)', [data.text]);
            await sendTelegramMessage(`➕ Добавлена: "${data.text}"`);
            return res.end();
          }

          if (parsedUrl.pathname.startsWith('/delete/')) {
            const id = parsedUrl.pathname.split('/')[2];
            const [task] = await query('SELECT text FROM items WHERE id = ?', [id]);
            await query('DELETE FROM items WHERE id = ?', [id]);
            
            if (task.length) {
              await sendTelegramMessage(`❌ Удалена: "${task[0].text}"`);
            }
            return res.end();
          }
        } catch (err) {
          console.error('API error:', err);
          res.writeHead(400).end();
        }
      });
      return;
    }

    res.writeHead(404).end();
  } catch (err) {
    console.error('Ошибка обработки запроса:', err);
    res.writeHead(500).end();
  }
}

// --- Инициализация ---

async function initialize() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
      console.log(`Логин: ${CONFIG.auth.username}, Пароль: ${CONFIG.auth.password}`);
      
      // Проверка Telegram токена
      sendTelegramMessage('🔔 Сервер To-Do List запущен!')
        .then(() => pollTelegram())
        .catch(err => console.error('Ошибка Telegram:', err.message));
    });
  } catch (err) {
    console.error('Ошибка инициализации:', err);
    process.exit(1);
  }
}

initialize();