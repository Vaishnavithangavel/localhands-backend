const pool = require('../src/config/db');

(async () => {
  try {
    await pool.query(
      `ALTER TABLE help_request_applications MODIFY COLUMN status ENUM('pending','accepted','rejected','completed','started_journey') DEFAULT 'pending'`
    );
    console.log('Application status updated');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
