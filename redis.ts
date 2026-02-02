import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST;
const redisPort = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined;
const redisUsername = process.env.REDIS_USERNAME;
const redisPassword = process.env.REDIS_PASSWORD;
const redisTls = process.env.REDIS_TLS === 'true';

const redisOptions = redisUrl
  ? redisUrl
  : {
      host: redisHost || '127.0.0.1',
      port: redisPort || 6379,
      username: redisUsername,
      password: redisPassword,
      tls: redisTls ? {} : undefined
    };

const sharedOptions = {
  maxRetriesPerRequest: null
};

export const redis = new Redis(redisOptions as any, sharedOptions);
export const pub = new Redis(redisOptions as any, sharedOptions);
export const sub = new Redis(redisOptions as any, sharedOptions);

export const QUEUE_NAME = 'quiz';
export const EVENTS_CHANNEL = 'quiz:events';
