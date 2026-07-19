const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../config/db');
const statsService = require('../services/statsService');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

exports.createOrder = async (req, res, next) => {
  try {
    const { help_request_id, payment_method } = req.body;
    const userId = req.user.id;

    if (!help_request_id) {
      return res.status(400).json({ error: 'Help request ID is required' });
    }

    const [requests] = await pool.query(
      'SELECT user_id, status, budget, type FROM help_requests WHERE id = ?',
      [help_request_id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }

    const requestData = requests[0];

    if (requestData.user_id !== userId) {
      return res.status(403).json({ error: 'Only the request owner can pay' });
    }
    if (requestData.status !== 'completed') {
      return res.status(400).json({ error: 'Request is not completed yet' });
    }
    if (requestData.type !== 'paid') {
      return res.status(400).json({ error: 'This is not a paid help request' });
    }

    const [alreadyPaid] = await pool.query(
      "SELECT id FROM transactions WHERE reference_type = 'task_payment' AND reference_id = ? AND status = 'completed'",
      [help_request_id]
    );
    if (alreadyPaid.length > 0) {
      return res.status(400).json({ error: 'Payment already processed' });
    }

    const budgetAmount = Number(requestData.budget);
    if (!budgetAmount || budgetAmount <= 0) {
      return res.status(400).json({ error: 'Invalid budget amount' });
    }

    const amount = Math.round(budgetAmount * 100);

    const options = {
      amount,
      currency: 'INR',
      receipt: `help_req_${help_request_id}_${Date.now()}`,
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      help_request_id,
      payment_method,
    });
  } catch (error) {
    next(error);
  }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      help_request_id,
    } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !help_request_id) {
      return res.status(400).json({ error: 'Missing payment verification parameters' });
    }

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const [requests] = await pool.query(
      'SELECT user_id, status, budget, type, title FROM help_requests WHERE id = ?',
      [help_request_id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Help request not found' });
    }

    const requestData = requests[0];

    if (requestData.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the request owner can pay' });
    }

    const [alreadyPaid] = await pool.query(
      "SELECT id FROM transactions WHERE reference_type = 'task_payment' AND reference_id = ? AND status = 'completed'",
      [help_request_id]
    );
    if (alreadyPaid.length > 0) {
      return res.status(400).json({ error: 'Payment already processed' });
    }

    const budgetAmount = Number(requestData.budget);
    if (!budgetAmount || budgetAmount <= 0) {
      return res.status(400).json({ error: 'Invalid budget amount' });
    }
    const commission = Math.round(budgetAmount * 0.1 * 100) / 100;
    const netAmount = budgetAmount - commission;

    const [applications] = await pool.query(
      "SELECT user_id FROM help_request_applications WHERE help_request_id = ? AND status = 'completed'",
      [help_request_id]
    );
    if (applications.length === 0) {
      return res.status(400).json({ error: 'No completed helper found for this request. Complete the request first.' });
    }

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
          [wallet[0].id, 'credit', netAmount, `Payment for task #${help_request_id} via Razorpay (${razorpay_payment_id})`, 'task_payment', help_request_id, 'completed']
        );
      } else {
        const [newWallet] = await pool.query(
          'INSERT INTO wallets (user_id, balance, total_earned) VALUES (?, ?, ?)',
          [app.user_id, netAmount, netAmount]
        );
        await pool.query(
          'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, reference_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [newWallet.insertId, 'credit', netAmount, `Payment for task #${help_request_id} via Razorpay (${razorpay_payment_id})`, 'task_payment', help_request_id, 'completed']
        );
      }
    }

    await pool.query(
      "UPDATE help_requests SET status = 'closed', payment_status = 'paid' WHERE id = ?",
      [help_request_id]
    );

    // Send notifications
    await pool.query(
      'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'Payment Successful', `Payment of ₹${budgetAmount} for "${requestData.title}" was successful.`, 'payment', 'help_request', help_request_id]
    );

    if (helperId) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, body, type, reference_type, reference_id) VALUES (?, ?, ?, ?, ?, ?)',
        [helperId, 'Payment Received', `You received ₹${netAmount} for "${requestData.title}".`, 'payment', 'help_request', help_request_id]
      );
    }

    if (req.io) {
      req.io.to(`user:${req.user.id}`).emit('notification', {
        type: 'payment_success',
        title: 'Payment Successful',
        body: `Payment of ₹${budgetAmount} was successful.`,
        referenceType: 'help_request',
        referenceId: help_request_id,
      });

      if (helperId) {
        req.io.to(`user:${helperId}`).emit('notification', {
          type: 'payment_received',
          title: 'Payment Received',
          body: `You received ₹${netAmount} for "${requestData.title}".`,
          referenceType: 'help_request',
          referenceId: help_request_id,
        });
      }
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(req.user.id);
    if (helperId) {
      await statsService.syncUserStatsToFirestore(helperId);
    }

    res.json({
      message: 'Payment verified and processed successfully',
      payment_status: 'paid',
      status: 'closed',
      razorpay_payment_id,
    });
  } catch (error) {
    next(error);
  }
};
