import { nanoid } from 'nanoid';

type QuestionStatus = 'active' | 'intermission';

export type Winner = {
  userId: string;
  userName: string;
};

export type Question = {
  id: string;
  prompt: string;
  answer: number;
  createdAt: number;
  ttlMs: number;
  status: QuestionStatus;
  expiresAt: number;
  winner?: Winner | null;
};

export type SanitizedQuestion = {
  id: string;
  prompt: string;
  createdAt: number;
  expiresAt: number;
  status: QuestionStatus;
  serverNow: number;
  winner?: Winner | null;
};

type Operation = {
  symbol: string;
  fn: (a: number, b: number) => number;
};

const ops: Operation[] = [
  { symbol: '+', fn: (a, b) => a + b },
  { symbol: '-', fn: (a, b) => a - b },
  { symbol: '*', fn: (a, b) => a * b }
];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateQuestion(): Question {
  const a = randInt(2, 50);
  const b = randInt(2, 50);
  const op = ops[randInt(0, ops.length - 1)];
  const prompt = `${a} ${op.symbol} ${b}`;
  const answer = op.fn(a, b);
  const createdAt = Date.now();
  const ttlMs = 20000;

  return {
    id: nanoid(10),
    prompt,
    answer,
    createdAt,
    ttlMs,
    status: 'active',
    expiresAt: createdAt + ttlMs
  };
}

export function sanitizeQuestion(q: Question): SanitizedQuestion {
  const result: SanitizedQuestion = {
    id: q.id,
    prompt: q.prompt,
    createdAt: q.createdAt,
    expiresAt: q.expiresAt ?? q.createdAt + q.ttlMs,
    status: q.status || 'active',
    serverNow: Date.now()
  };
  if (q.winner) {
    result.winner = q.winner;
  }
  return result;
}
