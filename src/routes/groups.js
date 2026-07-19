const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const groupController = require('../controllers/group');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.get('/', authenticate, groupController.getAll);
router.get('/my', authenticate, groupController.getMyGroups);
router.get('/:id', authenticate, groupController.getById);
router.get('/:id/members', authenticate, groupController.getMembers);
router.get('/:id/announcements', authenticate, groupController.getAnnouncements);

router.post('/', authenticate, [
  body('name').trim().notEmpty().withMessage('Name required')
], validate, groupController.create);

router.post('/:id/join', authenticate, groupController.join);
router.post('/:id/leave', authenticate, groupController.leave);
router.post('/:id/announcements', authenticate, [
  body('title').trim().notEmpty().withMessage('Title required')
], validate, groupController.createAnnouncement);

router.put('/:id', authenticate, groupController.update);
router.delete('/:id', authenticate, groupController.remove);

module.exports = router;
