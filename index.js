const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const https = require('https');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist'
};

// Fixed credentials
const AUTH_CREDENTIALS = {
    username: 'Zorin3337',
    password: '12345'
};

// Active sessions (in-memory storage)
const activeSessions = {};

// --- Telegram bot settings ---
const TELEGRAM_BOT_TOKEN = '7568574046:AAFLeKxWSG4KDWsDsO9FOEgLtoMPhOEmec4';  // вставь сюда токен бота
let telegramOffset = 0;

// Helper function to execute queries
async function query(sql, params) {
    const connection = await mysql.createConnection(dbConfig);
    try {
        const [results] = await connection.execute(sql, params);
        return results;
    } finally {
        await connection.end();
    }
}

// Authentication middleware
function authenticate(req) {
    const cookies = req.headers.cookie?.split(';').find(c => c.trim().startsWith('session='));
    const sessionId = cookies?.split('=')[1];
    return activeSessions[sessionId];
}

// Telegram API: получить обновления
function getTelegramUpdates() {
    return new Promise((resolve, reject) => {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=10&offset=${telegramOffset + 1}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Telegram API: отправить сообщение
function sendTelegramMessage(chat_id, text) {
    const data = JSON.stringify({
        chat_id,
        text
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {}); // consume response data to free memory
    });

    req.on('error', (e) => {
        console.error(`Telegram sendMessage error: ${e.message}`);
    });

    req.write(data);
    req.end();
}

// Функция опроса Telegram обновлений
async function pollTelegram() {
    try {
        const updates = await getTelegramUpdates();
        if (updates.ok && updates.result.length > 0) {
            for (const update of updates.result) {
                telegramOffset = update.update_id;
                if (update.message && update.message.text) {
                    const chat_id = update.message.chat.id;
                    const text = update.message.text.trim();

                    if (text === '/start') {
                        sendTelegramMessage(chat_id, 'Привет! Ты вошёл в Telegram-бот без дополнительных библиотек.');
                    } else if (text === '/list') {
                        // Пример получения задач из БД и отправки списка
                        const todos = await query('SELECT text FROM items');
                        if (todos.length === 0) {
                            sendTelegramMessage(chat_id, 'Список задач пуст.');
                        } else {
                            const listText = todos.map((item, i) => `${i+1}. ${item.text}`).join('\n');
                            sendTelegramMessage(chat_id, `Твои задачи:\n${listText}`);
                        }
                    } else {
                        sendTelegramMessage(chat_id, `Неизвестная команда: ${text}`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Telegram polling error:', err);
    }
    setTimeout(pollTelegram, 1000);
}

// Request handler
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Serve login page
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            res.writeHead(500).end('Error loading page');
        }
        return;
    }

    // Handle login
    if (req.method === 'POST' && parsedUrl.pathname === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);

                if (username === AUTH_CREDENTIALS.username && password === AUTH_CREDENTIALS.password) {
                    const sessionId = Date.now().toString();
                    activeSessions[sessionId] = username;
                    res.setHeader('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly`);
                    res.writeHead(200).end();
                } else {
                    res.writeHead(401).end('Invalid credentials');
                }
            } catch {
                res.writeHead(400).end('Bad request');
            }
        });
        return;
    }

    // Check authentication for API endpoints
    const user = authenticate(req);
    if (!user) {
        res.writeHead(401).end('Unauthorized');
        return;
    }

    // Get all todos
    if (req.method === 'GET' && parsedUrl.pathname === '/todos') {
        try {
            const todos = await query('SELECT id, text FROM items');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(todos));
        } catch (err) {
            res.writeHead(500).end('Database error');
        }
        return;
    }

    // Add new todo
    if (req.method === 'POST' && parsedUrl.pathname === '/todos') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await query('INSERT INTO items (text) VALUES (?)', [text]);
                res.writeHead(201).end();
            } catch {
                res.writeHead(400).end('Bad request');
            }
        });
        return;
    }

    // Update todo
    if (req.method === 'PUT' && parsedUrl.pathname.startsWith('/todos/')) {
        const id = parsedUrl.pathname.split('/')[2];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await query('UPDATE items SET text = ? WHERE id = ?', [text, id]);
                res.writeHead(200).end();
            } catch {
                res.writeHead(400).end('Bad request');
            }
        });
        return;
    }

    // Delete todo
    if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/todos/')) {
        const id = parsedUrl.pathname.split('/')[2];
        try {
            await query('DELETE FROM items WHERE id = ?', [id]);
            res.writeHead(200).end();
        } catch {
            res.writeHead(500).end('Database error');
        }
        return;
    }

    // Logout
    if (req.method === 'POST' && parsedUrl.pathname === '/logout') {
        const cookies = req.headers.cookie?.split(';').find(c => c.trim().startsWith('session='));
        const sessionId = cookies?.split('=')[1];
        delete activeSessions[sessionId];
        res.writeHead(200).end();
        return;
    }

    res.writeHead(404).end('Not found');
}

// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Login credentials:');
    console.log(`Username: ${AUTH_CREDENTIALS.username}`);
    console.log(`Password: ${AUTH_CREDENTIALS.password}`);

    // Запускаем опрос Telegram после старта сервера
    pollTelegram();
});