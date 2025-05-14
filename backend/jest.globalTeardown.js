// backend/jest.globalTeardown.js
const admin = require('firebase-admin');

module.exports = async () => {
  // Delete all initialized apps
  await Promise.all(admin.apps.map(app => app.delete()));
  console.log('Jest Global Teardown: Firebase Apps Deleted.');
};