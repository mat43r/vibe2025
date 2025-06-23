const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const PORT = 3000;

// Храним активные сессии в памяти
const sessions = {};

// Конфиг БД
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist_auth'
};

// Пул соединений MySQL
const pool = mysql.createPool(dbConfig);

// Проверка авторизации
function checkAuth(req) {
    const cookies = req.headers.cookie || '';
    const sessionId = cookies.split('=')[1];
    return sessions[sessionId];
}

// Инициализация БД
async function initDB() {
    const conn = await pool.getConnection();
    await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) UNIQUE,
            password VARCHAR(255)
        )
    `);
    await conn.query(`
        CREATE TABLE IF NOT EXISTS todos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            text TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    conn.release();
}

// Обработчик запросов
const server = http.createServer(async (req, res) => {
    // Статика
    if (req.url === '/' || req.url === '/index.html') {
        const html = await fs.promises.readFile('./index.html', 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
    }

    // Регистрация
    if (req.url === '/auth/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            const hashedPass = await bcrypt.hash(password, 10);
            const conn = await pool.getConnection();
            await conn.query(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                [username, hashedPass]
            );
            conn.release();
            res.writeHead(201).end();
        });
        return;
    }

    // Логин
    if (req.url === '/auth/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            const conn = await pool.getConnection();
            const [users] = await conn.query(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );
            conn.release();

            if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
                return res.writeHead(401).end();
            }

            const sessionId = Date.now().toString();
            sessions[sessionId] = username;
            res.setHeader('Set-Cookie', `session=${sessionId}; Path=/`);
            res.writeHead(200).end();
        });
        return;
    }

    // Работа с задачами (только для авторизованных)
    const user = checkAuth(req);
    if (!user) return res.writeHead(401).end();

    // GET /todos - получить список
    if (req.url === '/todos' && req.method === 'GET') {
        const conn = await pool.getConnection();
        const [todos] = await conn.query(
            'SELECT * FROM todos WHERE user_id = (SELECT id FROM users WHERE username = ?)',
            [user]
        );
        conn.release();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(todos));
    }

    // POST /todos - добавить задачу
    if (req.url === '/todos' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const { text } = JSON.parse(body);
            const conn = await pool.getConnection();
            await conn.query(
                'INSERT INTO todos (user_id, text) VALUES ((SELECT id FROM users WHERE username = ?), ?)',
                [user, text]
            );
            conn.release();
            res.writeHead(201).end();
        });
        return;
    }

    res.writeHead(404).end();
});

// Запуск
initDB().then(() => {
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});