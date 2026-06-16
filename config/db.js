const mongoose = require('mongoose');

const connectDB = async () => {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = process.env.MONGODB_URI_LOCAL || 'mongodb://127.0.0.1:27017/yumyum';
  const connectionUris = [];

  if (primaryUri) {
    connectionUris.push(primaryUri);
  }

  if (process.env.NODE_ENV !== 'production' && fallbackUri && !connectionUris.includes(fallbackUri)) {
    connectionUris.push(fallbackUri);
  }

  let lastError = null;

  try {
    for (const uri of connectionUris) {
      try {
        const conn = await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 5000
        });

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        return conn;
      } catch (error) {
        lastError = error;
        console.error(`❌ MongoDB Connection Error for ${uri}: ${error.message}`);
      }
    }
  } catch (error) {
    lastError = error;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ MongoDB Connection Error: ${lastError?.message || 'Unable to connect to database'}`);
    process.exit(1);
  }

  console.warn('⚠️ MongoDB is unavailable in development. Auth will use demo fallback users until the database is reachable.');
  return null;
};

connectDB.isConnected = () => mongoose.connection.readyState === 1;

module.exports = connectDB;
