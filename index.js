const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { Telegraf } = require('telegraf');

const PORT = 3000;
const TELEGRAM_TOKEN = 'YOUR_BOT_TOKEN';
const CHAT_ID = 'YOUR_CHAT_ID';

// Инициализация бота
const bot = new Telegraf(TELEGRAM_TOKEN);

// Конфигурация БД
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'todolist'
};

// Функция для работы с БД
async function query(sql, params) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [results] = await conn.execute(sql, params);
        return results;
    } finally {
        await conn.end();
    }
}

// Отправка уведомлений в Telegram
async function notifyTelegram(message) {
    try {
        await bot.telegram.sendMessage(CHAT_ID, `📝 To-Do: ${message}`);
    } catch (err) {
        console.error('Ошибка Telegram:', err);
    }
}

// Получение списка задач
async function getTodos() {
    return await query('SELECT id, text FROM items ORDER BY id DESC');
}

// Добавление задачи
async function addTodo(text) {
    await query('INSERT INTO items (text) VALUES (?)', [text]);
    await notifyTelegram(`Добавлена: "${text}"`);
}

// Удаление задачи
async function deleteTodo(id) {
    const [task] = await query('SELECT text FROM items WHERE id = ?', [id]);
    await query('DELETE FROM items WHERE id = ?', [id]);
    if (task.length > 0) {
        await notifyTelegram(`Удалена: "${task[0].text}"`);
    }
}

// Обработчик HTTP запросов
async function handleRequest(req, res) {
    const url = req.url;
    
    // Главная страница
    if (url === '/') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'), 
                'utf8'
            );
            const todos = await getTodos();
            const rows = todos.map(todo => `
                <tr>
                    <td>${todo.id}</td>
                    <td>${todo.text}</td>
                    <td><button onclick="deleteItem(${todo.id})">×</button></td>
                </tr>
            `).join('');
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html.replace('{{rows}}', rows));
        } catch (err) {
            res.writeHead(500).end('Ошибка сервера');
        }
        return;
    }

    // API для добавления
    if (url === '/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await addTodo(text);
                res.writeHead(200).end();
            } catch (err) {
                res.writeHead(500).end('Ошибка добавления');
            }
        });
        return;
    }

    // API для удаления
    if (url.startsWith('/delete/') && req.method === 'POST') {
        const id = url.split('/')[2];
        try {
            await deleteTodo(id);
            res.writeHead(200).end();
        } catch (err) {
            res.writeHead(500).end('Ошибка удаления');
        }
        return;
    }

    res.writeHead(404).end('Not Found');
}

// Команды бота
bot.command('start', (ctx) => {
    ctx.reply('Привет! Я бот для управления To-Do List. Используй /list для просмотра задач');
});

bot.command('list', async (ctx) => {
    try {
        const todos = await getTodos();
        if (todos.length === 0) {
            return ctx.reply('Список задач пуст');
        }
        const list = todos.map(t => `• ${t.id}: ${t.text}`).join('\n');
        ctx.reply(`Текущие задачи:\n${list}`);
    } catch (err) {
        ctx.reply('Ошибка получения списка');
    }
});

// Инициализация и запуск
(async () => {
    // Создаем таблицу если не существует
    await query(`
        CREATE TABLE IF NOT EXISTS items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            text VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Запуск сервера
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
        console.log(`Сервер запущен на порту ${PORT}`);
    });

    // Запуск бота
    bot.launch();
    console.log('Telegram бот запущен');

    // Уведомление о запуске
    await notifyTelegram('Сервер To-Do List запущен!');
})();