const pool = require('../config/db');

exports.getConversations = async (req, res, next) => {
  try {
    // 1-on-1 conversations
    const [conversations] = await pool.query(
      `SELECT DISTINCT 
        CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as user_id,
        u.name, u.photo_url,
        (SELECT content FROM messages 
         WHERE (sender_id = ? AND receiver_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END)
            OR (receiver_id = ? AND sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END)
         ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages 
         WHERE (sender_id = ? AND receiver_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END)
            OR (receiver_id = ? AND sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END)
         ORDER BY created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages 
         WHERE receiver_id = ? AND sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
         AND is_read = FALSE) as unread_count,
        (SELECT hr.title FROM help_requests hr
         LEFT JOIN help_request_applications hra ON hr.id = hra.help_request_id
         WHERE (hr.user_id = ? AND hra.user_id = u.user_id) OR (hr.user_id = u.user_id AND hra.user_id = ?)
         ORDER BY hr.updated_at DESC LIMIT 1) as request_title,
        (SELECT hr.status FROM help_requests hr
         LEFT JOIN help_request_applications hra ON hr.id = hra.help_request_id
         WHERE (hr.user_id = ? AND hra.user_id = u.user_id) OR (hr.user_id = u.user_id AND hra.user_id = ?)
         ORDER BY hr.updated_at DESC LIMIT 1) as request_status,
        (SELECT hr.id FROM help_requests hr
         LEFT JOIN help_request_applications hra ON hr.id = hra.help_request_id
         WHERE (hr.user_id = ? AND hra.user_id = u.user_id) OR (hr.user_id = u.user_id AND hra.user_id = ?)
         ORDER BY hr.updated_at DESC LIMIT 1) as request_id,
        us.trust_score,
        'direct' as chat_type
       FROM messages m
       JOIN user_profiles u ON u.user_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
       JOIN users us ON us.id = u.user_id
       WHERE m.sender_id = ? OR m.receiver_id = ?
       ORDER BY last_message_time DESC`,
      [
        req.user.id,
        req.user.id, req.user.id, req.user.id, req.user.id,
        req.user.id, req.user.id, req.user.id, req.user.id,
        req.user.id, req.user.id,
        req.user.id, req.user.id,
        req.user.id, req.user.id,
        req.user.id, req.user.id,
        req.user.id, req.user.id, req.user.id
      ]
    );

    // User's groups with last message
    const [groups] = await pool.query(
      `SELECT g.id, g.name, g.banner_url as photo_url, g.member_count,
              (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              'group' as chat_type
       FROM community_groups g
       JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
       ORDER BY last_message_time DESC`,
      [req.user.id]
    );

    // User's registered events with last message
    const [events] = await pool.query(
      `SELECT e.id, e.title as name, e.banner_url as photo_url, e.date,
              (SELECT content FROM event_discussions WHERE event_id = e.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM event_discussions WHERE event_id = e.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              'event' as chat_type
       FROM events e
       JOIN event_registrations er ON e.id = er.event_id AND er.user_id = ?
       ORDER BY last_message_time DESC`,
      [req.user.id]
    );

    res.json({ conversations, groups, events });
  } catch (error) {
    next(error);
  }
};

exports.getMessages = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    const [messages] = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, userId, userId, req.user.id, limitNum, offset]
    );

    // Mark as read
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
      [userId, req.user.id]
    );

    res.json({ messages: messages.reverse() });
  } catch (error) {
    next(error);
  }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const { receiver_id, content, image_url, location_lat, location_lng } = req.body;

    const [result] = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, image_url, location_lat, location_lng)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, receiver_id, content || null, image_url || null, location_lat || null, location_lng || null]
    );

    // Notification
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [receiver_id, 'New Message', content ? content.substring(0, 100) : 'Sent you an image/location', 'chat', 'user', req.user.id]
    );

    res.status(200).json({ id: result.insertId, created_at: new Date() });
  } catch (error) {
    next(error);
  }
};

exports.getGroupMessages = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;

    const [membership] = await pool.query(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const offset = (pageNum - 1) * limitNum;
    const [messages] = await pool.query(
      `SELECT gm.*, u.name as sender_name, u.photo_url as sender_photo
       FROM group_messages gm
       JOIN user_profiles u ON gm.sender_id = u.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at DESC LIMIT ? OFFSET ?`,
      [groupId, limitNum, offset]
    );

    res.json({ messages: messages.reverse() });
  } catch (error) {
    next(error);
  }
};

