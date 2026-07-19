const pool = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function main() {
  try {
    const email = 'vaishnavithangavelm@gmail.com';
    const name = 'Vaishnavi';
    const password = '@Vaishu26#';
    const targetBalance = 500000;

    const [users] = await pool.query(
      'SELECT u.id, u.email FROM users u JOIN user_profiles p ON u.id = p.user_id WHERE u.email = ?',
      [email]
    );

    let userId;

    if (users.length > 0) {
      userId = users[0].id;
      console.log(`Found existing user: ${users[0].email} (ID: ${userId})`);
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      const [userResult] = await pool.query(
        'INSERT INTO users (email, password_hash, role, is_verified, is_active, trust_score) VALUES (?, ?, ?, TRUE, TRUE, 5.0)',
        [email, passwordHash, 'citizen']
      );
      userId = userResult.insertId;

      await pool.query(
        'INSERT INTO user_profiles (user_id, name) VALUES (?, ?)',
        [userId, name]
      );
      console.log(`Created new user: ${email} (ID: ${userId}) with password: ${password}`);
    }

    const [wallets] = await pool.query('SELECT id, balance FROM wallets WHERE user_id = ?', [userId]);

    if (wallets.length > 0) {
      await pool.query('UPDATE wallets SET balance = ? WHERE user_id = ?', [targetBalance, userId]);
      console.log(`Updated wallet balance from ₹${wallets[0].balance} to ₹${targetBalance}`);
    } else {
      await pool.query(
        'INSERT INTO wallets (user_id, balance, total_earned, cashback_earned, reward_coins) VALUES (?, ?, 0, 0, 0)',
        [userId, targetBalance]
      );
      console.log(`Created wallet with balance ₹${targetBalance}`);
    }

    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
