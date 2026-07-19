const pool = require('../config/db');
const { haversineDistance, paginate } = require('../utils/helpers');
const rewardService = require('../services/rewardService');
const statsService = require('../services/statsService');

exports.create = async (req, res, next) => {
  try {
    const {
      category_id, title, description, type, budget,
      date, start_time, end_time, hours_required,
      helpers_required, latitude, longitude, location_text, images,
      district, state, pincode
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO help_requests 
       (user_id, category_id, title, description, type, budget, date, start_time, end_time, 
        hours_required, helpers_required, latitude, longitude, location_text, district, state, pincode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, category_id, title, description, type, budget || null,
       date || null, start_time || null, end_time || null, hours_required || null,
       helpers_required || 1, latitude || null, longitude || null, location_text || null,
       district || null, state || null, pincode || null]
    );

    if (images && Array.isArray(images)) {
      for (const imageUrl of images) {
        await pool.query(
          'INSERT INTO help_request_images (help_request_id, image_url) VALUES (?, ?)',
          [result.insertId, imageUrl]
        );
      }
    }

    // Send notifications to nearby users (simplified)
    const [nearbyUsers] = await pool.query(
      `SELECT DISTINCT up.user_id FROM user_profiles up
       WHERE up.user_id != ? AND up.latitude IS NOT NULL AND up.longitude IS NOT NULL`,
      [req.user.id]
    );

    for (const nu of nearbyUsers) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
        [nu.user_id, 'New Help Request Nearby', title, 'task', 'help_request', result.insertId]
      );
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.status(200).json({
      message: 'Help request created',
      id: result.insertId
    });
  } catch (error) {
    next(error);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const {
      type, category_id, status, min_budget, max_budget,
      district, sort, page = 1, limit = 10
    } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;

    let query = `
      SELECT hr.*, c.name as category_name, c.type as category_type,
             p.name as user_name, p.photo_url as user_photo, u.trust_score
      FROM help_requests hr
      JOIN help_categories c ON hr.category_id = c.id
      JOIN user_profiles p ON hr.user_id = p.user_id
      JOIN users u ON hr.user_id = u.id
      WHERE hr.status != 'cancelled'
    `;
    let countQuery = `
      SELECT COUNT(*) as total
      FROM help_requests hr
      JOIN help_categories c ON hr.category_id = c.id
      JOIN user_profiles p ON hr.user_id = p.user_id
      JOIN users u ON hr.user_id = u.id
      WHERE hr.status != 'cancelled'
    `;
    const params = [];
    const countParams = [];

    if (type) { query += ' AND hr.type = ?'; countQuery += ' AND hr.type = ?'; params.push(type); countParams.push(type); }
    if (category_id) { query += ' AND hr.category_id = ?'; countQuery += ' AND hr.category_id = ?'; params.push(category_id); countParams.push(category_id); }
    if (status) { query += ' AND hr.status = ?'; countQuery += ' AND hr.status = ?'; params.push(status); countParams.push(status); }
    if (min_budget) { query += ' AND hr.budget >= ?'; countQuery += ' AND hr.budget >= ?'; params.push(min_budget); countParams.push(min_budget); }
    if (max_budget) { query += ' AND hr.budget <= ?'; countQuery += ' AND hr.budget <= ?'; params.push(max_budget); countParams.push(max_budget); }
    if (req.query.user_id) { query += ' AND hr.user_id = ?'; countQuery += ' AND hr.user_id = ?'; params.push(req.query.user_id); countParams.push(req.query.user_id); }
    if (district) { query += ' AND hr.district = ?'; countQuery += ' AND hr.district = ?'; params.push(district); countParams.push(district); }
    if (req.query.helper_id) {
      query += ` AND EXISTS (SELECT 1 FROM help_request_applications hra WHERE hra.help_request_id = hr.id AND hra.user_id = ? AND hra.status IN ('accepted', 'started_journey', 'arrived', 'work_started', 'completed'))`;
      countQuery += ` AND EXISTS (SELECT 1 FROM help_request_applications hra WHERE hra.help_request_id = hr.id AND hra.user_id = ? AND hra.status IN ('accepted', 'started_journey', 'arrived', 'work_started', 'completed'))`;
      params.push(req.query.helper_id);
      countParams.push(req.query.helper_id);
    }

    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    if (sort === 'budget_asc') { query += ' ORDER BY hr.budget ASC'; }
    else if (sort === 'budget_desc') { query += ' ORDER BY hr.budget DESC'; }
    else if (sort === 'newest') { query += ' ORDER BY hr.created_at DESC'; }
    else if (sort === 'oldest') { query += ' ORDER BY hr.created_at ASC'; }
    else { query += ' ORDER BY hr.created_at DESC'; }

    const { offset, limit: parsedLimit } = paginate(pageNum, limitNum);
    query += ' LIMIT ? OFFSET ?';
    params.push(parsedLimit, offset);

    const [requests] = await pool.query(query, params);

    // Calculate distance if user has location
    let userLat = null, userLng = null;
    if (req.user) {
      const [profile] = await pool.query(
        'SELECT latitude, longitude FROM user_profiles WHERE user_id = ?',
        [req.user.id]
      );
      if (profile.length > 0) {
        userLat = profile[0].latitude;
        userLng = profile[0].longitude;
      }
    }

    // Batch-fetch all images for these requests in one query
    let imagesMap = {};
    const ids = requests.length > 0 ? requests.map(r => r.id) : [];
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const [imgRows] = await pool.query(
        `SELECT help_request_id, image_url FROM help_request_images WHERE help_request_id IN (${placeholders}) ORDER BY id ASC`,
        ids
      );
      imgRows.forEach(row => {
        if (!imagesMap[row.help_request_id]) imagesMap[row.help_request_id] = [];
        imagesMap[row.help_request_id].push(row.image_url);
      });
    }

    // If querying as helper, batch-fetch application status for each request
    let appStatusMap = {};
    if (req.query.helper_id && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const [appRows] = await pool.query(
        `SELECT help_request_id, status FROM help_request_applications WHERE user_id = ? AND help_request_id IN (${placeholders})`,
        [req.query.helper_id, ...ids]
      );
      appRows.forEach(row => {
        appStatusMap[row.help_request_id] = row.status;
      });
    }

    const requestsWithDistance = requests.map(r => ({
      ...r,
      trust_score: Number(r.trust_score) || 0,
      images: imagesMap[r.id] || [],
      my_status: appStatusMap[r.id] || null,
      distance: (userLat && userLng && r.latitude && r.longitude)
        ? haversineDistance(userLat, userLng, r.latitude, r.longitude)
        : null
    }));

    res.json({
      requests: requestsWithDistance,
      pagination: {
        page: pageNum,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const [requests] = await pool.query(
      `SELECT hr.*, c.name as category_name, c.type as category_type,
              p.name as user_name, p.photo_url as user_photo, p.phone as user_phone,
              u.trust_score, p.district
       FROM help_requests hr
       JOIN help_categories c ON hr.category_id = c.id
       JOIN user_profiles p ON hr.user_id = p.user_id
       JOIN users u ON hr.user_id = u.id
       WHERE hr.id = ?`,
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }

    const [images] = await pool.query(
      'SELECT image_url FROM help_request_images WHERE help_request_id = ?',
      [req.params.id]
    );

    const [applications] = await pool.query(
      `SELECT a.*, p.name, p.photo_url, p.phone, u.trust_score
       FROM help_request_applications a
       JOIN user_profiles p ON a.user_id = p.user_id
       JOIN users u ON a.user_id = u.id
       WHERE a.help_request_id = ?`,
      [req.params.id]
    );

    const [isSaved] = req.user ? await pool.query(
      'SELECT id FROM help_request_saves WHERE help_request_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    ) : [[]];

    res.json({
      ...requests[0],
      trust_score: Number(requests[0].trust_score) || 0,
      images: images.map(i => i.image_url),
      applications: applications.map(a => ({ ...a, trust_score: Number(a.trust_score) || 0 })),
      is_saved: isSaved.length > 0
    });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const [requests] = await pool.query(
      'SELECT user_id FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const allowedFields = ['title', 'description', 'budget', 'date', 'start_time', 'end_time',
      'hours_required', 'helpers_required', 'latitude', 'longitude', 'location_text', 'category_id'];
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
      await pool.query(
        `UPDATE help_requests SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    res.json({ message: 'Help request updated' });
  } catch (error) {
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const [requests] = await pool.query(
      'SELECT user_id FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM help_requests WHERE id = ?', [req.params.id]);
    res.json({ message: 'Help request deleted' });
  } catch (error) {
    next(error);
  }
};

exports.apply = async (req, res, next) => {
  try {
    const { message } = req.body;
    const [requests] = await pool.query(
      'SELECT user_id, status FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].status !== 'open') {
      return res.status(400).json({ error: 'Request is not open for applications' });
    }
    if (requests[0].user_id === req.user.id) {
      return res.status(400).json({ error: 'Cannot apply to your own request' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Already applied' });
    }

    await pool.query(
      'INSERT INTO help_request_applications (help_request_id, user_id, message) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, message || null]
    );

    // Notify request owner with applicant name
    const [applicantProfile] = await pool.query(
      'SELECT name FROM user_profiles WHERE user_id = ?', [req.user.id]
    );
    const applicantName = applicantProfile[0]?.name || 'Someone';
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [requests[0].user_id, 'New Application', `${applicantName} wants to help with your request.`, 'task', 'help_request', req.params.id]
    );

    // Socket emit
    if (req.io) {
      req.io.to(`user:${requests[0].user_id}`).emit('notification', {
        type: 'new_application',
        title: 'New Application',
        body: `${applicantName} wants to help with your request.`,
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.status(200).json({ message: 'Application submitted' });
  } catch (error) {
    next(error);
  }
};

exports.acceptApplicant = async (req, res, next) => {
  try {
    const { applicant_id } = req.body;
    const [requests] = await pool.query(
      'SELECT user_id, status, helpers_required, helpers_confirmed FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the request owner can accept applicants' });
    }
    if (requests[0].status !== 'open') {
      return res.status(400).json({ error: 'Request is not open' });
    }

    const [application] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ? AND status = ?',
      [req.params.id, applicant_id, 'pending']
    );
    if (application.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE id = ?',
      ['accepted', application[0].id]
    );

    const newConfirmed = requests[0].helpers_confirmed + 1;
    const newStatus = newConfirmed >= requests[0].helpers_required ? 'in_progress' : 'open';
    await pool.query(
      'UPDATE help_requests SET helpers_confirmed = ?, status = ? WHERE id = ?',
      [newConfirmed, newStatus, req.params.id]
    );

    // Reject other pending applications if fully staffed
    if (newStatus === 'in_progress') {
      await pool.query(
        'UPDATE help_request_applications SET status = ? WHERE help_request_id = ? AND status = ?',
        ['rejected', req.params.id, 'pending']
      );
    }

    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [applicant_id, 'Application Accepted', 'Your application has been accepted. You can now start your journey.', 'task', 'help_request', req.params.id]
    );

    // Socket emit
    if (req.io) {
      req.io.to(`user:${applicant_id}`).emit('notification', {
        type: 'application_accepted',
        title: 'Application Accepted',
        body: 'Your application has been accepted. You can now start your journey.',
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    await statsService.syncUserStatsToFirestore(applicant_id);

    res.json({ message: 'Applicant accepted' });
  } catch (error) {
    next(error);
  }
};

exports.rejectApplicant = async (req, res, next) => {
  try {
    const { applicant_id } = req.body;
    const [requests] = await pool.query(
      'SELECT user_id, status FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the request owner can reject applicants' });
    }

    const [application] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ? AND status = ?',
      [req.params.id, applicant_id, 'pending']
    );
    if (application.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE id = ?',
      ['rejected', application[0].id]
    );

    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [applicant_id, 'Application Declined', 'Your application was declined.', 'task', 'help_request', req.params.id]
    );

    // Socket emit
    if (req.io) {
      req.io.to(`user:${applicant_id}`).emit('notification', {
        type: 'application_rejected',
        title: 'Application Declined',
        body: 'Your application was declined.',
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    res.json({ message: 'Applicant rejected' });
  } catch (error) {
    next(error);
  }
};

exports.complete = async (req, res, next) => {
  try {
    const [requests] = await pool.query(
      'SELECT user_id, status, budget, type FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the request owner can mark as complete' });
    }
    if (requests[0].status !== 'in_progress') {
      return res.status(400).json({ error: 'Request is not in progress' });
    }

    await pool.query(
      'UPDATE help_requests SET status = ? WHERE id = ?',
      ['completed', req.params.id]
    );

    // Update application statuses to completed
    await pool.query(
      "UPDATE help_request_applications SET status = ? WHERE help_request_id = ? AND status IN ('accepted', 'started_journey', 'arrived', 'work_started')",
      ['completed', req.params.id]
    );

    // Update requestor volunteer hours
    const [request] = await pool.query(
      'SELECT hours_required FROM help_requests WHERE id = ?',
      [req.params.id]
    );
    if (request[0].hours_required) {
      await pool.query(
        'UPDATE user_profiles SET volunteer_hours = COALESCE(volunteer_hours, 0) + ? WHERE user_id = ?',
        [request[0].hours_required, req.user.id]
      );
    }

    // Trigger Cashback & Rewards milestone checks
    const [completedApps] = await pool.query(
      'SELECT user_id FROM help_request_applications WHERE help_request_id = ? AND status = ?',
      [req.params.id, 'completed']
    );
    for (const app of completedApps) {
      rewardService.incrementCompletedJobs(app.user_id, 'helper').catch(console.error);
      
      if (req.io) {
        req.io.to(`user:${app.user_id}`).emit('notification', {
          type: 'job_completed',
          title: 'Job Completed',
          body: 'The job has been marked as completed.',
          referenceType: 'help_request',
          referenceId: req.params.id,
        });
      }
    }
    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    for (const app of completedApps) {
      await statsService.syncUserStatsToFirestore(app.user_id);
    }

    res.json({ message: 'Help request completed' });
  } catch (error) {
    next(error);
  }
};

exports.pay = async (req, res, next) => {
  try {
    const [requests] = await pool.query(
      'SELECT user_id, status, budget, type, title FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the request owner can pay' });
    }
    if (requests[0].status !== 'completed' && requests[0].status !== 'closed') {
      return res.status(400).json({ error: 'Request is not completed yet' });
    }
    if (requests[0].type !== 'paid') {
      return res.status(400).json({ error: 'This is not a paid help request' });
    }

    const budget = Number(requests[0].budget);
    if (!budget || budget <= 0) {
      return res.status(400).json({ error: 'Invalid budget amount' });
    }

    // Verify if already paid
    const [alreadyPaid] = await pool.query(
      "SELECT id FROM transactions WHERE reference_type = 'task_payment' AND reference_id = ? AND status = 'completed'",
      [req.params.id]
    );
    if (alreadyPaid.length > 0) {
      return res.json({ message: 'Payment already processed', payment_status: 'paid', status: 'closed' });
    }

    // Get completed applications first (validate before deducting)
    const [applications] = await pool.query(
      "SELECT user_id FROM help_request_applications WHERE help_request_id = ? AND status = 'completed'",
      [req.params.id]
    );
    if (applications.length === 0) {
      return res.status(400).json({ error: 'No completed helper found for this request. Complete the request first.' });
    }

    // Process Requester payment (deduct from wallet balance)
    const [requesterWallets] = await pool.query('SELECT id, balance FROM wallets WHERE user_id = ?', [req.user.id]);
    let requesterWalletId = null;
    let currentBalance = 0;
    if (requesterWallets.length > 0) {
      requesterWalletId = requesterWallets[0].id;
      currentBalance = Number(requesterWallets[0].balance) || 0;
    }
    if (currentBalance < budget) {
      return res.status(400).json({ error: 'Insufficient wallet balance. Please add funds via Razorpay.' });
    }
    await pool.query(
      'UPDATE wallets SET balance = balance - ? WHERE id = ?',
      [budget, requesterWalletId]
    );
    await pool.query(
      'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, reference_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [requesterWalletId, 'debit', budget, `Payment for task #${req.params.id}`, 'task_payment', req.params.id, 'completed']
    );

    // Credit Worker's wallet (minus 10% platform fee commission)
    const commission = Math.round(budget * 0.1 * 100) / 100;
    const netAmount = budget - commission;

    let helperId = null;
    for (const app of applications) {
      helperId = app.user_id;
      const [wallet] = await pool.query(
        'SELECT id FROM wallets WHERE user_id = ?',
        [app.user_id]
      );
      if (wallet.length > 0) {
        await pool.query(
          'UPDATE wallets SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?',
          [netAmount, netAmount, wallet[0].id]
        );
        await pool.query(
          'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, reference_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [wallet[0].id, 'credit', netAmount, `Payment for task #${req.params.id}`, 'task_payment', req.params.id, 'completed']
        );
      } else {
        const [newWallet] = await pool.query(
          'INSERT INTO wallets (user_id, balance, total_earned) VALUES (?, ?, ?)',
          [app.user_id, netAmount, netAmount]
        );
        await pool.query(
          'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, reference_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [newWallet.insertId, 'credit', netAmount, `Payment for task #${req.params.id}`, 'task_payment', req.params.id, 'completed']
        );
      }
    }

    // Update help request status to closed, and payment_status to paid
    await pool.query(
      "UPDATE help_requests SET status = 'closed', payment_status = 'paid' WHERE id = ?",
      [req.params.id]
    );

    // Send notifications to both requester and worker
    const [workerProfile] = helperId ? await pool.query('SELECT name FROM user_profiles WHERE user_id = ?', [helperId]) : [[]];
    const workerName = workerProfile[0]?.name || 'Helper';

    // Requester notification
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'Payment Successful', `Payment of ₹${budget} for "${requests[0].title}" was successful.`, 'payment', 'help_request', req.params.id]
    );

    // Worker notification
    if (helperId) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
        [helperId, 'Payment Received', `You received ₹${netAmount} for "${requests[0].title}".`, 'payment', 'help_request', req.params.id]
      );
    }

    // Socket broadcasts
    if (req.io) {
      req.io.to(`user:${req.user.id}`).emit('notification', {
        type: 'payment_success',
        title: 'Payment Successful',
        body: `Payment of ₹${budget} was successful.`,
        referenceType: 'help_request',
        referenceId: req.params.id,
      });

      if (helperId) {
        req.io.to(`user:${helperId}`).emit('notification', {
          type: 'payment_received',
          title: 'Payment Received',
          body: `You received ₹${netAmount} for "${requests[0].title}".`,
          referenceType: 'help_request',
          referenceId: req.params.id,
        });
      }
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    if (helperId) {
      await statsService.syncUserStatsToFirestore(helperId);
    }

    res.json({ message: 'Payment processed successfully', payment_status: 'paid', status: 'closed' });
  } catch (error) {
    next(error);
  }
};

