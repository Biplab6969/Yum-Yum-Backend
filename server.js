require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware');
const {
  authRoutes,
  shopRoutes,
  itemRoutes,
  productionRoutes,
  transactionRoutes,
  reportRoutes,
  wholesaleRoutes
} = require('./routes');
const { initWholesaleReminderJob } = require('./jobs/wholesaleReminderJob');
const { initializeWhatsAppSocket } = require('./services/wholesaleNotificationService');

// Connect to database
connectDB();

const app = express();

// Disable ETag generation for API responses to avoid 304 Not Modified
app.set('etag', false);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS
// Configure CORS: allow production client URL, and allow any localhost origin during development
app.use(cors({
  origin: (origin, callback) => {
    if (process.env.NODE_ENV === 'production') {
      return callback(null, process.env.CLIENT_URL);
    }

    // Allow requests with no origin (e.g., curl, server-to-server)
    if (!origin) return callback(null, true);

    // Allow any localhost origin (any port) during development
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Otherwise reject
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Prevent caching for API responses (avoid 304 with empty bodies for axios)
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Yum Yum API is running',
    timestamp: new Date().toISOString()
  });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/wholesale', wholesaleRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🍜 Yum Yum Food Business Management API                 ║
  ║                                                           ║
  ║   Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}       ║
  ║                                                           ║
  ║   API URL: http://localhost:${PORT}/api                      ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);

  // Start scheduled pending reminder job for wholesale users.
  initWholesaleReminderJob();

  initializeWhatsAppSocket().catch((error) => {
    console.error('WhatsApp session startup failed:', error.message);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});

module.exports = app;
