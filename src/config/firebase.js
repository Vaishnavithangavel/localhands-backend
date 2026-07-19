const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.resolve(
  __dirname, '..', '..',
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json'
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

const messaging = admin.messaging();

module.exports = { admin, messaging };