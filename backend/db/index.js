import { RedisClient } from './RedisClient.js';
import { FirebaseClient } from './FirebaseClient.js';
import { CompressedDatabaseClient } from './CompressedDatabaseClient.js';
import { DatabaseCompression } from './DatabaseCompression.js';

export function createDatabaseClient() {
    // Create compression layer with default settings
    const compression = new DatabaseCompression();

    // Create the base client based on DB_TYPE
    let baseClient;
    if (process.env.DB_TYPE === 'firebase') {
        // Parse the credential string into an object
        const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
        
        const firebaseConfig = {
            credential: credential,
            databaseURL: process.env.FIREBASE_DATABASE_URL
        };
        baseClient = new FirebaseClient(firebaseConfig);
    } else {
        // Default to Redis
        const redisConfig = {
            url: `redis://${process.env.REDIS_SERVER_IP || 'localhost'}:${process.env.REDIS_PORT || 6379}`
        };
        baseClient = new RedisClient(redisConfig);
    }
    
    // Wrap the base client with compression
    return new CompressedDatabaseClient(baseClient, compression);
} 