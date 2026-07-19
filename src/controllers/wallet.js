const pool = require('../config/db');

exports.getWallet = async (req, res, next) => {
  try {
    const [wallets] = await pool.query(
      'SELECT * FROM wallets WHERE user_id = ?',
      [req.user.id]
    );

    if (wallets.length === 0) {
      const [result] = await pool.query(
        'INSERT INTO wallets (user_id, balance) VALUES (?, 0)',
        [req.user.id]
      );
      return res.json({ id: result.insertId, user_id: req.user.id, balance: 0, total_earned: 0, currency: 'INR' });
    }

    const w = wallets[0];
    w.balance = Number(w.balance) || 0;
    w.total_earned = Number(w.total_earned) || 0;
    res.json(w);
  } catch (error) {
    next(error);
  }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    const [wallet] = await pool.query('SELECT id FROM wallets WHERE user_id = ?', [req.user.id]);
    if (wallet.length === 0) return res.json({ transactions: [], pagination: { total: 0 } });

    const offset = (pageNum - 1) * limitNum;
    const [transactions] = await pool.query(
      `SELECT * FROM transactions WHERE wallet_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [wallet[0].id, limitNum, offset]
    );

    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM transactions WHERE wallet_id = ?',
      [wallet[0].id]
    );

    res.json({
      transactions: transactions.map(t => ({ ...t, amount: Number(t.amount) || 0 })),
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

exports.addUpi = async (req, res, next) => {
  try {
    const { upi_id } = req.body;
    if (!upi_id || !upi_id.includes('@')) {
      return res.status(400).json({ error: 'Valid UPI ID required' });
    }
    await pool.query('UPDATE user_profiles SET upi_id = ? WHERE user_id = ?', [upi_id, req.user.id]);
    res.json({ message: 'UPI ID added' });
  } catch (error) {
    next(error);
  }
};

exports.addBank = async (req, res, next) => {
  try {
    const { account_holder, account_number, ifsc } = req.body;
    if (!account_holder || !account_number || !ifsc) {
      return res.status(400).json({ error: 'All bank fields required' });
    }
    await pool.query(
      'UPDATE user_profiles SET bank_account_holder = ?, bank_account_number = ?, bank_ifsc = ? WHERE user_id = ?',
      [account_holder, account_number, ifsc, req.user.id]
    );
    res.json({ message: 'Bank details added' });
  } catch (error) {
    next(error);
  }
};

exports.withdraw = async (req, res, next) => {
  try {
    const { amount, method } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is ₹100' });
    }

    const [wallets] = await pool.query(
      'SELECT * FROM wallets WHERE user_id = ?',
      [req.user.id]
    );
    if (wallets.length === 0) return res.status(404).json({ error: 'Wallet not found' });

    if (wallets[0].balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const [profile] = await pool.query(
      'SELECT upi_id, bank_account_holder, bank_account_number, bank_ifsc FROM user_profiles WHERE user_id = ?',
      [req.user.id]
    );

    if (method === 'upi' && !profile[0].upi_id) {
      return res.status(400).json({ error: 'No UPI ID configured' });
    }
    if (method === 'bank' && (!profile[0].bank_account_number || !profile[0].bank_ifsc)) {
      return res.status(400).json({ error: 'No bank details configured' });
    }

    // Deduct balance
    await pool.query('UPDATE wallets SET balance = balance - ? WHERE id = ?', [amount, wallets[0].id]);

    // Create transaction
    await pool.query(
      'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, status) VALUES (?, ?, ?, ?, ?, ?)',
      [wallets[0].id, 'debit', amount, `Withdrawal via ${method.toUpperCase()}`, 'withdrawal', 'completed']
    );

    res.json({ message: `₹${amount} withdrawal initiated via ${method.toUpperCase()}` });
  } catch (error) {
    next(error);
  }
};
