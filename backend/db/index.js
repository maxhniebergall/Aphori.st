import { RedisClient } from './RedisClient.js';
import { FirebaseClient } from './FirebaseClient.js';

export function createDatabaseClient() {
  // Use Firebase if DB_TYPE is set to 'firebase'
  if (process.env.DB_TYPE === 'firebase') {
    // Parse the credential string into an object
    const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
    
    const firebaseConfig = {
      credential: credential,
      databaseURL: process.env.FIREBASE_DATABASE_URL
    };
    return new FirebaseClient(firebaseConfig);
  } else {
    // Default to Redis
    const redisConfig = {
      url: `redis://${process.env.REDIS_SERVER_IP || 'localhost'}:${process.env.REDIS_PORT || 6379}`
    };
    return new RedisClient(redisConfig);
  }
} 