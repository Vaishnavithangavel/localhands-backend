const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ratingController = require('../controllers/rating');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.get('/', authenticate, ratingController.getAll);
router.get('/community', authenticate, ratingController.getCommunity);
router.get('/user/:userId', authenticate, ratingController.getUserRatings);

router.post('/', authenticate, [
  body('help_request_id').isInt().withMessage('Help request required'),
  body('to_user_id').isInt().withMessage('Target user required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5')
], validate, ratingController.create);

router.post('/community', authenticate, [
  body('to_user_id').isInt().withMessage('Target user required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5')
], validate, ratingController.createCommunity);

router.delete('/community/:id', authenticate, ratingController.deleteCommunity);

module.exports = router;
