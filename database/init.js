const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function initDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    multipleStatements: true
  });

  try {
    console.log('Connected to MySQL server');

    const dbName = process.env.DB_NAME || 'localhands';
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    console.log(`Dropped existing '${dbName}' database`);

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Remove comment lines (starting with --) and empty lines
    const cleanSchema = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n');

    await connection.query(cleanSchema);
    console.log('Schema created successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
    console.log('Database connection closed');
  }
}

initDatabase();
