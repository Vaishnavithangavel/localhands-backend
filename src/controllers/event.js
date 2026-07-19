const pool = require('../config/db');
const statsService = require('../services/statsService');

exports.create = async (req, res, next) => {
  try {
    const { title, banner_url, description, date, time, venue,
      venue_latitude, venue_longitude, max_participants, category } = req.body;

    const [result] = await pool.query(
      `INSERT INTO events (user_id, title, banner_url, description, date, time, venue,
        venue_latitude, venue_longitude, max_participants, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, banner_url || null, description || null, date, time,
       venue || null, venue_latitude || null, venue_longitude || null,
       max_participants || 0, category || null]
    );

    // Notify nearby users
    const [nearbyUsers] = await pool.query(
      `SELECT DISTINCT up.user_id FROM user_profiles up
       WHERE up.user_id != ? AND up.latitude IS NOT NULL`,
      [req.user.id]
    );
    for (const nu of nearbyUsers) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
        [nu.user_id, 'New Event Nearby', title, 'event', 'event', result.insertId]
      );
    }

    res.status(200).json({ message: 'Event created', id: result.insertId });
  } catch (error) {
    next(error);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;

    let query = `SELECT e.*, u.name as creator_name, u.photo_url as creator_photo
                 FROM events e JOIN user_profiles u ON e.user_id = u.user_id WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) as total FROM events e WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (status) {
      query += ' AND e.status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
      countParams.push(status);
    }
    if (category) {
      query += ' AND e.category = ?';
      countQuery += ' AND category = ?';
      params.push(category);
      countParams.push(category);
    }

    const offset = (pageNum - 1) * limitNum;
    query += ' ORDER BY e.date ASC, e.time ASC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const [events] = await pool.query(query, params);
    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      events,
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
    const [events] = await pool.query(
      `SELECT e.*, u.name as creator_name, u.photo_url as creator_photo, u.district
       FROM events e JOIN user_profiles u ON e.user_id = u.user_id
       WHERE e.id = ?`,
      [req.params.id]
    );

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const [attendees] = await pool.query(
      `SELECT u.user_id as id, u.name, u.photo_url
       FROM event_registrations er
       JOIN user_profiles u ON er.user_id = u.user_id
       WHERE er.event_id = ?`,
      [req.params.id]
    );

    const [isRegistered] = await pool.query(
      'SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    res.json({
      ...events[0],
      attendees,
      is_registered: isRegistered.length > 0
    });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const [events] = await pool.query(
      'SELECT user_id FROM events WHERE id = ?',
      [req.params.id]
    );
    if (events.length === 0) return res.status(404).json({ error: 'Event not found' });
    if (events[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const allowedFields = ['title', 'banner_url', 'description', 'date', 'time',
      'venue', 'venue_latitude', 'venue_longitude', 'max_participants', 'category', 'status'];
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
      await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    res.json({ message: 'Event updated' });
  } catch (error) {
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const [events] = await pool.query('SELECT user_id FROM events WHERE id = ?', [req.params.id]);
    if (events.length === 0) return res.status(404).json({ error: 'Event not found' });
    if (events[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM events WHERE id = ?', [req.params.id]);
    res.json({ message: 'Event deleted' });
  } catch (error) {
    next(error);
  }
};

exports.register = async (req, res, next) => {
  try {
    const [eventRows] = await pool.query(
      'SELECT max_participants, current_participants FROM events WHERE id = ? AND status = ?',
      [req.params.id, 'upcoming']
    );
    if (eventRows.length === 0) return res.status(404).json({ error: 'Event not found or not upcoming' });

    const event = eventRows[0];

    if (event.max_participants > 0 && event.current_participants >= event.max_participants) {
      return res.status(400).json({ error: 'Event is full' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'Already registered' });

    await pool.query('INSERT INTO event_registrations (event_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
    await pool.query('UPDATE events SET current_participants = current_participants + 1 WHERE id = ?', [req.params.id]);

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.status(200).json({ message: 'Registered for event' });
  } catch (error) {
    next(error);
  }
};

exports.unregister = async (req, res, next) => {
  try {
    await pool.query(
      'DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    await pool.query('UPDATE events SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = ?', [req.params.id]);

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.json({ message: 'Unregistered from event' });
  } catch (error) {
    next(error);
  }
};

exports.getAttendees = async (req, res, next) => {
  try {
    const [attendees] = await pool.query(
      `SELECT u.user_id as id, u.name, u.photo_url, er.created_at as registered_at
       FROM event_registrations er
       JOIN user_profiles u ON er.user_id = u.user_id
       WHERE er.event_id = ?
       ORDER BY er.created_at ASC`,
      [req.params.id]
    );
    res.json({ attendees });
  } catch (error) {
    next(error);
  }
};
