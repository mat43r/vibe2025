const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const PORT = 3000;
const JWT_SECRET = 'your_jwt_secret_key'; // Change this in production!

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist_auth'
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

// Initialize database
async function initializeDatabase() {
    try {
        // Create users table
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create todos table with user relationship
        await query(`
            CREATE TABLE IF NOT EXISTS todos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                text VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        console.log('Database initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Auth middleware
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.writeHead(401).end('Unauthorized');

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.writeHead(403).end('Forbidden');
        req.user = user;
        next();
    });
}

// Handle HTTP requests
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Serve static files
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'),
                'utf8'
            );
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (error) {
            res.writeHead(500).end('Error loading index.html');
        }
        return;
    }

    // Auth endpoints
    if (req.method === 'POST' && parsedUrl.pathname === '/auth/register') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                
                // Check if user exists
                const [users] = await query(
                    'SELECT * FROM users WHERE username = ?',
                    [username]
                );
                
                if (users.length > 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'Username already exists' }));
                    return;
                }
                
                // Hash password
                const hashedPassword = await bcrypt.hash(password, 10);
                
                // Create user
                await query(
                    'INSERT INTO users (username, password) VALUES (?, ?)',
                    [username, hashedPassword]
                );
                
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'User registered successfully' }));
            } catch (error) {
                console.error('Registration error:', error);
                res.writeHead(500).end('Registration failed');
            }
        });
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/auth/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                
                // Find user
                const [users] = await query(
                    'SELECT * FROM users WHERE username = ?',
                    [username]
                );
                
                if (users.length === 0) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'Invalid credentials' }));
                    return;
                }
                
                const user = users[0];
                
                // Check password
                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'Invalid credentials' }));
                    return;
                }
                
                // Generate JWT
                const token = jwt.sign(
                    { id: user.id, username: user.username },
                    JWT_SECRET,
                    { expiresIn: '1h' }
                );
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token }));
            } catch (error) {
                console.error('Login error:', error);
                res.writeHead(500).end('Login failed');
            }
        });
        return;
    }

    // Todo endpoints (protected)
    if (req.method === 'GET' && parsedUrl.pathname === '/todos') {
        authenticate(req, res, async () => {
            try {
                const todos = await query(
                    'SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC',
                    [req.user.id]
                );
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(todos));
            } catch (error) {
                console.error('Error getting todos:', error);
                res.writeHead(500).end('Error getting todos');
            }
        });
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/todos') {
        authenticate(req, res, async () => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { text } = JSON.parse(body);
                    await query(
                        'INSERT INTO todos (user_id, text) VALUES (?, ?)',
                        [req.user.id, text]
                    );
                    res.writeHead(201).end();
                } catch (error) {
                    console.error('Error adding todo:', error);
                    res.writeHead(500).end('Error adding todo');
                }
            });
        });
        return;
    }

    if (req.method === 'DELETE' && parsedUrl.pathname.startsWith('/todos/')) {
        authenticate(req, res, async () => {
            const todoId = parsedUrl.pathname.split('/')[2];
            try {
                // Verify the todo belongs to the user
                const [todos] = await query(
                    'SELECT * FROM todos WHERE id = ? AND user_id = ?',
                    [todoId, req.user.id]
                );
                
                if (todos.length === 0) {
                    res.writeHead(404).end('Todo not found');
                    return;
                }
                
                await query(
                    'DELETE FROM todos WHERE id = ?',
                    [todoId]
                );
                res.writeHead(200).end();
            } catch (error) {
                console.error('Error deleting todo:', error);
                res.writeHead(500).end('Error deleting todo');
            }
        });
        return;
    }

    // Not found
    res.writeHead(404).end('Not found');
}

// Initialize database and start server
initializeDatabase().then(() => {
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});