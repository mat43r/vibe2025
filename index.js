const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '43Qwerty',
    database: 'todolist',
 };

async function retrieveListItems() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items ORDER BY id';
        const [rows] = await connection.execute(query);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}
  async function addListItem(text) {
    try {
       const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO items (text) VALUES (?)';
        await connection.execute(query, [text]);
        await connection.end();
    } catch (error) {
        console.error('Error adding list item:', error);
        throw error;
    }
 }

async function getHtmlRows() {
    const todoItems = await retrieveListItems();
    return todoItems.map(item => `
        <tr>
            <td>${item.id}</td>
            <td>${item.text}</td>
            <td><button class="delete-btn">×</button></td>
        </tr>
    `).join('');
}

async function handleRequest(req, res) {
    if (req.url === '/' && req.method === 'GET') {
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
    }
    else if (req.url === '/add' && req.method === 'POST') {
        // Получаем тело запроса
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            // Ограничим размер тела, чтобы избежать DoS
            if (body.length > 1e6) {
                req.connection.destroy();
            }
        });

        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (!data.text || typeof data.text !== 'string' || !data.text.trim()) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid text');
                    return;
                }
                await addListItem(data.text.trim());

                // После добавления возвращаем обновленные строки таблицы
                const updatedRows = await getHtmlRows();
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(updatedRows);
            } catch (err) {
                console.error('Error handling /add:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        });
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route not found');
    }
}
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));