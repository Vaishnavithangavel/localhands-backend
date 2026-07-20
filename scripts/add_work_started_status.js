const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function migrate() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'localhands',
    waitForConnections: true,
  });

  try {
    await pool.query(
      "ALTER TABLE help_request_applications MODIFY COLUMN status ENUM('pending','accepted','rejected','completed','started_journey','arrived','work_started') DEFAULT 'pending'"
    );
    console.log('Migration successful: added work_started to ENUM');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
