const pool = require('../src/config/db');

(async () => {
  try {
    await pool.query(`ALTER TABLE help_requests ADD COLUMN district VARCHAR(100)`);
  } catch (_) { /* already exists */ }
  try {
    await pool.query(`ALTER TABLE help_requests ADD COLUMN state VARCHAR(100)`);
  } catch (_) { /* already exists */ }
  try {
    await pool.query(`ALTER TABLE help_requests ADD COLUMN pincode VARCHAR(20)`);
  } catch (_) { /* already exists */ }
  console.log('Location columns added successfully');
  await pool.end();
})();