const geocodeLocation = async (locationText) => {
  try {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    const res = await fetch(
      `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(locationText)}&format=json&apiKey=${apiKey}`
    );
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return {
        latitude: data.results[0].lat,
        longitude: data.results[0].lon,
      };
    }
  } catch (_) {}
  return null;
};

exports.startJourney = async (req, res, next) => {
  try {
    const [application] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'accepted']
    );
    if (application.length === 0) {
      return res.status(404).json({ error: 'No accepted application found' });
    }

    // Geocode location if coordinates missing
    let geocodedCoords = null;
    const [requestData] = await pool.query(
      'SELECT latitude, longitude, location_text FROM help_requests WHERE id = ?',
      [req.params.id]
    );
    if (requestData.length > 0 && (!requestData[0].latitude || !requestData[0].longitude) && requestData[0].location_text) {
      geocodedCoords = await geocodeLocation(requestData[0].location_text);
      if (geocodedCoords) {
        await pool.query(
          'UPDATE help_requests SET latitude = ?, longitude = ? WHERE id = ?',
          [geocodedCoords.latitude, geocodedCoords.longitude, req.params.id]
        );
      }
    }

    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE id = ?',
      ['started_journey', application[0].id]
    );

    // Notify request owner
    const [profile] = await pool.query('SELECT name FROM user_profiles WHERE user_id = ?', [req.user.id]);
    const [requestOwner] = await pool.query('SELECT user_id FROM help_requests WHERE id = ?', [req.params.id]);
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [requestOwner[0].user_id,
       'Worker Started Navigation', `${profile[0]?.name || 'Helper'} has started navigation to your location.`, 'task', 'help_request', req.params.id]
    );

    // Socket emit
    if (req.io) {
      req.io.to(`user:${requestOwner[0].user_id}`).emit('notification', {
        type: 'journey_started',
        title: 'Worker Started Navigation',
        body: `${profile[0]?.name || 'Helper'} has started navigation to your location.`,
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    if (requestOwner.length > 0) {
      await statsService.syncUserStatsToFirestore(requestOwner[0].user_id);
    }

    res.json({ message: 'Navigation started', ...(geocodedCoords || {}) });
  } catch (error) {
    next(error);
  }
};

exports.arrived = async (req, res, next) => {
  try {
    const [application] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'started_journey']
    );
    if (application.length === 0) {
      return res.status(404).json({ error: 'No active journey found' });
    }
    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE id = ?',
      ['arrived', application[0].id]
    );

    const [profile] = await pool.query('SELECT name FROM user_profiles WHERE user_id = ?', [req.user.id]);
    const [request] = await pool.query('SELECT user_id FROM help_requests WHERE id = ?', [req.params.id]);
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [request[0].user_id, 'Helper Arrived', `${profile[0]?.name || 'Helper'} has arrived.`, 'task', 'help_request', req.params.id]
    );

    if (req.io) {
      req.io.to(`user:${request[0].user_id}`).emit('notification', {
        type: 'helper_arrived',
        title: 'Helper Arrived',
        body: `${profile[0]?.name || 'Helper'} has arrived.`,
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    if (request.length > 0) {
      await statsService.syncUserStatsToFirestore(request[0].user_id);
    }

    res.json({ message: 'Arrival confirmed' });
  } catch (error) {
    next(error);
  }
};

exports.startWork = async (req, res, next) => {
  try {
    const [application] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'arrived']
    );
    if (application.length === 0) {
      return res.status(404).json({ error: 'No arrived application found. Must arrive first.' });
    }
    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE id = ?',
      ['work_started', application[0].id]
    );

    const [profile] = await pool.query('SELECT name FROM user_profiles WHERE user_id = ?', [req.user.id]);
    const [request] = await pool.query('SELECT user_id FROM help_requests WHERE id = ?', [req.params.id]);
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [request[0].user_id, 'Work Started', `${profile[0]?.name || 'Helper'} has started working.`, 'task', 'help_request', req.params.id]
    );

    if (req.io) {
      req.io.to(`user:${request[0].user_id}`).emit('notification', {
        type: 'work_started',
        title: 'Work Started',
        body: `${profile[0]?.name || 'Helper'} has started working.`,
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    if (request.length > 0) {
      await statsService.syncUserStatsToFirestore(request[0].user_id);
    }

    res.json({ message: 'Work started' });
  } catch (error) {
    next(error);
  }
};

exports.stopNavigation = async (req, res, next) => {
  try {
    const [application] = await pool.query(
      'SELECT id FROM help_request_applications WHERE help_request_id = ? AND user_id = ? AND status = ?',
      [req.params.id, req.user.id, 'started_journey']
    );
    if (application.length === 0) {
      return res.status(404).json({ error: 'No active navigation found' });
    }
    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE id = ?',
      ['arrived', application[0].id]
    );

    const [profile] = await pool.query('SELECT name FROM user_profiles WHERE user_id = ?', [req.user.id]);
    const [requestOwner] = await pool.query('SELECT user_id FROM help_requests WHERE id = ?', [req.params.id]);
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [requestOwner[0].user_id, 'Helper Arrived', `${profile[0]?.name || 'Helper'} has arrived.`, 'task', 'help_request', req.params.id]
    );

    if (req.io) {
      req.io.to(`user:${requestOwner[0].user_id}`).emit('notification', {
        type: 'helper_arrived',
        title: 'Helper Arrived',
        body: `${profile[0]?.name || 'Helper'} has arrived.`,
        referenceType: 'help_request',
        referenceId: req.params.id,
      });
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    if (requestOwner.length > 0) {
      await statsService.syncUserStatsToFirestore(requestOwner[0].user_id);
    }

    res.json({ message: 'Navigation stopped, arrival confirmed' });
  } catch (error) {
    next(error);
  }
};

