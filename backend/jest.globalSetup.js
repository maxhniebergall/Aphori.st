// backend/jest.globalSetup.js
const admin = require('firebase-admin'); // Use require for CJS compatibility in Jest global setup

module.exports = async () => {
  // Ensure the emulator host is set (you might have already done this via .env or package.json script)
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
    console.log('Jest Global Setup: Set FIREBASE_DATABASE_EMULATOR_HOST to localhost:9000');
  }

  // Initialize a single default app for all tests if no apps exist yet
  if (admin.apps.length === 0) {
    admin.initializeApp({
      // Minimal config needed when using emulators;
      // environment variables like FIREBASE_DATABASE_EMULATOR_HOST handle the connection.
      // You might need to provide a databaseURL if your emulator isn't automatically picked up.
      // databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=your-project-id-for-emulator`
      // The Project ID here is usually the one configured for your emulators, often a demo project ID.
    });
    console.log('Jest Global Setup: Default Firebase App Initialized.');
  } else {
    console.log('Jest Global Setup: Default Firebase App already exists.');
  }
};