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
    tls: true,
    reconnectStrategy: (retries) => {
      if (retries > 20) {
        console.error('Redis max retries reached');
        return false;
      }
      return Math.min(retries * 200, 5000);
    },
    connectTimeout: 30000,
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
