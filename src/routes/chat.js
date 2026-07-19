const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const chatController = require('../controllers/chat');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.get('/conversations', authenticate, chatController.getConversations);
router.get('/active-request/:userId', authenticate, chatController.getActiveRequest);
router.get('/users', authenticate, chatController.getAllUsers);
router.get('/all-groups', authenticate, chatController.getAllGroups);
router.get('/messages/:userId', authenticate, chatController.getMessages);
router.get('/group-messages/:groupId', authenticate, chatController.getGroupMessages);
router.get('/event-messages/:eventId', authenticate, chatController.getEventMessages);

router.post('/messages', authenticate, [
  body('receiver_id').isInt().withMessage('Receiver required')
], validate, chatController.sendMessage);

router.post('/group-messages', authenticate, [
  body('group_id').isInt().withMessage('Group required')
], validate, chatController.sendGroupMessage);

router.post('/event-messages', authenticate, [
  body('event_id').isInt().withMessage('Event required')
], validate, chatController.sendEventMessage);

router.put('/read/:senderId', authenticate, chatController.markAsRead);

module.exports = router;