exports.getTracking = async (req, res, next) => {
  try {
    const [applications] = await pool.query(
      `SELECT a.user_id as helper_id, a.status as application_status,
              p.name as helper_name, p.photo_url as helper_photo, p.latitude as helper_lat, p.longitude as helper_lng
       FROM help_request_applications a
       JOIN user_profiles p ON a.user_id = p.user_id
       WHERE a.help_request_id = ? AND (a.status = 'started_journey' OR a.status = 'arrived' OR a.status = 'work_started')`,
      [req.params.id]
    );

    const [request] = await pool.query(
      'SELECT latitude, longitude, location_text, user_id FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    res.json({
      tracking: applications.length > 0 ? {
        helper: applications[0],
        destination: request[0] ? {
          latitude: request[0].latitude,
          longitude: request[0].longitude,
          location_text: request[0].location_text,
        } : null,
      } : null,
    });
  } catch (error) {
    next(error);
  }
};

exports.cancel = async (req, res, next) => {
  try {
    const [requests] = await pool.query(
      'SELECT user_id, status FROM help_requests WHERE id = ?',
      [req.params.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }
    if (requests[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (requests[0].status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel completed request' });
    }

    await pool.query(
      'UPDATE help_requests SET status = ? WHERE id = ?',
      ['cancelled', req.params.id]
    );

    await pool.query(
      'UPDATE help_request_applications SET status = ? WHERE help_request_id = ? AND status = ?',
      ['rejected', req.params.id, 'pending']
    );

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);

    res.json({ message: 'Help request cancelled' });
  } catch (error) {
    next(error);
  }
};

exports.save = async (req, res, next) => {
  try {
    const [existing] = await pool.query(
      'SELECT id FROM help_request_saves WHERE help_request_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (existing.length > 0) {
      await pool.query(
        'DELETE FROM help_request_saves WHERE help_request_id = ? AND user_id = ?',
        [req.params.id, req.user.id]
      );
      res.json({ message: 'Unsaved', saved: false });
    } else {
      await pool.query(
        'INSERT INTO help_request_saves (help_request_id, user_id) VALUES (?, ?)',
        [req.params.id, req.user.id]
      );
      res.json({ message: 'Saved', saved: true });
    }
  } catch (error) {
    next(error);
  }
};

exports.getNearby = async (req, res, next) => {
  try {
    const { latitude, longitude, radius = 10, type, category_id, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    let userLat = parseFloat(latitude);
    let userLng = parseFloat(longitude);

    if ((!userLat || !userLng) && req.user) {
      const [profile] = await pool.query(
        'SELECT latitude, longitude FROM user_profiles WHERE user_id = ?',
        [req.user.id]
      );
      if (profile.length > 0) {
        userLat = profile[0].latitude;
        userLng = profile[0].longitude;
      }
    }

    if (!userLat || !userLng) {
      return res.status(400).json({ error: 'Location required' });
    }

    let query = `
      SELECT hr.*, c.name as category_name, c.type as category_type,
             p.name as user_name, p.photo_url as user_photo, u.trust_score
      FROM help_requests hr
      JOIN help_categories c ON hr.category_id = c.id
      JOIN user_profiles p ON hr.user_id = p.user_id
      JOIN users u ON hr.user_id = u.id
      WHERE hr.status = 'open' AND hr.latitude IS NOT NULL AND hr.longitude IS NOT NULL
    `;
    const params = [];

    if (type) { query += ' AND hr.type = ?'; params.push(type); }
    if (category_id) { query += ' AND hr.category_id = ?'; params.push(category_id); }

    const [allRequests] = await pool.query(query, params);

    const nearbyRequests = allRequests
      .map(r => ({
        ...r,
        distance: haversineDistance(userLat, userLng, r.latitude, r.longitude)
      }))
      .filter(r => r.distance <= parseFloat(radius))
      .sort((a, b) => a.distance - b.distance);

    // Emergency first, then by distance
    nearbyRequests.sort((a, b) => {
      if (a.type === 'emergency' && b.type !== 'emergency') return -1;
      if (a.type !== 'emergency' && b.type === 'emergency') return 1;
      return a.distance - b.distance;
    });

    const { offset, limit: parsedLimit } = paginate(pageNum, limitNum);
    const paginated = nearbyRequests.slice(offset, offset + parsedLimit);

    res.json({
      requests: paginated.map(r => ({ ...r, trust_score: Number(r.trust_score) || 0 })),
      pagination: {
        page: pageNum,
        limit: parsedLimit,
        total: nearbyRequests.length,
        pages: Math.ceil(nearbyRequests.length / parsedLimit)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getSaved = async (req, res, next) => {
  try {
    const [saves] = await pool.query(
      `SELECT hr.*, c.name as category_name, c.type as category_type,
              p.name as user_name, p.photo_url as user_photo, u.trust_score
       FROM help_request_saves s
       JOIN help_requests hr ON s.help_request_id = hr.id
       JOIN help_categories c ON hr.category_id = c.id
       JOIN user_profiles p ON hr.user_id = p.user_id
       JOIN users u ON hr.user_id = u.id
       WHERE s.user_id = ?`,
      [req.user.id]
    );
    res.json({ saves: saves.map(s => ({ ...s, trust_score: Number(s.trust_score) || 0 })) });
  } catch (error) {
    next(error);
  }
};

exports.share = async (req, res, next) => {
  try {
    res.json({ share_url: `localhands://request/${req.params.id}` });
  } catch (error) {
    next(error);
  }
};

exports.getMyAccepted = async (req, res, next) => {
  try {
    const [applications] = await pool.query(
      `SELECT a.id, a.help_request_id, a.status as application_status, a.created_at as applied_at,
              hr.title, hr.type, hr.status as request_status, hr.category_id,
              hr.budget, hr.location_text, hr.date, hr.start_time, hr.end_time,
              c.name as category_name, c.type as category_type,
              p.name as requester_name, p.photo_url as requester_photo, u.trust_score
       FROM help_request_applications a
       JOIN help_requests hr ON a.help_request_id = hr.id
       JOIN help_categories c ON hr.category_id = c.id
       JOIN user_profiles p ON hr.user_id = p.user_id
       JOIN users u ON hr.user_id = u.id
       WHERE a.user_id = ? AND (a.status = 'accepted' OR a.status = 'started_journey' OR a.status = 'arrived' OR a.status = 'work_started' OR a.status = 'completed')
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: applications });
  } catch (error) {
    next(error);
  }
};
