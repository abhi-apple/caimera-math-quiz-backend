import 'dotenv/config';
import express, { type Response } from 'express';
import cors from 'cors';
import { Queue } from 'bullmq';
import { redis, sub, pub, EVENTS_CHANNEL, QUEUE_NAME } from './redis.js';
import { sanitizeQuestion } from './questions.js';
import { connectMongo } from './mongo.js';
import { User } from './models/User.js';

const app = express();
app.use(cors());
app.use(express.json());

const queue = new Queue(QUEUE_NAME, { connection: redis });

const clients = new Map<number, Response>();
let clientIdSeq = 1;
let activeClients = 0;

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients.values()) {
    res.write(payload);
  }
}

sub.subscribe(EVENTS_CHANNEL);
sub.on('message', (_channel: string, message: string) => {
  try {
    const { event, data } = JSON.parse(message);
    broadcast(event, data);
  } catch (err) {
    // Ignore malformed events
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/question', async (_req, res) => {
  const current = await redis.get('current:question');
  if (!current) {
    return res.status(404).json({ error: 'no_active_question' });
  }
  const question = JSON.parse(current);
  res.json(sanitizeQuestion(question));
});

app.post('/users/register', async (req, res) => {
  const { userId, name } = req.body || {};
  if (!userId || !name) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  await redis.hset('user:names', userId, name);
  await User.findOneAndUpdate(
    { userId },
    { $set: { name } },
    { upsert: true, new: true }
  );
  res.json({ ok: true });
});

app.post('/submit', async (req, res) => {
  const { questionId, answer, userId } = req.body || {};
  if (!questionId || !userId || answer === undefined) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const currentRaw = await redis.get('current:question');
  if (!currentRaw) {
    return res.status(409).json({ error: 'no_active_question' });
  }
  const current = JSON.parse(currentRaw);

  if (current.id !== questionId) {
    return res.status(409).json({ error: 'stale_question' });
  }
  if (current.status !== 'active') {
    return res.status(409).json({ error: 'question_intermission' });
  }
  const lateMs = Number(process.env.LATE_MS || 0);
  if (Date.now() > current.expiresAt + lateMs) {
    return res.status(409).json({ error: 'question_expired' });
  }

  const parsedAnswer = Number(answer);
  if (!Number.isFinite(parsedAnswer)) {
    return res.status(400).json({ error: 'invalid_answer' });
  }

  if (parsedAnswer !== current.answer) {
    return res.json({ status: 'incorrect' });
  }

  const idKey = `submitted:${questionId}:${userId}`;
  const isFirstSubmit = await redis.set(idKey, '1', 'PX', 60000, 'NX');
  if (!isFirstSubmit) {
    return res.json({ status: 'duplicate' });
  }

  const now = Date.now();
  const candidatesKey = `candidates:${questionId}`;
  const pendingKey = `winner:pending:${questionId}`;
  const graceMs = Number(process.env.GRACE_MS || 250);

  await redis.zadd(candidatesKey, now, JSON.stringify({ userId, receivedAt: now }));
  const pending = await redis.set(pendingKey, '1', 'PX', graceMs, 'NX');
  if (pending) {
    await queue.add('finalize-winner', { questionId }, { delay: graceMs });
  }

  res.json({ status: 'correct_pending' });
});

app.get('/leaderboard', async (_req, res) => {
  const top = await redis.zrevrange('leaderboard', 0, 9, 'WITHSCORES');
  const items: { userId: string; wins: number; userName?: string }[] = [];
  for (let i = 0; i < top.length; i += 2) {
    items.push({ userId: top[i], wins: Number(top[i + 1]) });
  }
  if (items.length) {
    const names = await redis.hmget('user:names', ...items.map(item => item.userId));
    items.forEach((item, idx) => {
      item.userName = names[idx] || item.userId.slice(0, 6);
    });
  }
  res.json({ items });
});

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write('retry: 1000\n\n');
  res.write(': connected\n\n');

  const clientId = clientIdSeq++;
  clients.set(clientId, res);
  activeClients += 1;
  broadcast('presence', { count: activeClients });

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(clientId);
    activeClients = Math.max(0, activeClients - 1);
    broadcast('presence', { count: activeClients });
  });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, async () => {
  await connectMongo();
  const current = await redis.get('current:question');
  if (!current) {
    await queue.add('generate-question', {});
  }
  await pub.publish(EVENTS_CHANNEL, JSON.stringify({
    event: 'server',
    data: { status: 'up', port }
  }));
  console.log(`Backend listening on ${port}`);
});
