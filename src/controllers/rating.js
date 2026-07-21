const pool = require('../config/db');
const { calculateTrustScore } = require('../utils/helpers');
const statsService = require('../services/statsService');
exports.create = async (req, res, next) => {
  try {
    const { help_request_id, to_user_id, rating, review } = req.body;

    if (req.user.id === to_user_id) {
      return res.status(400).json({ error: 'Cannot rate yourself' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM ratings WHERE help_request_id = ? AND from_user_id = ? AND to_user_id = ?',
      [help_request_id, req.user.id, to_user_id]
    );
    if (existing.length > 0) {
      return res.json({ message: 'Rating already submitted', already_exists: true });
    }

    const [request] = await pool.query(
      'SELECT status, payment_status FROM help_requests WHERE id = ?',
      [help_request_id]
    );
    if (request.length === 0) {
      return res.status(400).json({ error: 'Request not found' });
    }
    const isSettled = request[0].status === 'completed' || request[0].status === 'closed' || request[0].payment_status === 'paid';
    if (!isSettled) {
      return res.status(400).json({ error: 'Task must be completed before rating' });
    }

    await pool.query(
      'INSERT INTO ratings (help_request_id, from_user_id, to_user_id, rating, review) VALUES (?, ?, ?, ?, ?)',
      [help_request_id, req.user.id, to_user_id, rating, review || null]
    );

    // Recalculate trust score for recipient
    const [ratings] = await pool.query(
      'SELECT AVG(rating) as avg_rating FROM ratings WHERE to_user_id = ?',
      [to_user_id]
    );
    const [profile] = await pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [to_user_id]);
    const [tasks] = await pool.query(
      'SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status = ?',
      [to_user_id, 'completed']
    );

    const trustScore = calculateTrustScore({
      completedTasks: tasks[0].count,
      averageRating: ratings[0].avg_rating || 0,
      isVerified: true,
      volunteerHours: profile[0]?.volunteer_hours || 0,
      responseRate: profile[0]?.response_rate || 0
    });

    await pool.query('UPDATE users SET trust_score = ? WHERE id = ?', [trustScore, to_user_id]);

    // Sync stats (fire-and-forget — Firestore may be slow/disabled)
    statsService.syncUserStatsToFirestore(req.user.id).catch(() => {});
    statsService.syncUserStatsToFirestore(to_user_id).catch(() => {});

    res.status(200).json({ message: 'Rating submitted', trust_score: trustScore });
  } catch (error) {
    next(error);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [ratings] = await pool.query(
      `SELECT r.*, 
              u.name as rater_name, u.photo_url as rater_photo,
              tu.name as rated_user_name, tu.photo_url as rated_user_photo
       FROM ratings r
       JOIN user_profiles u ON r.from_user_id = u.user_id
       JOIN user_profiles tu ON r.to_user_id = tu.user_id
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM ratings');

    res.json({
      ratings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /ratings/community — write a community review (not tied to a help request)
exports.createCommunity = async (req, res, next) => {
  try {
    const { to_user_id, rating, review } = req.body;

    if (req.user.id === to_user_id) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    // Check for duplicate
    const [existing] = await pool.query(
      'SELECT id FROM community_reviews WHERE from_user_id = ? AND to_user_id = ?',
      [req.user.id, to_user_id]
    );
    if (existing.length > 0) {
      return res.json({ message: 'You already reviewed this user', already_exists: true });
    }

    await pool.query(
      'INSERT INTO community_reviews (from_user_id, to_user_id, rating, review) VALUES (?, ?, ?, ?)',
      [req.user.id, to_user_id, rating, review || null]
    );

    res.status(201).json({ message: 'Community review posted' });
  } catch (error) {
    next(error);
  }
};

// GET /ratings/community — fetch all community reviews (paginated)
exports.getCommunity = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [reviews] = await pool.query(
      `SELECT r.*,
              u.name as from_user_name, u.photo_url as from_user_photo,
              tu.name as to_user_name, tu.photo_url as to_user_photo
       FROM community_reviews r
       JOIN user_profiles u ON r.from_user_id = u.user_id
       JOIN user_profiles tu ON r.to_user_id = tu.user_id
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM community_reviews');

    res.json({
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

exports.getUserRatings = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const [ratings] = await pool.query(
      `SELECT r.*, u.name as rater_name, u.photo_url as rater_photo
       FROM ratings r
       JOIN user_profiles u ON r.from_user_id = u.user_id
       WHERE r.to_user_id = ?
       ORDER BY r.created_at DESC`,
      [userId]
    );

    const [stats] = await pool.query(
      'SELECT AVG(rating) as average, COUNT(*) as count FROM ratings WHERE to_user_id = ?',
      [userId]
    );

    res.json({
      ratings,
      average: stats[0].average || 0,
      count: stats[0].count || 0
    });
  } catch (error) {
    next(error);
  }
};
