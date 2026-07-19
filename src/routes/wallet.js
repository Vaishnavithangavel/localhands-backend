const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const walletController = require('../controllers/wallet');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.get('/', authenticate, walletController.getWallet);
router.get('/transactions', authenticate, walletController.getTransactions);

router.post('/add-upi', authenticate, [
  body('upi_id').notEmpty().withMessage('UPI ID required')
], validate, walletController.addUpi);

router.post('/add-bank', authenticate, [
  body('account_holder').notEmpty(),
  body('account_number').notEmpty(),
  body('ifsc').notEmpty()
], validate, walletController.addBank);

router.post('/withdraw', authenticate, [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum ₹100'),
  body('method').isIn(['upi', 'bank']).withMessage('Method must be UPI or bank')
], validate, walletController.withdraw);

module.exports = router;
