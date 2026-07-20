const pool = require('../config/db');
const { admin } = require('../config/firebase');
let db = null;
try { db = admin.firestore(); } catch (_) { console.warn('rewardService: Firestore unavailable'); }
const statsService = require('./statsService');

// Milestones configuration
const MILESTONES = [
  { jobs: 10, cashback: 10 },
  { jobs: 25, cashback: 30 },
  { jobs: 50, cashback: 75 },
  { jobs: 100, cashback: 200 }
];

// Scratch Card Possible Rewards
const SCRATCH_CARD_REWARDS = [
  { type: 'cashback', value: 10, label: '₹10 Cashback' },
  { type: 'cashback', value: 20, label: '₹20 Cashback' },
  { type: 'cashback', value: 50, label: '₹50 Cashback' },
  { type: 'voucher', discount: 5, code: 'LH5DISC', label: '5% Discount Voucher' },
  { type: 'voucher', discount: 10, code: 'LH10DISC', label: '10% Discount Voucher' },
  { type: 'voucher', discount: 100, code: 'LHFREEPF', label: 'Free Platform Fee Voucher' }
];

/**
 * Increment completed jobs for a user and trigger milestone checks
 */
exports.incrementCompletedJobs = async (userId, role) => {
  try {
    if (!userId) return;

    let count = 0;
    if (role === 'helper') {
      const [res] = await pool.query(
        "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status = 'completed'",
        [userId]
      );
      count = res[0]?.count || 0;
    } else {
      const [res] = await pool.query(
        "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status IN ('completed', 'closed')",
        [userId]
      );
      count = res[0]?.count || 0;
    }

    if (db) {
      const walletRef = db.collection('wallets').doc(String(userId));
      const walletSnap = await walletRef.get();

      if (!walletSnap.exists) {
        await walletRef.set({
          userId: Number(userId),
          balance: 0,
          cashback_earned: 0,
          reward_coins: 0,
          completed_jobs: count,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await walletRef.update({
          completed_jobs: count,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Check milestones
      await exports.checkMilestones(userId, count);
    }

    // Sync stats
    await statsService.syncUserStatsToFirestore(userId);
  } catch (error) {
    console.error('Error in incrementCompletedJobs:', error);
  }
};

/**
 * Check and credit milestone rewards
 */
exports.checkMilestones = async (userId, completedJobsCount) => {
  try {
    if (!db) return;

    const matchedMilestones = MILESTONES.filter(m => completedJobsCount >= m.jobs);

    for (const milestone of matchedMilestones) {
      // Check if already awarded
      const rewardsSnap = await db.collection('rewards')
        .where('userId', '==', Number(userId))
        .where('milestone', '==', milestone.jobs)
        .get();

      if (rewardsSnap.empty) {
        // Milestone not yet awarded! Proceed with reward crediting
        const cashback = milestone.cashback;

        // 1. Credit wallet in Firestore
        const walletRef = db.collection('wallets').doc(String(userId));
        await walletRef.set({
          balance: admin.firestore.FieldValue.increment(cashback),
          cashback_earned: admin.firestore.FieldValue.increment(cashback),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // 2. Sync with MySQL wallet
        const [mysqlWallets] = await pool.query('SELECT id FROM wallets WHERE user_id = ?', [userId]);
        let mysqlWalletId;
        if (mysqlWallets.length > 0) {
          mysqlWalletId = mysqlWallets[0].id;
          await pool.query('UPDATE wallets SET balance = balance + ?, cashback_earned = COALESCE(cashback_earned, 0) + ? WHERE id = ?', [cashback, cashback, mysqlWalletId]);
        } else {
          const [newWallet] = await pool.query('INSERT INTO wallets (user_id, balance) VALUES (?, ?)', [userId, cashback]);
          mysqlWalletId = newWallet.insertId;
        }

        // 3. Log transaction in Firestore
        const txRef = db.collection('wallet_transactions').doc();
        await txRef.set({
          userId: Number(userId),
          type: 'credit',
          amount: cashback,
          description: `Cashback milestone reward for completing ${milestone.jobs} jobs`,
          referenceType: 'milestone_cashback',
          referenceId: `${userId}_milestone_${milestone.jobs}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 4. Log transaction in MySQL
        await pool.query(
          'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, status) VALUES (?, ?, ?, ?, ?, ?)',
          [mysqlWalletId, 'credit', cashback, `Milestone reward (${milestone.jobs} jobs)`, 'reward', 'completed']
        );

        // 5. Unlock Scratch Card in Firestore rewards collection
        const rewardRef = db.collection('rewards').doc();
        await rewardRef.set({
          userId: Number(userId),
          milestone: milestone.jobs,
          status: 'unlocked',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 6. Create Reward History in Firestore
        const historyRef = db.collection('reward_history').doc();
        await historyRef.set({
          userId: Number(userId),
          type: 'milestone_cashback',
          amount: cashback,
          voucherCode: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'credited'
        });

        // 7. Create notification in Firestore
        const notifRef = db.collection('notifications').doc();
        await notifRef.set({
          userId: Number(userId),
          title: 'Milestone Reward Unlocked! 🎁',
          body: `Congratulations! You reached ${milestone.jobs} completed jobs. ₹${cashback} cashback credited + 1 Scratch Card unlocked!`,
          type: 'scratch_card',
          isRead: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  } catch (error) {
    console.error('Error in checkMilestones:', error);
  }
};

/**
 * Scratch card reveal and reward processing
 */
exports.scratchCard = async (userId, rewardId) => {
  if (!db) throw new Error('Firestore unavailable - cannot process rewards');
  const rewardRef = db.collection('rewards').doc(rewardId);
  const rewardSnap = await rewardRef.get();

  if (!rewardSnap.exists) {
    throw new Error('Reward scratch card not found');
  }

  const reward = rewardSnap.data();
  if (reward.userId !== Number(userId)) {
    throw new Error('Unauthorized to scratch this card');
  }
  if (reward.status === 'scratched') {
    throw new Error('Card already scratched');
  }

  // Select random reward
  const won = SCRATCH_CARD_REWARDS[Math.floor(Math.random() * SCRATCH_CARD_REWARDS.length)];

  // Update card status
  await rewardRef.update({
    status: 'scratched',
    rewardType: won.type,
    amount: won.value || null,
    voucherCode: won.code || null,
    label: won.label,
    scratchedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  if (won.type === 'cashback') {
    // 1. Credit wallet in Firestore
    const walletRef = db.collection('wallets').doc(String(userId));
    await walletRef.set({
      balance: admin.firestore.FieldValue.increment(won.value),
      cashback_earned: admin.firestore.FieldValue.increment(won.value),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 2. Sync with MySQL wallet
    const [mysqlWallets] = await pool.query('SELECT id FROM wallets WHERE user_id = ?', [userId]);
    let mysqlWalletId;
    if (mysqlWallets.length > 0) {
      mysqlWalletId = mysqlWallets[0].id;
      await pool.query('UPDATE wallets SET balance = balance + ?, cashback_earned = COALESCE(cashback_earned, 0) + ? WHERE id = ?', [won.value, won.value, mysqlWalletId]);
    } else {
      const [newWallet] = await pool.query('INSERT INTO wallets (user_id, balance) VALUES (?, ?)', [userId, won.value]);
      mysqlWalletId = newWallet.insertId;
    }

    // 3. Log transaction in Firestore
    const txRef = db.collection('wallet_transactions').doc();
    await txRef.set({
      userId: Number(userId),
      type: 'credit',
      amount: won.value,
      description: `Scratch card cashback reward`,
      referenceType: 'scratch_card_cashback',
      referenceId: rewardId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4. Log transaction in MySQL
    await pool.query(
      'INSERT INTO transactions (wallet_id, type, amount, description, reference_type, status) VALUES (?, ?, ?, ?, ?, ?)',
      [mysqlWalletId, 'credit', won.value, 'Scratch card reward', 'reward', 'completed']
    );

    // 5. Create Reward History in Firestore
    const historyRef = db.collection('reward_history').doc();
    await historyRef.set({
      userId: Number(userId),
      type: 'scratch_card_cashback',
      amount: won.value,
      voucherCode: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'credited'
    });

    // 6. Create notification in Firestore
    const notifRef = db.collection('notifications').doc();
    await notifRef.set({
      userId: Number(userId),
      title: 'Cashback Credited! 💰',
      body: `Congratulations! ₹${won.value} cashback has been credited to your wallet.`,
      type: 'cashback',
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } else {
    // Voucher reward
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30); // 30 days expiry

    // 1. Save voucher in Firestore
    const voucherRef = db.collection('vouchers').doc();
    await voucherRef.set({
      userId: Number(userId),
      code: won.code,
      discountPercent: won.discount,
      expiryDate: expiryDate.toISOString(),
      status: 'active',
      description: won.label,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Create Reward History in Firestore
    const historyRef = db.collection('reward_history').doc();
    await historyRef.set({
      userId: Number(userId),
      type: 'scratch_card_voucher',
      amount: 0,
      voucherCode: won.code,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'saved'
    });

    // 3. Create notification in Firestore
    const notifRef = db.collection('notifications').doc();
    await notifRef.set({
      userId: Number(userId),
      title: 'Voucher Received! 🎫',
      body: `Congratulations! You received a ${won.label} (code: ${won.code}). Saved in My Vouchers.`,
      type: 'voucher',
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return won;
};
