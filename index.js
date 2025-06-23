const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
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
    const query = 'SELECT id, text FROM items';
    const [rows] = await connection.execute(query);
    await connection.end();
    return rows;
  } catch (error) {
    console.error('Error retrieving list items:', error);
    throw error;
  }
}
  async function deleteListItem(id) {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'DELETE FROM items WHERE id = ?';
    const [result] = await connection.execute(query, [id]);
    await connection.end();
    return result.affectedRows > 0;
  } catch (error) {
    console.error('Error deleting list item:', error);
    throw error;
  }
 }

// Stub function for generating HTML rows
async function getHtmlRows() {
     const todoItems = await retrieveListItems();
  return todoItems
    .map(
      (item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.text}</td>
      <td><button class="delete-btn" data-id="${item.id}">×</button></td>
    </tr>`
    )
    .join('');
}

// Modified request handler with template replacement
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.pathname === '/') {
    try {
      const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
      const processedHtml = html.replace('{{rows}}', await getHtmlRows());
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(processedHtml);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading index.html');
    }
  } else if (parsedUrl.pathname === '/delete' && req.method === 'DELETE') {
    const id = parsedUrl.query.id;
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing id parameter');
      return;
    }
    try {
      const success = await deleteListItem(id);
      if (success) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Item deleted');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });res.end('Item not found');
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error deleting item');
    }
   } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Route not found');
  }
}

// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));