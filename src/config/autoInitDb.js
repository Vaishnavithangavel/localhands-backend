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

    // Seed default categories if table is empty
    try {
      const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM help_categories');
      if (rows[0].cnt === 0) {
        const defaultCats = [
          { name: 'Pet Care', type: 'paid', icon: 'pets' },
          { name: 'Grocery Pickup', type: 'paid', icon: 'shopping-cart' },
          { name: 'Parcel Delivery', type: 'paid', icon: 'local-shipping' },
          { name: 'Tutoring', type: 'paid', icon: 'school' },
          { name: 'Driver', type: 'paid', icon: 'directions-car' },
          { name: 'House Cleaning', type: 'paid', icon: 'cleaning-services' },
          { name: 'Electrician', type: 'paid', icon: 'bolt' },
          { name: 'Computer Help', type: 'paid', icon: 'computer' },
          { name: 'Elder Care', type: 'paid', icon: 'elderly' },
          { name: 'Babysitting', type: 'paid', icon: 'child-care' },
          { name: 'Photography', type: 'paid', icon: 'camera-alt' },
          { name: 'Tree Plantation', type: 'volunteer', icon: 'park' },
          { name: 'Beach Cleaning', type: 'volunteer', icon: 'beach-access' },
          { name: 'Blood Donation Camp', type: 'volunteer', icon: 'bloodtype' },
          { name: 'Food Donation', type: 'volunteer', icon: 'restaurant' },
          { name: 'Animal Rescue', type: 'volunteer', icon: 'pets' },
          { name: 'Teaching', type: 'volunteer', icon: 'school' },
          { name: 'Community Service', type: 'volunteer', icon: 'group' },
          { name: 'Medical Help', type: 'emergency', icon: 'local-hospital' },
          { name: 'Vehicle Breakdown', type: 'emergency', icon: 'car-repair' },
          { name: 'Missing Person', type: 'emergency', icon: 'person-search' },
          { name: 'Lost Pet', type: 'emergency', icon: 'paw' },
          { name: 'Accident Support', type: 'emergency', icon: 'warning' },
        ];
        for (const cat of defaultCats) {
          await pool.query(
            'INSERT IGNORE INTO help_categories (name, type, icon) VALUES (?, ?, ?)',
            [cat.name, cat.type, cat.icon]
          );
        }
        console.log(`Seeded ${defaultCats.length} default categories`);
      }
    } catch (seedErr) {
      console.warn('Auto-seed categories skipped:', seedErr.message);
    }
  } catch (error) {
    console.warn('Auto DB init failed:', error.message);
  }
}

module.exports = autoInitDb;
