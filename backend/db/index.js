import { RedisClient } from './RedisClient.js';
import { FirebaseClient } from './FirebaseClient.js';
import { CompressedDatabaseClient } from './CompressedDatabaseClient.js';
import { DatabaseCompression } from './DatabaseCompression.js';
// No need to import the interface type in JS
// import { DatabaseClientInterface } from './DatabaseClientInterface.js';

// Singleton instance holder
let instance = null;

export function createDatabaseClient() {
    // Return existing instance if it exists
    if (instance) {
        console.log('Returning existing database client instance.');
        return instance;
    }

    console.log('Creating new database client instance...');

    // Create compression layer with default settings
    const compression = new DatabaseCompression();

    // Create the base client based on DB_TYPE
    let baseClient;
    if (process.env.DB_TYPE === 'firebase') {
        let firebaseConfig = {}; // Use plain object

        // Check if running against the emulator
        if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
            // Emulator connection logic (no credentials needed)
            const projectId = process.env.GCLOUD_PROJECT || 'your-default-project-id';
            const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
            firebaseConfig.databaseURL = `http://${emulatorHost}?ns=${projectId}`;
            console.log(`Configuring Firebase Database Emulator at: ${firebaseConfig.databaseURL}`);
            // Set the env var for the SDK to auto-detect
            process.env.FIREBASE_DATABASE_EMULATOR_HOST = emulatorHost;
        } else {
            // Production connection logic (requires credentials)
            console.log('Configuring production Firebase...');
            if (!process.env.FIREBASE_CREDENTIAL) {
                throw new Error('FIREBASE_CREDENTIAL environment variable is not set for production mode.');
            }
            try {
                 const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
                 firebaseConfig.credential = credential;
                 firebaseConfig.databaseURL = process.env.FIREBASE_DATABASE_URL;
                 console.log(`Using production Firebase Database at: ${firebaseConfig.databaseURL}`);
            } catch (e) {
                 console.error("Failed to parse FIREBASE_CREDENTIAL:", e);
                 throw new Error('FIREBASE_CREDENTIAL environment variable contains invalid JSON.');
            }
        }
        baseClient = new FirebaseClient(firebaseConfig);

    } else {
        // Default to Redis
        console.log('Configuring Redis client...');
        const redisConfig = {
            url: `redis://${process.env.REDIS_SERVER_IP || 'localhost'}:${process.env.REDIS_PORT || 6379}`
        };
        baseClient = new RedisClient(redisConfig);
    }
    
    // Wrap the base client with compression
    const compressedClient = new CompressedDatabaseClient(baseClient, compression);

    // Store the new instance
    instance = compressedClient;

    return instance;
} 