const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const eventController = require('../controllers/event');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

router.get('/', authenticate, eventController.getAll);
router.get('/:id', authenticate, eventController.getById);
router.get('/:id/attendees', authenticate, eventController.getAttendees);

router.post('/', authenticate, [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('date').isDate().withMessage('Valid date required'),
  body('time').matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Valid time required')
], validate, eventController.create);

router.put('/:id', authenticate, eventController.update);
router.delete('/:id', authenticate, eventController.remove);
router.post('/:id/register', authenticate, eventController.register);
router.delete('/:id/register', authenticate, eventController.unregister);

module.exports = router;
