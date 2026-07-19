const pool = require('../src/config/db');

(async () => {
  try {
    await pool.query('ALTER TABLE users MODIFY COLUMN trust_score DECIMAL(5,2) DEFAULT 0.00');
    console.log('Column trust_score altered to DECIMAL(5,2) successfully');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
