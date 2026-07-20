const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function autoInitDb() {
  try {
    const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.log('schema.sql not found, skipping auto-init');
      return;
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');
    const statements = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n')
      .replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
      .replace(/CREATE DATABASE .+?;/g, '');

    await pool.query(statements);
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.warn('Auto DB init skipped (tables may already exist):', error.message);
  }
}

module.exports = autoInitDb;
