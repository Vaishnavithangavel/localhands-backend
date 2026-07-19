const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'localhands',
    multipleStatements: true,
  });

  try {
    console.log('Running migration...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS event_discussions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        user_id INT NOT NULL,
        content TEXT,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_event (event_id)
      ) ENGINE=InnoDB;
    `);

    console.log('Migration complete: event_discussions table created');

    // Add cashback_earned column to wallets if not exists
    try {
      await connection.query(
        `ALTER TABLE wallets ADD COLUMN cashback_earned DECIMAL(10,2) DEFAULT 0.00 AFTER total_earned`
      );
      console.log('Migration: added cashback_earned to wallets');
    } catch (_) {
      console.log('Migration: cashback_earned column already exists, skipping');
    }

    // Add reward_coins column to wallets if not exists
    try {
      await connection.query(
        `ALTER TABLE wallets ADD COLUMN reward_coins INT DEFAULT 0 AFTER cashback_earned`
      );
      console.log('Migration: added reward_coins to wallets');
    } catch (_) {
      console.log('Migration: reward_coins column already exists, skipping');
    }

    console.log('Migration complete: wallet columns added');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

migrate();
