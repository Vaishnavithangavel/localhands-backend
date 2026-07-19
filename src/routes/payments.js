const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment');
const { authenticate } = require('../middleware/auth');

router.post('/create-order', authenticate, paymentController.createOrder);
router.post('/verify', authenticate, paymentController.verifyPayment);

module.exports = router;
