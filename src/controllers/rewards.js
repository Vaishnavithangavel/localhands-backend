const rewardService = require('../services/rewardService');
const { admin } = require('../config/firebase');
const pool = require('../config/db');
const statsService = require('../services/statsService');

// Helper: safely get Firestore db (may fail if not enabled)
let db = null;
try { db = admin.firestore(); } catch (_) {}

// Helper: safely run a Firestore operation with 3s timeout, returns null on any error
async function safeFirestore(fn) {
  if (!db) return null;
  try {
    return await Promise.race([
      fn(db),
      new Promise((_, reject) => setTimeout(() => reject(new Error('firestore_timeout')), 3000))
    ]);
  } catch (_) { return null; }
}

/**
 * Build wallet data from MySQL (always works, even when Firestore is down)
 */
async function buildWalletFromMySQL(userId) {
  const [compHelper] = await pool.query(
    "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status = 'completed'",
    [userId]
  );
  const [compRequester] = await pool.query(
    "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status IN ('completed', 'closed')",
    [userId]
  );
  const completedJobs = Number(compHelper[0]?.count || 0) + Number(compRequester[0]?.count || 0);

  const [actHelper] = await pool.query(
    "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status IN ('accepted','started_journey','arrived','work_started')",
    [userId]
  );
  const [actRequester] = await pool.query(
    "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status = 'in_progress'",
    [userId]
  );
  const activeJobs = Number(actHelper[0]?.count || 0) + Number(actRequester[0]?.count || 0);

  const [postedReq] = await pool.query(
    "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ?", [userId]
  );
  const [appliedReq] = await pool.query(
    "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ?", [userId]
  );
  const [eventsJ] = await pool.query(
    "SELECT COUNT(*) as count FROM event_registrations WHERE user_id = ?", [userId]
  );
  const [groupsJ] = await pool.query(
    "SELECT COUNT(*) as count FROM group_members WHERE user_id = ?", [userId]
  );
  const [ratingsRow] = await pool.query(
    "SELECT AVG(rating) as average, COUNT(*) as count FROM ratings WHERE to_user_id = ?", [userId]
  );

  const [mysqlWallets] = await pool.query(
    'SELECT balance, total_earned, cashback_earned, reward_coins FROM wallets WHERE user_id = ?',
    [userId]
  );
  const w = mysqlWallets[0] || {};

  return {
    userId: Number(userId),
    balance: Number(w.balance) || 0,
    total_earnings: Number(w.total_earned) || 0,
    cashback_earned: Number(w.cashback_earned) || 0,
    reward_coins: Number(w.reward_coins) || 0,
    completed_jobs: completedJobs,
    active_jobs: activeJobs,
    posted_requests: Number(postedReq[0]?.count || 0),
    applied_requests: Number(appliedReq[0]?.count || 0),
    events_joined: Number(eventsJ[0]?.count || 0),
    groups_joined: Number(groupsJ[0]?.count || 0),
    rating_average: Number(ratingsRow[0]?.average) || 0,
    rating_count: Number(ratingsRow[0]?.count) || 0,
  };
}

exports.getRewardsState = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Try to get wallet from Firestore; fall back to MySQL silently
    let walletData = await safeFirestore(async (fdb) => {
      const walletRef = fdb.collection('wallets').doc(String(userId));
      const walletSnap = await walletRef.get();
      if (walletSnap.exists) return walletSnap.data();
      return null;
    });

    // Always rebuild from MySQL if Firestore is unavailable or doc missing
    if (!walletData) {
      walletData = await buildWalletFromMySQL(userId);
      // Try to persist to Firestore (best-effort, never blocks the response)
      safeFirestore(async (fdb) => {
        await fdb.collection('wallets').doc(String(userId)).set(
          { ...walletData, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      });
    }

    // Get scratch cards from Firestore (best-effort)
    const scratchCards = await safeFirestore(async (fdb) => {
      const rewardsSnap = await fdb.collection('rewards')
        .where('userId', '==', Number(userId))
        .where('status', '==', 'unlocked')
        .get();
      const cards = [];
      rewardsSnap.forEach(doc => cards.push({ id: doc.id, ...doc.data() }));
      cards.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      return cards;
    }) || [];

    res.json({ wallet: walletData, scratchCards });
  } catch (error) {
    next(error);
  }
};

exports.scratchCard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const rewardId = req.params.id;

    const reward = await rewardService.scratchCard(userId, rewardId);

    // Sync stats (best-effort)
    statsService.syncUserStatsToFirestore(userId).catch(() => {});

    res.json({ message: 'Card scratched successfully', reward });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getVouchers = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const vouchers = await safeFirestore(async (fdb) => {
      const snap = await fdb.collection('vouchers')
        .where('userId', '==', Number(userId))
        .get();
      const list = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      return list;
    }) || [];

    res.json(vouchers);
  } catch (error) {
    next(error);
  }
};

exports.getRewardHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const history = await safeFirestore(async (fdb) => {
      const snap = await fdb.collection('reward_history')
        .where('userId', '==', Number(userId))
        .get();
      const list = [];
      snap.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      return list;
    }) || [];

    res.json(history);
  } catch (error) {
    next(error);
  }
};
