const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'localhands',
    multipleStatements: true,
  });

  try {
    console.log('Altering help_requests table status enum...');
    await connection.query(`
      ALTER TABLE help_requests 
      MODIFY COLUMN status ENUM('open','in_progress','completed','cancelled','closed') DEFAULT 'open';
    `);
    console.log('Status enum updated successfully.');

    console.log('Adding payment_status column if it does not exist...');
    // We try to add the column, if it fails because it already exists we catch the error code 1060
    try {
      await connection.query(`
        ALTER TABLE help_requests 
        ADD COLUMN payment_status ENUM('unpaid', 'paid') DEFAULT 'unpaid';
      `);
      console.log('payment_status column added successfully.');
    } catch (err) {
      if (err.errno === 1060) {
        console.log('payment_status column already exists.');
      } else {
        throw err;
      }
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
