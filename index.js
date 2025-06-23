const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const PORT = 3000;

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist'
};

// Create database connection pool
const pool = mysql.createPool(dbConfig);

// Helper function to execute SQL queries
async function query(sql, params) {
    const connection = await pool.getConnection();
    try {
        const [results] = await connection.execute(sql, params);
        return results;
    } finally {
        connection.release();
    }
}

// Create todos table if not exists
async function initializeDatabase() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS todos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                text VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Database initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Get all todos
async function getTodos() {
    return await query('SELECT * FROM todos ORDER BY created_at DESC');
}

// Add new todo
async function addTodo(text) {
    const result = await query(
        'INSERT INTO todos (text) VALUES (?)',
        [text]
    );
    return result.insertId;
}

// Delete todo
async function deleteTodo(id) {
    await query(
        'DELETE FROM todos WHERE id = ?',
        [id]
    );
}

// Handle HTTP requests
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // API endpoints
    if (req.method === 'GET' && parsedUrl.pathname === '/todos') {
        try {
            const todos = await getTodos();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(todos));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to get todos' }));
        }
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/todos') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await addTodo(text);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to add todo' }));
            }
        });
        return;
    }

    if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/todos/')) {
        const id = parsedUrl.pathname.split('/')[2];
        try {
            await deleteTodo(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to delete todo' }));
        }
        return;
    }

    // Serve HTML file
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'),
                'utf8'
            );
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading index.html');
        }
        return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
}

// Initialize database and start server
initializeDatabase().then(() => {
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});