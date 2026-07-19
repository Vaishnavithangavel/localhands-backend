const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function seed() {
  try {
    console.log('Seeding database...');

    // Categories
    const categories = [
      // Paid
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
      // Volunteer
      { name: 'Tree Plantation', type: 'volunteer', icon: 'park' },
      { name: 'Beach Cleaning', type: 'volunteer', icon: 'beach-access' },
      { name: 'Blood Donation Camp', type: 'volunteer', icon: 'bloodtype' },
      { name: 'Food Donation', type: 'volunteer', icon: 'restaurant' },
      { name: 'Animal Rescue', type: 'volunteer', icon: 'pets' },
      { name: 'Teaching', type: 'volunteer', icon: 'school' },
      { name: 'Community Service', type: 'volunteer', icon: 'group' },
      // Emergency
      { name: 'Medical Help', type: 'emergency', icon: 'local-hospital' },
      { name: 'Vehicle Breakdown', type: 'emergency', icon: 'car-repair' },
      { name: 'Missing Person', type: 'emergency', icon: 'person-search' },
      { name: 'Lost Pet', type: 'emergency', icon: 'paw' },
      { name: 'Accident Support', type: 'emergency', icon: 'warning' }
    ];

    for (const cat of categories) {
      await pool.query(
        'INSERT INTO help_categories (name, type, icon) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=name',
        [cat.name, cat.type, cat.icon]
      );
    }
    console.log('Categories seeded');

    // Badges
    const badges = [
      { name: 'Community Helper', description: 'Completed 10 tasks', criteria: JSON.stringify({ tasksCompleted: 10 }) },
      { name: 'Green Hero', description: 'Participated in 5 environmental events', criteria: JSON.stringify({ envEvents: 5 }) },
      { name: 'Life Saver', description: 'Responded to 3 emergencies', criteria: JSON.stringify({ emergencies: 3 }) },
      { name: 'Top Volunteer', description: 'Logged 100 volunteer hours', criteria: JSON.stringify({ volunteerHours: 100 }) }
    ];

    for (const badge of badges) {
      await pool.query(
        'INSERT INTO badges (name, description, criteria) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=name',
        [badge.name, badge.description, badge.criteria]
      );
    }
    console.log('Badges seeded');

    // Admin user (email: admin@localhands.com / password: Admin@123)
    const adminHash = await bcrypt.hash('Admin@123', 12);
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', ['admin@localhands.com']);
    if (existing.length === 0) {
      const [adminResult] = await pool.query(
        'INSERT INTO users (email, password_hash, role, is_verified, is_active) VALUES (?, ?, ?, TRUE, TRUE)',
        ['admin@localhands.com', adminHash, 'admin']
      );
      await pool.query(
        'INSERT INTO user_profiles (user_id, name) VALUES (?, ?)',
        [adminResult.insertId, 'Admin']
      );
      await pool.query(
        'INSERT INTO wallets (user_id, balance) VALUES (?, 0)',
        [adminResult.insertId]
      );
      console.log('Admin user created (admin@localhands.com / Admin@123)');
    } else {
      console.log('Admin user already exists');
    }

    console.log('Seeding complete!');
  } catch (error) {
    console.error('Seed failed:', error);
  } finally {
    process.exit(0);
  }
}

seed();
