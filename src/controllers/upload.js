const cloudinary = require('../config/cloudinary');
const fs = require('fs');

const cleanup = (filePath) => {
  try { fs.unlinkSync(filePath); } catch (_) {}
};

exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'localhands',
      resource_type: 'auto',
      timeout: 120000
    });

    cleanup(req.file.path);

    res.json({
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height
    });
  } catch (error) {
    if (req.file) cleanup(req.file.path);
    res.status(500).json({
      error: 'Upload failed. Make sure Cloudinary is configured on the server.',
      detail: error.message
    });
  }
};

exports.uploadMultiple = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploads = [];
    for (const file of req.files) {
      try {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'localhands',
          resource_type: 'auto',
          timeout: 120000
        });
        uploads.push({ url: result.secure_url, public_id: result.public_id });
      } catch (_) {
        uploads.push({ url: '', public_id: '' });
      }
      cleanup(file.path);
    }

    res.json({ images: uploads.filter(u => u.url) });
  } catch (error) {
    if (req.files) req.files.forEach(f => cleanup(f.path));
    res.status(500).json({
      error: 'Upload failed. Make sure Cloudinary is configured on the server.',
      detail: error.message
    });
  }
};
