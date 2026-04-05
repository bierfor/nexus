import mongoose from 'mongoose';

export async function connectDb(): Promise<void> {
  const uri =
    process.env['MONGODB_URI'] ??
    process.env['DATABASE_URL'] ??
    'mongodb://127.0.0.1:27017/finsh';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[fin-sh-api] MongoDB connected');
}
