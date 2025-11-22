import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL environment variable is required');
}

const redisClient = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        return new Error('Redis max reconnection attempts reached');
      }
      return Math.min(retries * 100, 3000);
    },
    connectTimeout: 10000,
  },
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('reconnecting', () => {
  console.log('Redis client reconnecting...');
});

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
};

export default redisClient;