exports.sendGroupMessage = async (req, res, next) => {
  try {
    const { group_id, content, image_url } = req.body;

    const [membership] = await pool.query(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [group_id, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const [result] = await pool.query(
      'INSERT INTO group_messages (group_id, sender_id, content, image_url) VALUES (?, ?, ?, ?)',
      [group_id, req.user.id, content || null, image_url || null]
    );

    res.status(200).json({ id: result.insertId, created_at: new Date() });
  } catch (error) {
    next(error);
  }
};

exports.getEventMessages = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;

    const [registration] = await pool.query(
      'SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [eventId, req.user.id]
    );
    const [event] = await pool.query('SELECT user_id FROM events WHERE id = ?', [eventId]);
    if (registration.length === 0 && (event.length === 0 || event[0].user_id !== req.user.id)) {
      return res.status(403).json({ error: 'Not registered for this event' });
    }

    const offset = (pageNum - 1) * limitNum;
    const [messages] = await pool.query(
      `SELECT ed.*, u.name as sender_name, u.photo_url as sender_photo
       FROM event_discussions ed
       JOIN user_profiles u ON ed.user_id = u.user_id
       WHERE ed.event_id = ?
       ORDER BY ed.created_at DESC LIMIT ? OFFSET ?`,
      [eventId, limitNum, offset]
    );

    res.json({ messages: messages.reverse() });
  } catch (error) {
    next(error);
  }
};

exports.sendEventMessage = async (req, res, next) => {
  try {
    const { event_id, content, image_url } = req.body;

    const [registration] = await pool.query(
      'SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [event_id, req.user.id]
    );
    const [event] = await pool.query('SELECT user_id FROM events WHERE id = ?', [event_id]);
    if (registration.length === 0 && (event.length === 0 || event[0].user_id !== req.user.id)) {
      return res.status(403).json({ error: 'Not registered for this event' });
    }

    const [result] = await pool.query(
      'INSERT INTO event_discussions (event_id, user_id, content, image_url) VALUES (?, ?, ?, ?)',
      [event_id, req.user.id, content || null, image_url || null]
    );

    res.status(200).json({ id: result.insertId, created_at: new Date() });
  } catch (error) {
    next(error);
  }
};


exports.markAsRead = async (req, res, next) => {
  try {
    const { senderId } = req.params;
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ?',
      [senderId, req.user.id]
    );
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    next(error);
  }
};

exports.getActiveRequest = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.query(
      `SELECT hr.id, hr.title, hr.type, hr.budget, hr.date, hr.start_time, hr.location_text, hr.status,
              hc.name as category_name,
              hra.status as application_status,
              hr.user_id as creator_id
       FROM help_requests hr
       JOIN help_categories hc ON hr.category_id = hc.id
       JOIN help_request_applications hra ON hr.id = hra.help_request_id
       WHERE ((hr.user_id = ? AND hra.user_id = ?) OR (hr.user_id = ? AND hra.user_id = ?))
       ORDER BY hr.updated_at DESC LIMIT 1`,
      [req.user.id, userId, userId, req.user.id]
    );

    const [userProfile] = await pool.query(
      `SELECT u.trust_score, up.name, up.photo_url, u.role
       FROM users u
       JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id = ?`,
      [userId]
    );

    res.json({
      request: rows[0] || null,
      profile: userProfile[0] || null
    });
  } catch (error) {
    next(error);
  }
};

// GET /chat/users?search=xxx  — all registered users (excluding self), for new chat discovery
exports.getAllUsers = async (req, res, next) => {
  try {
    const { search = '', limit = 50 } = req.query;
    const searchParam = `%${search}%`;

    const [users] = await pool.query(
      `SELECT up.user_id, up.name, up.photo_url, up.district, up.bio,
              u.trust_score, u.role, u.is_active,
              (SELECT content FROM messages
               WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id)
               ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages
               WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id)
               ORDER BY created_at DESC LIMIT 1) as last_message_time,
              (SELECT COUNT(*) FROM messages
               WHERE sender_id = u.id AND receiver_id = ? AND is_read = FALSE) as unread_count
       FROM users u
       JOIN user_profiles up ON u.id = up.user_id
       WHERE u.id != ?
         AND u.is_active = TRUE
         AND (up.name LIKE ? OR up.district LIKE ? OR u.role LIKE ?)
       ORDER BY last_message_time DESC, up.name ASC
       LIMIT ?`,
      [
        req.user.id, req.user.id,
        req.user.id, req.user.id,
        req.user.id,
        req.user.id,
        searchParam, searchParam, searchParam,
        parseInt(limit)
      ]
    );

    res.json({ users });
  } catch (error) {
    next(error);
  }
};

// GET /chat/all-groups?search=xxx  — all public groups with membership status
exports.getAllGroups = async (req, res, next) => {
  try {
    const { search = '', limit = 50 } = req.query;
    const searchParam = `%${search}%`;

    const [groups] = await pool.query(
      `SELECT g.id, g.name, g.description, g.banner_url as photo_url, g.member_count,
              g.category, g.is_public,
              (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              CASE WHEN gm.user_id IS NOT NULL THEN TRUE ELSE FALSE END as is_member,
              'group' as chat_type
       FROM community_groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
       WHERE (g.is_public = TRUE OR gm.user_id = ?)
         AND (g.name LIKE ? OR g.description LIKE ? OR g.category LIKE ?)
       ORDER BY gm.user_id DESC, g.member_count DESC
       LIMIT ?`,
      [req.user.id, req.user.id, searchParam, searchParam, searchParam, parseInt(limit)]
    );

    res.json({ groups });
  } catch (error) {
    next(error);
  }
};

