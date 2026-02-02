import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  wins: { type: Number, default: 0 },
  lastWinAt: { type: Date }
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
