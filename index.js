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
    token: '8002484122:AAFDki6uH4kkABYgtGIXmKyGOVrowpi9VOQ',
    chatId: '820702293'
  }
};

const activeSessions = {};
let telegramOffset = 0;

// Функция для работы с базой данных
async function query(sql, params = []) {
  const connection = await mysql.createConnection(CONFIG.db);
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    await connection.end();
  }
}

// Улучшенная функция отправки сообщений в Telegram
async function sendTelegramMessage(text) {
  if (!text || text.trim() === '') {
    console.error('Ошибка: попытка отправить пустое сообщение');
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CONFIG.telegram.chatId,
        text: text,
        parse_mode: 'HTML'
      }),
    });

    const data = await response.json();
    
    if (!data.ok) {
      console.error('Ошибка Telegram API:', data.description);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    return false;
  }
}

// Функция для получения обновлений от Telegram
async function getTelegramUpdates() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/getUpdates?offset=${telegramOffset + 1}`);
    const data = await response.json();
    
    if (!data.ok) {
      console.error('Ошибка Telegram API:', data.description || 'Unknown error');
      return { ok: false };
    }
    
    return data;
  } catch (err) {
    console.error('Ошибка при получении обновлений:', err);
    return { ok: false };
  }
}

// Функция опроса Telegram
async function pollTelegram() {
  try {
    const updates = await getTelegramUpdates();
    
    if (!updates.ok || !updates.result) {
      setTimeout(pollTelegram, 5000);
      return;
    }

    if (updates.result.length > 0) {
      console.log('Получены обновления:', JSON.stringify(updates.result, null, 2));
      
      for (const update of updates.result) {
        telegramOffset = update.update_id + 1;
        
        if (update.message?.text) {
          const text = update.message.text.trim();
          const chatId = update.message.chat.id;

          console.log(`Новое сообщение от ${chatId}: "${text}"`);
          
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
    console.error('Ошибка в pollTelegram:', err);
  } finally {
    setTimeout(pollTelegram, 1000);
  }
}

// Основной обработчик HTTP-запросов
async function handleRequest(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    
    // Главная страница
    if (parsedUrl.pathname === '/') {
      const todos = await query('SELECT id, text FROM items');
      const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
      const rows = todos.map(t => `
        <tr>
          <td>${t.id}</td>
          <td>${t.text}</td>
          <td><button class="delete-btn" onclick="deleteItem(${t.id})">×</button></td>
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
          const data = body ? JSON.parse(body) : {};
          
          // Авторизация
          if (parsedUrl.pathname === '/login') {
            if (data.username === CONFIG.auth.username && data.password === CONFIG.auth.password) {
              const sessionId = Date.now().toString();
              activeSessions[sessionId] = data.username;
              res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
              return res.end();
            }
            return res.writeHead(401).end();
          }

          // Проверка сессии
          const cookies = req.headers.cookie?.split(';').find(c => c.trim().startsWith('session='));
          const sessionId = cookies?.split('=')[1];
          if (!activeSessions[sessionId]) {
            return res.writeHead(401).end();
          }

          // Добавление задачи
          if (parsedUrl.pathname === '/add') {
            if (!data.text || data.text.trim() === '') {
              return res.writeHead(400).end();
            }
            await query('INSERT INTO items (text) VALUES (?)', [data.text.trim()]);
            await sendTelegramMessage(`➕ Добавлена задача: "${data.text.trim()}"`);
            return res.end();
          }

          // Удаление задачи
          if (parsedUrl.pathname.startsWith('/delete/')) {
            const id = parsedUrl.pathname.split('/')[2];
            const [task] = await query('SELECT text FROM items WHERE id = ?', [id]);
            await query('DELETE FROM items WHERE id = ?', [id]);
            
            if (task?.text) {
              await sendTelegramMessage(`❌ Удалена задача: "${task.text}"`);
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
    console.error('Request error:', err);
    res.writeHead(500).end();
  }
}

// Инициализация приложения
async function initialize() {
  try {
    // Проверка подключения к БД
    await query('SELECT 1');
    console.log('✅ База данных подключена');

    // Создание таблицы если не существует
    await query(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Проверка Telegram бота
    const botCheck = await fetch(`https://api.telegram.org/bot${CONFIG.telegram.token}/getMe`);
    const botData = await botCheck.json();
    
    if (!botData.ok) {
      throw new Error(`Ошибка Telegram бота: ${botData.description || 'Unknown error'}`);
    }

    console.log(`🤖 Бот @${botData.result.username} готов к работе`);

    // Запуск HTTP сервера
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
      console.log(`🌐 Сервер запущен на http://localhost:${PORT}`);
      console.log(`🔑 Логин: ${CONFIG.auth.username}, Пароль: ${CONFIG.auth.password}`);
      
      // Отправка тестового сообщения
      sendTelegramMessage('🔔 Сервер To-Do List успешно запущен!')
        .then(success => {
          if (success) {
            console.log('📨 Тестовое сообщение отправлено в Telegram');
          } else {
            console.log('❌ Не удалось отправить тестовое сообщение');
          }
        });
      
      // Запуск опроса Telegram
      pollTelegram();
    });
  } catch (err) {
    console.error('⛔ Фатальная ошибка инициализации:', err.message);
    process.exit(1);
  }
}

// Запуск приложения
initialize();