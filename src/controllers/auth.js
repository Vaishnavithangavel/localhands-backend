const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { calculateTrustScore } = require('../utils/helpers');
const statsService = require('../services/statsService');

const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

exports.register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash]
    );

    await pool.query(
      'INSERT INTO user_profiles (user_id, name) VALUES (?, ?)',
      [result.insertId, name]
    );

    await pool.query(
      'INSERT INTO wallets (user_id, balance) VALUES (?, 50000)',
      [result.insertId]
    );

    const tokens = generateTokens(result.insertId, 'citizen');

    res.status(200).json({
      message: 'Registration successful',
      user: { id: result.insertId, email, role: 'citizen' },
      ...tokens
    });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [users] = await pool.query(
      'SELECT id, email, password_hash, role, is_active FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account has been deactivated' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokens = generateTokens(user.id, user.role);

    // Clean up old refresh tokens for this user
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, tokens.refreshToken, expiresAt]
    );

    res.json({
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role },
      ...tokens
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const [tokens] = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [refreshToken]
    );

    if (tokens.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const [users] = await pool.query('SELECT id, role FROM users WHERE id = ?', [decoded.userId]);

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const newTokens = generateTokens(users[0].id, users[0].role);

    await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [users[0].id, newTokens.refreshToken, expiresAt]
    );

    res.json(newTokens);
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.email, u.role, u.is_verified, u.trust_score, u.volunteer_points,
              p.name, p.phone, p.photo_url, p.date_of_birth, p.gender,
              p.district, p.area, p.pincode, p.address, p.bio,
              p.upi_id, p.bank_account_holder, p.bank_account_number, p.bank_ifsc,
              p.emergency_contact_name, p.emergency_contact_phone,
              p.latitude, p.longitude, p.volunteer_hours, p.response_rate
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Convert MySQL decimal/int strings to numbers
    user.trust_score = Number(user.trust_score) || 0;
    user.volunteer_points = Number(user.volunteer_points) || 0;
    user.volunteer_hours = Number(user.volunteer_hours) || 0;
    user.response_rate = Number(user.response_rate) || 0;
    user.latitude = user.latitude ? Number(user.latitude) : null;
    user.longitude = user.longitude ? Number(user.longitude) : null;

    const [skills] = await pool.query('SELECT skill FROM user_skills WHERE user_id = ?', [req.user.id]);
    const [languages] = await pool.query('SELECT language FROM user_languages WHERE user_id = ?', [req.user.id]);
    const [badges] = await pool.query(
      `SELECT b.id, b.name, b.description, b.icon_url, ub.earned_at
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = ?`,
      [req.user.id]
    );

    res.json({
      ...user,
      skills: skills.map(s => s.skill),
      languages: languages.map(l => l.language),
      badges
    });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const {
      name, phone, photo_url, date_of_birth, gender,
      district, area, pincode, address, bio,
      upi_id, bank_account_holder, bank_account_number, bank_ifsc,
      emergency_contact_name, emergency_contact_phone,
      latitude, longitude, skills, languages
    } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (photo_url !== undefined) { updates.push('photo_url = ?'); values.push(photo_url); }
    if (date_of_birth !== undefined) { updates.push('date_of_birth = ?'); values.push(date_of_birth); }
    if (gender !== undefined) { updates.push('gender = ?'); values.push(gender); }
    if (district !== undefined) { updates.push('district = ?'); values.push(district); }
    if (area !== undefined) { updates.push('area = ?'); values.push(area); }
    if (pincode !== undefined) { updates.push('pincode = ?'); values.push(pincode); }
    if (address !== undefined) { updates.push('address = ?'); values.push(address); }
    if (bio !== undefined) { updates.push('bio = ?'); values.push(bio); }
    if (upi_id !== undefined) { updates.push('upi_id = ?'); values.push(upi_id); }
    if (bank_account_holder !== undefined) { updates.push('bank_account_holder = ?'); values.push(bank_account_holder); }
    if (bank_account_number !== undefined) { updates.push('bank_account_number = ?'); values.push(bank_account_number); }
    if (bank_ifsc !== undefined) { updates.push('bank_ifsc = ?'); values.push(bank_ifsc); }
    if (emergency_contact_name !== undefined) { updates.push('emergency_contact_name = ?'); values.push(emergency_contact_name); }
    if (emergency_contact_phone !== undefined) { updates.push('emergency_contact_phone = ?'); values.push(emergency_contact_phone); }
    if (latitude !== undefined) { updates.push('latitude = ?'); values.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); values.push(longitude); }

    if (updates.length > 0) {
      values.push(req.user.id);
      await pool.query(
        `UPDATE user_profiles SET ${updates.join(', ')} WHERE user_id = ?`,
        values
      );
    }

    if (skills !== undefined && Array.isArray(skills)) {
      await pool.query('DELETE FROM user_skills WHERE user_id = ?', [req.user.id]);
      for (const skill of skills) {
        await pool.query('INSERT INTO user_skills (user_id, skill) VALUES (?, ?)', [req.user.id, skill]);
      }
    }

    if (languages !== undefined && Array.isArray(languages)) {
      await pool.query('DELETE FROM user_languages WHERE user_id = ?', [req.user.id]);
      for (const lang of languages) {
        await pool.query('INSERT INTO user_languages (user_id, language) VALUES (?, ?)', [req.user.id, lang]);
      }
    }

    // Update trust score
    const [ratings] = await pool.query(
      'SELECT AVG(rating) as avg_rating FROM ratings WHERE to_user_id = ?',
      [req.user.id]
    );
    const [profile] = await pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [req.user.id]);
    const [tasks] = await pool.query(
      'SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status = ?',
      [req.user.id, 'completed']
    );

    const trustScore = calculateTrustScore({
      completedTasks: tasks[0].count,
      averageRating: ratings[0].avg_rating || 0,
      isVerified: true,
      volunteerHours: profile[0]?.volunteer_hours || 0,
      responseRate: profile[0]?.response_rate || 0
    });

    await pool.query('UPDATE users SET trust_score = ? WHERE id = ?', [trustScore, req.user.id]);

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.json({ message: 'Profile updated', trust_score: trustScore });
  } catch (error) {
    next(error);
  }
};

