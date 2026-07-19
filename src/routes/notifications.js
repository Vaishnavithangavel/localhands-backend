const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, notificationController.getAll);
router.put('/:id/read', authenticate, notificationController.markAsRead);
router.put('/read-all', authenticate, notificationController.markAllAsRead);

module.exports = router;
