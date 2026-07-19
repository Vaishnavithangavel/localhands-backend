const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const helpRequestController = require('../controllers/helpRequest');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// Public (requires auth)
router.get('/nearby', authenticate, helpRequestController.getNearby);
router.get('/', authenticate, helpRequestController.getAll);
router.get('/saved', authenticate, helpRequestController.getSaved);
router.get('/my-accepted', authenticate, helpRequestController.getMyAccepted);
router.get('/tracking/:id', authenticate, helpRequestController.getTracking);
router.get('/:id', authenticate, helpRequestController.getById);

router.post('/', authenticate, [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('category_id').isInt().withMessage('Category required'),
  body('type').isIn(['paid', 'free', 'emergency']).withMessage('Valid type required')
], validate, helpRequestController.create);

router.put('/:id', authenticate, helpRequestController.update);
router.delete('/:id', authenticate, helpRequestController.remove);
router.post('/:id/apply', authenticate, helpRequestController.apply);
router.post('/:id/accept', authenticate, helpRequestController.acceptApplicant);
router.post('/:id/reject', authenticate, helpRequestController.rejectApplicant);
router.post('/:id/complete', authenticate, helpRequestController.complete);
router.post('/:id/pay', authenticate, helpRequestController.pay);
router.post('/:id/start-journey', authenticate, helpRequestController.startJourney);
router.post('/:id/arrived', authenticate, helpRequestController.arrived);
router.post('/:id/work-started', authenticate, helpRequestController.startWork);
router.post('/:id/navigation-stop', authenticate, helpRequestController.stopNavigation);
router.post('/:id/cancel', authenticate, helpRequestController.cancel);
router.post('/:id/save', authenticate, helpRequestController.save);
router.post('/:id/share', authenticate, helpRequestController.share);

module.exports = router;
