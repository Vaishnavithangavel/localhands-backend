const express = require('express');
const router = express.Router();
const rewardsController = require('../controllers/rewards');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, rewardsController.getRewardsState);
router.get('/state', authenticate, rewardsController.getRewardsState);
router.post('/:id/scratch', authenticate, rewardsController.scratchCard);
router.get('/vouchers', authenticate, rewardsController.getVouchers);
router.get('/history', authenticate, rewardsController.getRewardHistory);

module.exports = router;
