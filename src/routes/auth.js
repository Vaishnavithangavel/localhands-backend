const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.post('/register', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[A-Z])(?=.*\d)/).withMessage('Password must be 8+ chars with 1 uppercase and 1 number'),
  body('name').trim().notEmpty().withMessage('Name is required')
], validate, authController.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], validate, authController.login);

router.post('/refresh-token', [
  body('refreshToken').notEmpty().withMessage('Refresh token required')
], validate, authController.refreshToken);

router.get('/me', authenticate, authController.getMe);
router.get('/profile-stats', authenticate, authController.getProfileStats);

router.put('/profile', authenticate, authController.updateProfile);

router.post('/logout', authController.logout);
router.delete('/account', authenticate, authController.deleteAccount);

module.exports = router;
