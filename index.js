const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const TelegramBot = require('node-telegram-bot-api');

const PORT = 3000;

// Настройки базы данных — подставьте свои
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist'
};

// Фиксированные учётные данные для веба
const AUTH_CREDENTIALS = {
    username: 'Zorin3337',
    password: '12345'
};

// Активные сессии в памяти
const activeSessions = {};

// Токен Telegram бота — замените на свой!
const TELEGRAM_BOT_TOKEN = '7568574046:AAFLeKxWSG4KDWsDsO9FOEgLtoMPhOEmec4';

if (!TELEGRAM_BOT_TOKEN) {
    console.error('Ошибка: не задан TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

// Создаём Telegram бота с опросом (polling)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Выводим имя бота при запуске
bot.getMe().then(botInfo => {
    console.log(`Telegram bot @${botInfo.username} started`);
}).catch(err => {
    console.error('Ошибка при получении данных бота:', err);
    process.exit(1);
});

// Пример обработки команды /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `Привет, ${msg.from.first_name}! Я бот для управления списком задач.`);
});

// Пример обработки команды /list — отправляет список дел из базы
bot.onText(/\/list/, async (msg) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id, text FROM items');
        await connection.end();

        if (rows.length === 0) {
            bot.sendMessage(msg.chat.id, 'Список задач пуст.');
        } else {
            const listText = rows.map(r => `${r.id}. ${r.text}`).join('\n');
            bot.sendMessage(msg.chat.id, `Текущие задачи:\n${listText}`);
        }
    } catch (e) {
        bot.sendMessage(msg.chat.id, 'Ошибка при получении списка задач.');
    }
});

// Вспомогательная функция запроса к базе
async function query(sql, params) {
    const connection = await mysql.createConnection(dbConfig);
    try {
        const [results] = await connection.execute(sql, params);
        return results;
    } finally {
        await connection.end();
    }
}

// Аутентификация по сессии
function authenticate(req) {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('session='));
    if (!sessionCookie) return null;
    const sessionId = sessionCookie.split('=')[1];
    return activeSessions[sessionId];
}

// Обработчик HTTP-запросов
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Страница входа
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch {
            res.writeHead(500);
            res.end('Ошибка загрузки страницы');
        }
        return;
    }

    // Логин
    if (req.method === 'POST' && parsedUrl.pathname === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                if (username === AUTH_CREDENTIALS.username && password === AUTH_CREDENTIALS.password) {
                    const sessionId = Date.now().toString();
                    activeSessions[sessionId] = username;
                    res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
                    res.writeHead(200);
                    res.end();
                } else {
                    res.writeHead(401);
                    res.end('Неверные учетные данные');
                }
            } catch {
                res.writeHead(400);
                res.end('Некорректный запрос');
            }
        });
        return;
    }

    // Проверяем аутентификацию для API
    const user = authenticate(req);
    if (!user) {
        res.writeHead(401);
        res.end('Требуется авторизация');
        return;
    }

    // Получить все задачи
    if (req.method === 'GET' && parsedUrl.pathname === '/todos') {
        try {
            const todos = await query('SELECT id, text FROM items');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(todos));
        } catch {
            res.writeHead(500);
            res.end('Ошибка базы данных');
        }
        return;
    }

    // Добавить задачу
    if (req.method === 'POST' && parsedUrl.pathname === '/todos') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await query('INSERT INTO items (text) VALUES (?)', [text]);
                res.writeHead(201);
                res.end();
            } catch {
                res.writeHead(400);
                res.end('Некорректный запрос');
            }
        });
        return;
    }

    // Обновить задачу
    if (req.method === 'PUT' && parsedUrl.pathname.startsWith('/todos/')) {
        const id = parsedUrl.pathname.split('/')[2];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await query('UPDATE items SET text = ? WHERE id = ?', [text, id]);
                res.writeHead(200);
                res.end();
            } catch {
                res.writeHead(400);
                res.end('Некорректный запрос');
            }
        });
        return;
    }

    // Удалить задачу
    if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/todos/')) {
        const id = parsedUrl.pathname.split('/')[2];
        try {
            await query('DELETE FROM items WHERE id = ?', [id]);
            res.writeHead(200);
            res.end();
        } catch {
            res.writeHead(500);
            res.end('Ошибка базы данных');
        }
        return;
    }

    // Выход (логаут)
    if (req.method === 'POST' && parsedUrl.pathname === '/logout') {
        const cookieHeader = req.headers.cookie || '';
        const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('session='));
        if (sessionCookie) {
            const sessionId = sessionCookie.split('=')[1];
            delete activeSessions[sessionId];
        }
        res.writeHead(200);
        res.end();
        return;
    }

    res.writeHead(404);
    res.end('Не найдено');
}

// Создаем HTTP сервер
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`HTTP сервер запущен на порту ${PORT}`);
    console.log('Учётные данные для входа:');
    console.log(`Логин: ${AUTH_CREDENTIALS.username}`);
    console.log(`Пароль: ${AUTH_CREDENTIALS.password}`);
});