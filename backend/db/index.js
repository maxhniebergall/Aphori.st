import { RedisClient } from './RedisClient.js';
import { FirebaseClient } from './FirebaseClient.js';

export function createDatabaseClient() {
  if (process.env.NODE_ENV === 'production') {
    // Firebase configuration
    const firebaseConfig = {
      credential: process.env.FIREBASE_CREDENTIAL,
      databaseURL: process.env.FIREBASE_DATABASE_URL
    };
    return new FirebaseClient(firebaseConfig);
  } else {
    // Redis configuration
    const redisConfig = {
      url: `redis://${process.env.REDIS_SERVER_IP}:${process.env.REDIS_PORT || 6379}`
    };
    return new RedisClient(redisConfig);
  }
} 