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

    // Split into individual statements by semicolons, clean each one
    const statements = schema
      .split(';')
      .map(stmt => stmt
        .split('\n')
        .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
        .join('\n')
        .trim()
      )
      .filter(stmt => stmt.length > 0)
      .filter(stmt => !/^CREATE DATABASE/i.test(stmt))
      .filter(stmt => !/^USE /i.test(stmt))
      .map(stmt => stmt.replace(/^CREATE TABLE (?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS '));

    let executed = 0;
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
        executed++;
      } catch (err) {
        console.warn(`Skipped statement: ${err.message.substring(0, 80)}`);
      }
    }

    console.log(`Database tables initialized (${executed} statements executed)`);
  } catch (error) {
    console.warn('Auto DB init failed:', error.message);
  }
}

module.exports = autoInitDb;
