const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload');
const { authenticate } = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');

router.post('/', authenticate, uploadMiddleware.single('image'), uploadController.uploadImage);

router.post('/multiple', authenticate, uploadMiddleware.array('images', 10), uploadController.uploadMultiple);

module.exports = router;