exports.getProfileStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Completed jobs (as helper — your completed work for others)
    const [compHelper] = await pool.query(
      "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status = 'completed'",
      [userId]
    );
    const completedJobs = Number(compHelper[0]?.count || 0);

    // 2. Active jobs (accepted/in-progress as helper, or in_progress as requester)
    const [actHelper] = await pool.query(
      "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status IN ('accepted', 'started_journey', 'arrived', 'work_started')",
      [userId]
    );
    const [actRequester] = await pool.query(
      "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status = 'in_progress'",
      [userId]
    );
    const activeJobs = Number(actHelper[0]?.count || 0) + Number(actRequester[0]?.count || 0);

    // 3. Posted requests
    const [postedReq] = await pool.query(
      "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ?",
      [userId]
    );
    const postedRequests = Number(postedReq[0]?.count || 0);

    // 4. Applied jobs
    const [appliedReq] = await pool.query(
      "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ?",
      [userId]
    );
    const appliedJobs = Number(appliedReq[0]?.count || 0);

    // 5. Events joined
    const [eventsJ] = await pool.query(
      "SELECT COUNT(*) as count FROM event_registrations WHERE user_id = ?",
      [userId]
    );
    const eventsJoined = Number(eventsJ[0]?.count || 0);

    // 6. Groups joined
    const [groupsJ] = await pool.query(
      "SELECT COUNT(*) as count FROM group_members WHERE user_id = ?",
      [userId]
    );
    const groupsJoined = Number(groupsJ[0]?.count || 0);

    // 7. Wallet
    const [walletRows] = await pool.query(
      "SELECT balance, total_earned, cashback_earned, reward_coins FROM wallets WHERE user_id = ?",
      [userId]
    );
    const wallet = walletRows.length > 0 ? walletRows[0] : { balance: 0, total_earned: 0, cashback_earned: 0, reward_coins: 0 };

    // 8. Ratings
    const [ratingsRow] = await pool.query(
      "SELECT AVG(rating) as average, COUNT(*) as count FROM ratings WHERE to_user_id = ?",
      [userId]
    );

    res.json({
      completed_jobs: Number(completedJobs),
      active_jobs: Number(activeJobs),
      posted_requests: Number(postedRequests),
      applied_jobs: Number(appliedJobs),
      events_joined: Number(eventsJoined),
      groups_joined: Number(groupsJoined),
      wallet_balance: Number(wallet.balance) || 0,
      total_earnings: Number(wallet.total_earned) || 0,
      cashback_earned: Number(wallet.cashback_earned) || 0,
      reward_coins: Number(wallet.reward_coins) || 0,
      rating_average: Number(ratingsRow[0]?.average) || 0,
      rating_count: Number(ratingsRow[0]?.count) || 0,
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;

    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ?)', [userId]);
    await pool.query('DELETE FROM wallets WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_skills WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_languages WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_badges WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM ratings WHERE from_user_id = ? OR to_user_id = ?', [userId, userId]);
    await pool.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM help_request_applications WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM help_requests WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM user_profiles WHERE user_id = ?', [userId]);
    await pool.query('DELETE FROM users WHERE id = ?', [userId]);

    // Clean up Firestore (best-effort)
    try {
      const { admin } = require('../config/firebase');
      if (admin && admin.firestore) {
        const db = admin.firestore();
        await db.collection('wallets').doc(String(userId)).delete();
        const rewardsSnap = await db.collection('rewards').where('userId', '==', Number(userId)).get();
        rewardsSnap.forEach(doc => doc.ref.delete());
        const vouchersSnap = await db.collection('vouchers').where('userId', '==', Number(userId)).get();
        vouchersSnap.forEach(doc => doc.ref.delete());
      }
    } catch (_) {}

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    next(error);
  }
};
