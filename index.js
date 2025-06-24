const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
const https = require('https');

// Конфигурация (лучше использовать переменные окружения)
const PORT = process.env.PORT || 3000;
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '43Qwerty',
  database: process.env.DB_NAME || 'todolist'
};

// Telegram настройки
const TELEGRAM = {
  token: process.env.TELEGRAM_TOKEN || '7568574046:AAFLeKxWSG4KDWsDsO9FOEgLtoMPhOEmec4',
  chatId: process.env.TELEGRAM_CHAT_ID || '820702293D'
};

// Проверка обязательных параметров
if (!TELEGRAM.token || !TELEGRAM.chatId) {
  console.error('Требуются TELEGRAM_TOKEN и TELEGRAM_CHAT_ID');
  process.exit(1);
}

// --- Вспомогательные функции ---

async function sendTelegramMessage(text) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: TELEGRAM.chatId,
      text: text,
      disable_notification: false
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM.token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      res.on('end', resolve);
    });

    req.on('error', (e) => {
      console.error('Ошибка Telegram API:', e.message);
    });

    req.write(data);
    req.end();
  });
}

async function dbQuery(sql, params = []) {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    const [results] = await conn.execute(sql, params);
    return results;
  } finally {
    if (conn) await conn.end();
  }
}

// --- Основные обработчики ---

async function handleTodoRequest(req, res) {
  try {
    const todos = await dbQuery('SELECT * FROM items ORDER BY created_at DESC');
    const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
    
    const rowsHtml = todos.map(todo => `
      <tr>
        <td>${todo.id}</td>
        <td>${todo.text}</td>
        <td>
          <button onclick="deleteItem(${todo.id})" class="delete-btn">×</button>
        </td>
      </tr>
    `).join('');

    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html.replace('{{rows}}', rowsHtml));
    
  } catch (err) {
    console.error('Ошибка:', err);
    res.writeHead(500).end('Internal Server Error');
  }
}

async function handleAddTodo(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { text } = JSON.parse(body);
      if (!text || text.length > 255) {
        return res.writeHead(400).end('Invalid text');
      }

      await dbQuery('INSERT INTO items (text) VALUES (?)', [text]);
      await sendTelegramMessage(`➕ Добавлена: "${text}"`);
      res.writeHead(200).end();
      
    } catch (err) {
      res.writeHead(500).end('Add error');
    }
  });
}

async function handleDeleteTodo(req, res) {
  const id = req.url.split('/')[2];
  if (!id || isNaN(id)) {
    return res.writeHead(400).end('Invalid ID');
  }

  try {
    const [task] = await dbQuery('SELECT text FROM items WHERE id = ?', [id]);
    if (!task.length) {
      return res.writeHead(404).end('Task not found');
    }

    await dbQuery('DELETE FROM items WHERE id = ?', [id]);
    await sendTelegramMessage(`❌ Удалена: "${task[0].text}"`);
    res.writeHead(200).end();
    
  } catch (err) {
    res.writeHead(500).end('Delete error');
  }
}

// --- Инициализация ---

async function initialize() {
  try {
    // Создаем таблицу если не существует
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Запускаем сервер
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/' && req.method === 'GET') {
          return await handleTodoRequest(req, res);
        }
        if (req.url === '/add' && req.method === 'POST') {
          return await handleAddTodo(req, res);
        }
        if (req.url.startsWith('/delete/') && req.method === 'POST') {
          return await handleDeleteTodo(req, res);
        }
        res.writeHead(404).end('Not Found');
      } catch (err) {
        console.error('Ошибка обработки запроса:', err);
        res.writeHead(500).end('Server Error');
      }
    });

    server.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
      sendTelegramMessage('🚀 To-Do List сервер запущен');
    });

  } catch (err) {
    console.error('Ошибка инициализации:', err);
    process.exit(1);
  }
}

initialize();