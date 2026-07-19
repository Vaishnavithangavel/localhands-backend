const pool = require('../config/db');
const { paginate } = require('../utils/helpers');

exports.getUsers = async (req, res, next) => {
  try {
    const { search, role, is_active, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    let query = `SELECT u.id, u.email, u.role, u.is_verified, u.is_active, u.trust_score,
                        u.volunteer_points, u.created_at,
                        p.name, p.phone, p.photo_url, p.district, p.area, p.pincode
                 FROM users u JOIN user_profiles p ON u.id = p.user_id WHERE 1=1`;
    const params = [];

    if (search) { query += ' AND (p.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (role) { query += ' AND u.role = ?'; params.push(role); }
    if (is_active !== undefined) { query += ' AND u.is_active = ?'; params.push(is_active === 'true'); }

    const countQuery = query.replace(
      'SELECT u.id, u.email, u.role, u.is_verified, u.is_active, u.trust_score, u.volunteer_points, u.created_at, p.name, p.phone, p.photo_url, p.district, p.area, p.pincode',
      'SELECT COUNT(*) as total'
    );
    const [countResult] = await pool.query(countQuery, params);

    const { offset, limit: parsedLimit } = paginate(pageNum, limitNum);
    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parsedLimit, offset);

    const [users] = await pool.query(query, params);
    res.json({
      users,
      pagination: {
        page: pageNum,
        limit: parsedLimit,
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / parsedLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.banUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [id]);
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?)',
      [req.user.id, 'ban_user', 'user', id]
    );
    res.json({ message: 'User banned' });
  } catch (error) {
    next(error);
  }
};

exports.unbanUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE users SET is_active = TRUE WHERE id = ?', [id]);
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?)',
      [req.user.id, 'unban_user', 'user', id]
    );
    res.json({ message: 'User unbanned' });
  } catch (error) {
    next(error);
  }
};

exports.verifyUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = ?', [id]);
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?)',
      [req.user.id, 'verify_user', 'user', id]
    );
    res.json({ message: 'User verified' });
  } catch (error) {
    next(error);
  }
};

exports.getReports = async (req, res, next) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    let query = `SELECT r.*, rep.name as reporter_name, ru.name as reported_user_name
                 FROM reports r
                 JOIN user_profiles rep ON r.reporter_id = rep.user_id
                 LEFT JOIN user_profiles ru ON r.reported_user_id = ru.user_id
                 WHERE r.status = ?`;
    const params = [status];

    const countQuery = `SELECT COUNT(*) as total FROM reports WHERE status = ?`;
    const [countResult] = await pool.query(countQuery, [status]);

    const { offset, limit: parsedLimit } = paginate(pageNum, limitNum);
    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parsedLimit, offset);

    const [reports] = await pool.query(query, params);
    res.json({
      reports,
      pagination: {
        page: pageNum,
        limit: parsedLimit,
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / parsedLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.resolveReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, status } = req.body;

    if (action === 'ban_user' && req.body.reported_user_id) {
      await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [req.body.reported_user_id]);
    }
    if (action === 'remove_request' && req.body.help_request_id) {
      await pool.query('DELETE FROM help_requests WHERE id = ?', [req.body.help_request_id]);
    }

    await pool.query(
      'UPDATE reports SET status = ?, resolved_by = ? WHERE id = ?',
      [status || 'resolved', req.user.id, id]
    );

    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'resolve_report', 'report', id, action || 'resolved']
    );

    res.json({ message: 'Report resolved' });
  } catch (error) {
    next(error);
  }
};

exports.removeHelpRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [requests] = await pool.query('SELECT id FROM help_requests WHERE id = ?', [id]);
    if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });

    await pool.query('DELETE FROM help_requests WHERE id = ?', [id]);
    await pool.query(
      'INSERT INTO admin_logs (admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?)',
      [req.user.id, 'remove_help_request', 'help_request', id]
    );
    res.json({ message: 'Help request removed' });
  } catch (error) {
    next(error);
  }
};

exports.getAnalytics = async (req, res, next) => {
  try {
    const [totalUsers] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role != ?', ['admin']);
    const [activeUsers] = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_active = TRUE AND role != ?', ['admin']);
    const [newUsersToday] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = CURDATE() AND role != ?',
      ['admin']
    );

    const [totalTasks] = await pool.query('SELECT COUNT(*) as count FROM help_requests');
    const [tasksByStatus] = await pool.query(
      'SELECT status, COUNT(*) as count FROM help_requests GROUP BY status'
    );
    const [tasksByType] = await pool.query(
      'SELECT type, COUNT(*) as count FROM help_requests GROUP BY type'
    );

    const [totalEvents] = await pool.query('SELECT COUNT(*) as count FROM events');
    const [eventsByStatus] = await pool.query(
      'SELECT status, COUNT(*) as count FROM events GROUP BY status'
    );

    const [totalRevenue] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'credit' AND status = 'completed'`
    );

    // Recent activity
    const [recentActivity] = await pool.query(
      `SELECT 'new_user' as type, u.created_at as time,
              CONCAT(p.name, ' joined') as description
       FROM users u JOIN user_profiles p ON u.id = p.user_id
       WHERE u.role != 'admin'
       ORDER BY u.created_at DESC LIMIT 5`
    );

    res.json({
      users: {
        total: totalUsers[0].count,
        active: activeUsers[0].count,
        new_today: newUsersToday[0].count
      },
      tasks: {
        total: totalTasks[0].count,
        by_status: tasksByStatus,
        by_type: tasksByType
      },
      events: {
        total: totalEvents[0].count,
        by_status: eventsByStatus
      },
      revenue: totalRevenue[0].total,
      recent_activity: recentActivity
    });
  } catch (error) {
    next(error);
  }
};

exports.getDistrictStats = async (req, res, next) => {
  try {
    const [stats] = await pool.query(
      `SELECT p.district,
              COUNT(DISTINCT p.user_id) as user_count,
              COUNT(DISTINCT hr.id) as task_count,
              COUNT(DISTINCT e.id) as event_count
       FROM user_profiles p
       LEFT JOIN help_requests hr ON p.user_id = hr.user_id
       LEFT JOIN events e ON p.user_id = e.user_id
       WHERE p.district IS NOT NULL
       GROUP BY p.district
       ORDER BY user_count DESC`
    );
    res.json({ districts: stats });
  } catch (error) {
    next(error);
  }
};
