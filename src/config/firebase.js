const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let messaging = null;

try {
  let credential;

  // Support loading from JSON env var (for Railway/deployment) or from file
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(serviceAccount);
  } else {
    const serviceAccountPath = path.resolve(
      __dirname, '..', '..',
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json'
    );
    if (fs.existsSync(serviceAccountPath)) {
      credential = admin.credential.cert(serviceAccountPath);
    } else {
      throw new Error(`Service account file not found at ${serviceAccountPath}`);
    }
  }

  admin.initializeApp({ credential });
  messaging = admin.messaging();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.warn('Firebase initialization skipped:', error.message);
  console.warn('Firebase features (push notifications, Firestore) will be unavailable');
}

module.exports = { admin, messaging };