const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
const https = require('https');

const PORT = 3000;

// Конфигурация (ОБЯЗАТЕЛЬНО ПРОВЕРЬТЕ ЗНАЧЕНИЯ!)
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
    chatId: '166026743' // Должен быть ID чата, а не бота!
  }
};

const activeSessions = {};
let telegramOffset = 0;

// --- Исправленные функции для работы с Telegram ---

async function sendTelegramMessage(text) {
  // Проверка на пустое сообщение
  if (!text || typeof text !== 'string' || text.trim() === '') {
    console.error('Попытка отправить пустое сообщение в Telegram');
    return false;
  }

  return new Promise((resolve) => {
    const data = JSON.stringify({
      chat_id: CONFIG.telegram.chatId,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegram.token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (!json.ok) {
            console.error('Ошибка Telegram API:', json.description);
          }
          resolve(json.ok);
        } catch (e) {
          console.error('Ошибка парсинга ответа Telegram:', e);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Ошибка запроса к Telegram:', e.message);
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

// --- Остальные функции остаются без изменений ---

async function initialize() {
  try {
    // Проверка подключения к БД
    await query('SELECT 1');
    console.log('Успешное подключение к базе данных');

    // Проверка токена бота
    const botCheck = await new Promise((resolve) => {
      https.get(`https://api.telegram.org/bot${CONFIG.telegram.token}/getMe`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ ok: false, description: 'Parse error' });
          }
        });
      }).on('error', () => resolve({ ok: false, description: 'Request error' }));
    });

    if (!botCheck.ok) {
      throw new Error(`Неверный токен Telegram бота: ${botCheck.description || 'Unknown error'}`);
    }

    console.log(`Бот @${botCheck.result.username} успешно подключен`);

    // Создаем таблицу если её нет
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
      
      // Отправляем тестовое сообщение
      sendTelegramMessage('🔔 Сервер To-Do List успешно запущен!')
        .then(success => {
          if (success) {
            console.log('Тестовое сообщение в Telegram отправлено успешно');
          } else {
            console.log('Не удалось отправить тестовое сообщение в Telegram');
          }
        });
      
      pollTelegram();
    });
  } catch (err) {
    console.error('Фатальная ошибка инициализации:', err.message);
    process.exit(1);
  }
}

initialize();