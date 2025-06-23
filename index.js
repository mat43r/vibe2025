const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const TelegramBot = require('node-telegram-bot-api');

const PORT = 3000;
const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const CHAT_ID = 'YOUR_CHAT_ID';

// Инициализация Telegram бота
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'todolist'
};

// Отправка уведомления в Telegram
async function sendTelegramNotification(message) {
    try {
        await bot.sendMessage(CHAT_ID, `📝 To-Do List Update:\n${message}`);
    } catch (err) {
        console.error('Telegram notification error:', err);
    }
}

async function retrieveListItems() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id, text FROM items');
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

// Новая функция для добавления задачи
async function addTodoItem(text) {
    const connection = await mysql.createConnection(dbConfig);
    try {
        const [result] = await connection.execute(
            'INSERT INTO items (text) VALUES (?)',
            [text]
        );
        await sendTelegramNotification(`✅ Добавлена новая задача: "${text}"`);
        return result.insertId;
    } finally {
        await connection.end();
    }
}

// Новая функция для удаления задачи
async function deleteTodoItem(id) {
    const connection = await mysql.createConnection(dbConfig);
    try {
        // Получаем текст задачи перед удалением для уведомления
        const [tasks] = await connection.execute(
            'SELECT text FROM items WHERE id = ?',
            [id]
        );
        
        if (tasks.length > 0) {
            await sendTelegramNotification(`❌ Удалена задача: "${tasks[0].text}"`);
        }

        await connection.execute(
            'DELETE FROM items WHERE id = ?',
            [id]
        );
    } finally {
        await connection.end();
    }
}

async function getHtmlRows() {
    const todoItems = await retrieveListItems();
    return todoItems.map(item => `
        <tr data-id="${item.id}">
            <td>${item.id}</td>
            <td>${item.text}</td>
            <td><button onclick="deleteItem(${item.id})">×</button></td>
        </tr>
    `).join('');
}

async function handleRequest(req, res) {
    const url = req.url;
    const method = req.method;

    // Обработка добавления новой задачи
    if (url === '/add' && method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await addTodoItem(text);
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({success: true}));
            } catch (err) {
                res.writeHead(500).end('Error adding item');
            }
        });
        return;
    }

    // Обработка удаления задачи
    if (url.startsWith('/delete/') && method === 'POST') {
        const id = url.split('/')[2];
        try {
            await deleteTodoItem(id);
            res.writeHead(200).end();
        } catch (err) {
            res.writeHead(500).end('Error deleting item');
        }
        return;
    }

    // Главная страница
    if (url === '/') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'), 
                'utf8'
            );
            const processedHtml = html.replace('{{rows}}', await getHtmlRows());
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Route not found');
}

// Команды для Telegram бота
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Привет! Я буду уведомлять тебя об изменениях в To-Do List.');
});

bot.onText(/\/list/, async (msg) => {
    try {
        const items = await retrieveListItems();
        if (items.length === 0) {
            bot.sendMessage(msg.chat.id, 'Список задач пуст.');
        } else {
            const taskList = items.map(item => `• ${item.text}`).join('\n');
            bot.sendMessage(msg.chat.id, `Текущие задачи:\n${taskList}`);
        }
    } catch (err) {
        bot.sendMessage(msg.chat.id, 'Не удалось получить список задач.');
    }
});

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Telegram bot @${bot.options.username} started`);
    console.log('Available Telegram commands:');
    console.log('/start - Начать работу с ботом');
    console.log('/list - Показать текущие задачи');
});