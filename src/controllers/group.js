const pool = require('../config/db');
const statsService = require('../services/statsService');

exports.create = async (req, res, next) => {
  try {
    const { name, description, banner_url, category, is_public } = req.body;

    const [result] = await pool.query(
      `INSERT INTO community_groups (user_id, name, description, banner_url, category, is_public)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, description || null, banner_url || null, category || null, is_public !== false]
    );

    // Add creator as admin member
    await pool.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [result.insertId, req.user.id, 'admin']
    );

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.status(200).json({ message: 'Group created', id: result.insertId });
  } catch (error) {
    next(error);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;

    let query = `SELECT g.*, u.name as creator_name, u.photo_url as creator_photo
                 FROM community_groups g
                 JOIN user_profiles u ON g.user_id = u.user_id
                 WHERE g.is_public = TRUE`;
    const params = [];

    if (category) { query += ' AND g.category = ?'; params.push(category); }

    const offset = (pageNum - 1) * limitNum;
    query += ' ORDER BY g.member_count DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const [groups] = await pool.query(query, params);

    // Add is_member flag
    for (const group of groups) {
      const [membership] = await pool.query(
        'SELECT id, role FROM group_members WHERE group_id = ? AND user_id = ?',
        [group.id, req.user.id]
      );
      group.is_member = membership.length > 0;
      group.member_role = membership.length > 0 ? membership[0].role : null;
    }

    let countQuery = 'SELECT COUNT(*) as total FROM community_groups WHERE is_public = TRUE';
    const countParams = [];
    if (category) { countQuery += ' AND category = ?'; countParams.push(category); }
    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      groups,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const [groups] = await pool.query(
      `SELECT g.*, u.name as creator_name, u.photo_url as creator_photo
       FROM community_groups g JOIN user_profiles u ON g.user_id = u.user_id
       WHERE g.id = ?`,
      [req.params.id]
    );

    if (groups.length === 0) return res.status(404).json({ error: 'Group not found' });

    const [membership] = await pool.query(
      'SELECT id, role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    const [members] = await pool.query(
      `SELECT u.user_id as id, u.name, u.photo_url, gm.role, gm.joined_at
       FROM group_members gm JOIN user_profiles u ON gm.user_id = u.user_id
       WHERE gm.group_id = ?`,
      [req.params.id]
    );

    res.json({
      ...groups[0],
      is_member: membership.length > 0,
      member_role: membership.length > 0 ? membership[0].role : null,
      members
    });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const [groups] = await pool.query(
      `SELECT user_id FROM community_groups WHERE id = ?`,
      [req.params.id]
    );
    if (groups.length === 0) return res.status(404).json({ error: 'Group not found' });

    const [membership] = await pool.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (membership.length === 0 || !['admin', 'moderator'].includes(membership[0].role)) {
      return res.status(403).json({ error: 'Only admins/moderators can update' });
    }

    const allowedFields = ['name', 'description', 'banner_url', 'category', 'is_public'];
    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      await pool.query(`UPDATE community_groups SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    res.json({ message: 'Group updated' });
  } catch (error) {
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const [groups] = await pool.query('SELECT user_id FROM community_groups WHERE id = ?', [req.params.id]);
    if (groups.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (groups[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM community_groups WHERE id = ?', [req.params.id]);
    res.json({ message: 'Group deleted' });
  } catch (error) {
    next(error);
  }
};

exports.join = async (req, res, next) => {
  try {
    const [groups] = await pool.query(
      'SELECT is_public FROM community_groups WHERE id = ?',
      [req.params.id]
    );
    if (groups.length === 0) return res.status(404).json({ error: 'Group not found' });
    if (!groups[0].is_public) return res.status(400).json({ error: 'Group is private' });

    const [existing] = await pool.query(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'Already a member' });

    await pool.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, 'member']
    );
    await pool.query(
      'UPDATE community_groups SET member_count = member_count + 1 WHERE id = ?',
      [req.params.id]
    );

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.status(200).json({ message: 'Joined group' });
  } catch (error) {
    next(error);
  }
};

exports.leave = async (req, res, next) => {
  try {
    const [membership] = await pool.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (membership.length === 0) return res.status(404).json({ error: 'Not a member' });
    if (membership[0].role === 'admin') {
      return res.status(400).json({ error: 'Admins cannot leave. Transfer ownership first or delete group.' });
    }

    await pool.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    await pool.query(
      'UPDATE community_groups SET member_count = GREATEST(member_count - 1, 0) WHERE id = ?',
      [req.params.id]
    );

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.json({ message: 'Left group' });
  } catch (error) {
    next(error);
  }
};

exports.getMembers = async (req, res, next) => {
  try {
    const [members] = await pool.query(
      `SELECT p.user_id as id, p.name, p.photo_url, u.trust_score,
              gm.role, gm.joined_at
       FROM group_members gm
       JOIN user_profiles p ON gm.user_id = p.user_id
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY gm.role = 'admin' DESC, gm.joined_at ASC`,
      [req.params.id]
    );
    res.json({ members: members.map(m => ({ ...m, trust_score: Number(m.trust_score) || 0 })) });
  } catch (error) {
    next(error);
  }
};

exports.createAnnouncement = async (req, res, next) => {
  try {
    const { title, content } = req.body;

    const [membership] = await pool.query(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (membership.length === 0 || !['admin', 'moderator'].includes(membership[0].role)) {
      return res.status(403).json({ error: 'Only admins/moderators can post announcements' });
    }

    const [result] = await pool.query(
      'INSERT INTO group_announcements (group_id, user_id, title, content) VALUES (?, ?, ?, ?)',
      [req.params.id, req.user.id, title, content || null]
    );

    // Notify all members
    const [members] = await pool.query(
      'SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ?',
      [req.params.id, req.user.id]
    );
    for (const member of members) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
        [member.user_id, `Announcement: ${title}`, content || '', 'system', 'group', req.params.id]
      );
    }

    res.status(200).json({ message: 'Announcement posted', id: result.insertId });
  } catch (error) {
    next(error);
  }
};

exports.getAnnouncements = async (req, res, next) => {
  try {
    const [announcements] = await pool.query(
      `SELECT ga.*, u.name as poster_name, u.photo_url as poster_photo
       FROM group_announcements ga JOIN user_profiles u ON ga.user_id = u.user_id
       WHERE ga.group_id = ?
       ORDER BY ga.created_at DESC`,
      [req.params.id]
    );
    res.json({ announcements });
  } catch (error) {
    next(error);
  }
};

exports.getMyGroups = async (req, res, next) => {
  try {
    const [groups] = await pool.query(
      `SELECT g.*, gm.role
       FROM community_groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY gm.joined_at DESC`,
      [req.user.id]
    );
    res.json({ groups });
  } catch (error) {
    next(error);
  }
};
