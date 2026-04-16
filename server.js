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
  reportRoutes
} = require('./routes');

// Connect to database
connectDB();

const app = express();

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CLIENT_URL 
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

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
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});

module.exports = app;
