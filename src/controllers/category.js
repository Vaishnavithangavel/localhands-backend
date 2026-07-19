const pool = require('../config/db');

exports.getAll = async (req, res, next) => {
  try {
    const { type } = req.query;
    let query = 'SELECT * FROM help_categories WHERE is_active = TRUE';
    const params = [];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY type, name';
    const [categories] = await pool.query(query, params);
    res.json({ categories });
  } catch (error) {
    next(error);
  }
};
