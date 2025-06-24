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
    token: '7993580399:AAEQdT2wv1ZaAf-6_5cDi7pW7cOz6gI5WUE',
    chatId: '820702293' // Замените на реальный chat_id
  }
};

const activeSessions = {};
let telegramOffset = 0;

// 1. Сначала определяем все вспомогательные функции
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
  if (!text || text.trim() === '') {
    console.error('Попытка отправить пустое сообщение');
    return false;
  }

  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: CONFIG.telegram.chatId,
      text: text
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegram.token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (!json.ok) {
            console.error('Telegram API error:', json.description);
          }
          resolve(json.ok);
        } catch (e) {
          console.error('Failed to parse Telegram response:', e);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Telegram request failed:', e.message);
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

async function getTelegramUpdates() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/getUpdates?offset=${telegramOffset + 1}`);
    return await response.json();
  } catch (err) {
    console.error('Ошибка при получении обновлений:', err);
    return { ok: false };
  }
}

async function pollTelegram() {
  try {
    const updates = await getTelegramUpdates();
    
    if (!updates.ok) return;
    
    if (updates.result?.length > 0) {
      for (const update of updates.result) {
        telegramOffset = update.update_id;
        
        if (update.message?.text) {
          const text = update.message.text.trim();
          const chatId = update.message.chat.id;

          if (text === '/start') {
            await sendTelegramMessage('🚀 Бот активен! Команды: /list');
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
    console.error('Polling error:', err);
  } finally {
    setTimeout(pollTelegram, 2000);
  }
}

// 2. Затем основную функцию обработки запросов
async function handleRequest(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    
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

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = body ? JSON.parse(body) : {};
          
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
            if (!data.text) return res.writeHead(400).end();
            await query('INSERT INTO items (text) VALUES (?)', [data.text]);
            await sendTelegramMessage(`➕ Добавлена: "${data.text}"`);
            return res.end();
          }

          if (parsedUrl.pathname.startsWith('/delete/')) {
            const id = parsedUrl.pathname.split('/')[2];
            const [task] = await query('SELECT text FROM items WHERE id = ?', [id]);
            await query('DELETE FROM items WHERE id = ?', [id]);
            if (task?.text) await sendTelegramMessage(`❌ Удалена: "${task.text}"`);
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
    console.error('Request error:', err);
    res.writeHead(500).end();
  }
}

// 3. В самом конце - инициализация
async function initialize() {
  try {
    // Проверка подключения к БД
    await query('SELECT 1');
    console.log('База данных подключена');

    // Создаем таблицу если нужно
    await query(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Проверка бота
    const botInfo = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/getMe`);
    const botData = await botInfo.json();
    
    if (!botData.ok) {
      throw new Error('Неверный токен бота: ' + (botData.description || 'Unknown error'));
    }

    console.log(`Бот @${botData.result.username} готов к работе`);

    // Запуск сервера
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
      console.log(`Логин: ${CONFIG.auth.username}, Пароль: ${CONFIG.auth.password}`);
      
      // Тестовая отправка сообщения
      sendTelegramMessage('🔔 Сервер запущен!')
        .then(success => console.log(success ? 'Тест сообщения успешен' : 'Ошибка теста сообщения'));
      
      pollTelegram();
    });
  } catch (err) {
    console.error('Фатальная ошибка инициализации:', err.message);
    process.exit(1);
  }
}

// Запускаем приложение
initialize();