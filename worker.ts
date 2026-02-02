import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import { redis, pub, EVENTS_CHANNEL, QUEUE_NAME } from './redis.js';
import { generateQuestion, sanitizeQuestion } from './questions.js';
import { connectMongo } from './mongo.js';
import { User } from './models/User.js';
import { publishEvent } from './rabbit.js';

await connectMongo();

const queue = new Queue(QUEUE_NAME, { connection: redis });

async function publish(event: string, data: unknown) {
  await pub.publish(EVENTS_CHANNEL, JSON.stringify({ event, data }));
}

async function generateAndPublish(fromPrefetch = false) {
  if (fromPrefetch) {
    const prefetched = await redis.get('next:question');
    if (prefetched) {
      const parsed = JSON.parse(prefetched);
      const now = Date.now();
      const activated = {
        ...parsed,
        createdAt: now,
        expiresAt: now + parsed.ttlMs,
        status: 'active'
      };
      await redis.set('current:question', JSON.stringify(activated));
      await redis.del('next:question');
      await publish('question', sanitizeQuestion(activated));
      await queue.add('rotate-question', { questionId: activated.id }, { delay: activated.ttlMs });
      return;
    }
  }
  const prevRaw = await redis.get('current:question');
  if (prevRaw) {
    const prev = JSON.parse(prevRaw);
    await redis.del(
      `candidates:${prev.id}`,
      `winner:pending:${prev.id}`,
      `winner:${prev.id}`,
      `intermission:${prev.id}`,
      `next:question`
    );
  }

  const question = generateQuestion();
  await redis.set('current:question', JSON.stringify(question));

  await publish('question', sanitizeQuestion(question));
  await publishEvent('quiz.events', 'question.created', sanitizeQuestion(question));
  await queue.add('rotate-question', { questionId: question.id }, { delay: question.ttlMs });
}

async function startIntermission(questionId: string) {
  const currentRaw = await redis.get('current:question');
  if (!currentRaw) return;
  const current = JSON.parse(currentRaw);
  if (current.id !== questionId) return;

  const intermissionKey = `intermission:${questionId}`;
  const intermissionSet = await redis.set(intermissionKey, '1', 'NX');
  if (!intermissionSet) return;

  const intermissionMs = Number(process.env.INTERMISSION_MS || 5000);
  const now = Date.now();
  const winnerUserId = await redis.get(`winner:${questionId}`);
  const winnerName = winnerUserId
    ? await redis.hget('user:names', winnerUserId)
    : null;
  const intermission = {
    ...current,
    status: 'intermission',
    expiresAt: now + intermissionMs,
    winner: winnerUserId
      ? { userId: winnerUserId, userName: winnerName || winnerUserId.slice(0, 6) }
      : null
  };

  const nextQuestion = generateQuestion();
  await redis.set('next:question', JSON.stringify(nextQuestion));

  await redis.set('current:question', JSON.stringify(intermission));
  await publish('question', sanitizeQuestion(intermission));
  await queue.add('generate-question', { fromPrefetch: true }, { delay: intermissionMs });
}

const worker = new Worker(QUEUE_NAME, async job => {
  if (job.name === 'generate-question') {
    await generateAndPublish(job.data?.fromPrefetch);
  }

  if (job.name === 'finalize-winner') {
    const { questionId } = job.data || {};
    const currentRaw = await redis.get('current:question');
    if (!currentRaw) return;
    const current = JSON.parse(currentRaw);
    if (current.id !== questionId) return;

    const winnerKey = `winner:${questionId}`;
    const exists = await redis.get(winnerKey);
    if (exists) return;

    const candidatesKey = `candidates:${questionId}`;
    const top = await redis.zrange(candidatesKey, 0, 0);
    if (!top.length) return;

    const winner = JSON.parse(top[0]) as { userId: string; receivedAt: number };
    const set = await redis.set(winnerKey, winner.userId, 'NX');
    if (!set) return;

    await redis.zincrby('leaderboard', 1, winner.userId);

    await User.findOneAndUpdate(
      { userId: winner.userId },
      { $inc: { wins: 1 }, $set: { lastWinAt: new Date() } },
      { upsert: true, new: true }
    );

    const topScores = await redis.zrevrange('leaderboard', 0, 9, 'WITHSCORES');
    const leaderboard: { userId: string; wins: number; userName?: string }[] = [];
    for (let i = 0; i < topScores.length; i += 2) {
      leaderboard.push({ userId: topScores[i], wins: Number(topScores[i + 1]) });
    }
    if (leaderboard.length) {
      const names = await redis.hmget('user:names', ...leaderboard.map(item => item.userId));
      leaderboard.forEach((item, idx) => {
        item.userName = names[idx] || item.userId.slice(0, 6);
      });
    }

    const winnerName = await redis.hget('user:names', winner.userId);
    await publish('winner', { questionId, userId: winner.userId, userName: winnerName || winner.userId.slice(0, 6) });
    await publish('leaderboard', { items: leaderboard });
    await publishEvent('quiz.events', 'winner.declared', { questionId, userId: winner.userId });

    await startIntermission(questionId);
  }

  if (job.name === 'rotate-question') {
    const { questionId } = job.data || {};
    const currentRaw = await redis.get('current:question');
    if (!currentRaw) return;
    const current = JSON.parse(currentRaw);
    if (current.id !== questionId) return;
    if (current.status === 'intermission') return;

    const winnerKey = `winner:${questionId}`;
    const winner = await redis.get(winnerKey);
    if (winner) return;

    await startIntermission(questionId);
  }
}, { connection: redis });

worker.on('failed', (job, err) => {
  console.error('Job failed', job?.name, err);
});

console.log('Worker started');
