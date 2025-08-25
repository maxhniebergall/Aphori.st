import { RedisClient } from './RedisClient.js';
import { FirebaseClient } from './FirebaseClient.js';
import { LoggedDatabaseClient } from './LoggedDatabaseClient.js';
import logger from '../logger.js';
// No need to import the interface type in JS
// import { DatabaseClientInterface } from './DatabaseClientInterface.js';

// Singleton instance holder
let instance = null;
let themesInstance = null;

/**
 * Creates and returns a singleton instance of the database client (either Redis or Firebase),
 * wrapped with compression and logging layers.
 * Reads environment variables (DB_TYPE, FIREBASE_*, REDIS_*) to configure the client.
 * @returns {DatabaseClientInterface} The singleton database client instance.
 * @throws {Error} If required environment variables (e.g., FIREBASE_CREDENTIAL in production) are missing or invalid.
 *                 (Handled - By Design: Crashes app on start).
 */
export function createDatabaseClient() {
    // Return existing instance if it exists
    if (instance) {
        logger.debug('Returning existing database client instance.');
        return instance;
    }

    logger.info('Creating new database client instance...');

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
            logger.info({ emulatorUrl: firebaseConfig.databaseURL }, 'Configuring Firebase Database Emulator');
            // Set the env var for the SDK to auto-detect
            process.env.FIREBASE_DATABASE_EMULATOR_HOST = emulatorHost;
        } else {
            // Production connection logic (requires credentials)
            logger.info('Configuring production Firebase...');
            if (!process.env.FIREBASE_CREDENTIAL) {
                // Handled - By Design: Crashes app on start if essential Firebase config is missing.
                throw new Error('FIREBASE_CREDENTIAL environment variable is not set for production mode.');
            }
            try {
                 const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
                 firebaseConfig.credential = credential;
                 firebaseConfig.databaseURL = process.env.FIREBASE_DATABASE_URL;
                 logger.info({ databaseURL: firebaseConfig.databaseURL }, 'Using production Firebase Database');
            } catch (e) {
                 logger.error({ err: e }, "Failed to parse FIREBASE_CREDENTIAL");
                 // Handled - By Design: Crashes app on start if essential Firebase config is invalid.
                 throw new Error('FIREBASE_CREDENTIAL environment variable contains invalid JSON.');
            }
        }
        baseClient = new FirebaseClient(firebaseConfig);

    } else {
        // Default to Redis
        logger.info('Configuring Redis client...');
        const redisConfig = {
            url: `redis://${process.env.REDIS_SERVER_IP || 'localhost'}:${process.env.REDIS_PORT || 6379}`
        };
        logger.info({ redisUrl: redisConfig.url }, 'Using Redis database');
        baseClient = new RedisClient(redisConfig);
    }
    
    // Wrap the compressed client with logging
    const loggedClient = new LoggedDatabaseClient(baseClient, logger);

    // Store the fully wrapped instance
    instance = loggedClient;

    logger.info('Database client instance created and wrapped (Compression, Logging).');
    return instance;
}

/**
 * Creates and returns a singleton instance of the themes database client
 * Connects to aphorist-themes Firebase RTDB for themes game data
 */
export function createThemesDatabaseClient() {
    // Return existing instance if it exists
    if (themesInstance) {
        logger.debug('Returning existing themes database client instance.');
        return themesInstance;
    }

    logger.info('Creating new themes database client instance...');

    let baseClient;
    let firebaseConfig = {};

    // Check if running against the emulator
    if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
        // For emulator, use same database but different namespace
        const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
        firebaseConfig.databaseURL = `http://${emulatorHost}?ns=aphorist-themes`;
        logger.info({ emulatorUrl: firebaseConfig.databaseURL }, 'Configuring Themes Firebase Database Emulator');
        process.env.FIREBASE_DATABASE_EMULATOR_HOST = emulatorHost;
    } else {
        // Production connection to aphorist-themes database
        logger.info('Configuring production Firebase for themes...');
        if (!process.env.FIREBASE_CREDENTIAL) {
            throw new Error('FIREBASE_CREDENTIAL environment variable is not set for production mode.');
        }
        try {
            const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
            firebaseConfig.credential = credential;
            // Use themes-specific database URL
            firebaseConfig.databaseURL = process.env.THEMES_FIREBASE_DATABASE_URL || 
                'https://aphorist-themes-default-rtdb.firebaseio.com/?ns=aphorist-themes';
            logger.info({ databaseURL: firebaseConfig.databaseURL }, 'Using production Themes Firebase Database');
        } catch (e) {
            logger.error({ err: e }, "Failed to parse FIREBASE_CREDENTIAL for themes");
            throw new Error('FIREBASE_CREDENTIAL environment variable contains invalid JSON.');
        }
    }

    baseClient = new FirebaseClient(firebaseConfig);
    
    // Wrap with logging (themes doesn't need compression for now)
    const loggedClient = new LoggedDatabaseClient(baseClient, logger);

    // Store the themes instance
    themesInstance = loggedClient;

    logger.info('Themes database client instance created and wrapped (Logging).');
    return themesInstance;
}