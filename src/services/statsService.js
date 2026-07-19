const pool = require('../config/db');
const { admin } = require('../config/firebase');
let db = null;
try { db = admin.firestore(); } catch (_) {}

/**
 * Calculates all MySQL statistics for a user and writes them to the Firestore 'wallets' document.
 * This includes completed jobs, active jobs, posted/applied requests, events/groups joined,
 * wallet balance, total earnings, cashback, reward coins, and ratings.
 */
exports.syncUserStatsToFirestore = async (userId) => {
  try {
    if (!userId) return;

    // 1. Fetch completed jobs (as helper or requester)
    const [compHelper] = await pool.query(
      "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status = 'completed'",
      [userId]
    );
    const [compRequester] = await pool.query(
      "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status IN ('completed', 'closed')",
      [userId]
    );
    const completedJobs = (compHelper[0]?.count || 0) + (compRequester[0]?.count || 0);

    // 2. Fetch active jobs (in progress help requests as creator, or in progress applications as helper)
    const [actHelper] = await pool.query(
      "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ? AND status IN ('accepted', 'started_journey', 'arrived', 'work_started')",
      [userId]
    );
    const [actRequester] = await pool.query(
      "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ? AND status = 'in_progress'",
      [userId]
    );
    const activeJobs = (actHelper[0]?.count || 0) + (actRequester[0]?.count || 0);

    // 3. Fetch posted help requests
    const [postedReq] = await pool.query(
      "SELECT COUNT(*) as count FROM help_requests WHERE user_id = ?",
      [userId]
    );
    const postedRequests = postedReq[0]?.count || 0;

    // 4. Fetch applied help requests
    const [appliedReq] = await pool.query(
      "SELECT COUNT(*) as count FROM help_request_applications WHERE user_id = ?",
      [userId]
    );
    const appliedRequests = appliedReq[0]?.count || 0;

    // 5. Fetch events joined
    const [eventsJ] = await pool.query(
      "SELECT COUNT(*) as count FROM event_registrations WHERE user_id = ?",
      [userId]
    );
    const eventsJoined = eventsJ[0]?.count || 0;

    // 6. Fetch groups joined
    const [groupsJ] = await pool.query(
      "SELECT COUNT(*) as count FROM group_members WHERE user_id = ?",
      [userId]
    );
    const groupsJoined = groupsJ[0]?.count || 0;

    // 7. Wallet info & total earnings from MySQL wallets
    const [walletRows] = await pool.query(
      "SELECT balance, total_earned, cashback_earned, reward_coins FROM wallets WHERE user_id = ?",
      [userId]
    );
    const walletBalance = walletRows.length > 0 ? Number(walletRows[0].balance) : 0;
    const totalEarnings = walletRows.length > 0 ? Number(walletRows[0].total_earned || 0) : 0;
    const cashbackEarned = walletRows.length > 0 ? Number(walletRows[0].cashback_earned || 0) : 0;
    const rewardCoins = walletRows.length > 0 ? Number(walletRows[0].reward_coins || 0) : 0;

    // 8. Fetch ratings
    const [ratingsRow] = await pool.query(
      "SELECT AVG(rating) as average, COUNT(*) as count FROM ratings WHERE to_user_id = ?",
      [userId]
    );
    const ratingAverage = Number(ratingsRow[0]?.average) || 0;
    const ratingCount = Number(ratingsRow[0]?.count) || 0;

    // 9. Write to Firestore 'wallets' document (best-effort, skipped if Firestore disabled)
    const updatedData = {
      userId: Number(userId),
      balance: walletBalance,
      total_earnings: totalEarnings,
      cashback_earned: cashbackEarned,
      reward_coins: rewardCoins,
      completed_jobs: completedJobs,
      active_jobs: activeJobs,
      posted_requests: postedRequests,
      applied_requests: appliedRequests,
      events_joined: eventsJoined,
      groups_joined: groupsJoined,
      rating_average: ratingAverage,
      rating_count: ratingCount,
      updatedAt: db ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
    };

    if (db) {
      const walletRef = db.collection('wallets').doc(String(userId));
      walletRef.set(updatedData, { merge: true }).catch(() => {});
    }

  } catch (error) {
    console.error(`Error syncing user stats to Firestore for user ${userId}:`, error);
  }
};
