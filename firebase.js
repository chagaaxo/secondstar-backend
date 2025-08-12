// firebase.js
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://secondstar-aeb60.firebaseio.com'
  });
}

const db = admin.firestore();

module.exports = { admin, db };
