import mongoose from 'mongoose';

const mongoUri = process.env.MONGO_URI || '';

let connected = false;

export async function connectMongo() {
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }
  if (connected) return;
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000
  });
  connected = true;
}
