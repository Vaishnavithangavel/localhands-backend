const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin');
const { authenticate, authorize } = require('../middleware/auth');

// All admin routes require admin role
router.use(authenticate, authorize('admin'));

// Users
router.get('/users', adminController.getUsers);
router.put('/users/:id/ban', adminController.banUser);
router.put('/users/:id/unban', adminController.unbanUser);
router.put('/users/:id/verify', adminController.verifyUser);

// Reports
router.get('/reports', adminController.getReports);
router.put('/reports/:id', adminController.resolveReport);

// Help Requests
router.delete('/help-requests/:id', adminController.removeHelpRequest);

// Analytics
router.get('/analytics', adminController.getAnalytics);
router.get('/analytics/district', adminController.getDistrictStats);

module.exports = router;
