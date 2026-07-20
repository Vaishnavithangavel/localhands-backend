const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Auto-initialize database tables on startup
const autoInitDb = require('./src/config/autoInitDb');
autoInitDb();

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // Relaxed for development/testing
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/auth', limiter);

// Static files
app.use('/uploads', express.static('uploads'));

// Make io accessible in route controllers
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
const authRoutes = require('./src/routes/auth');
app.use('/api/auth', authRoutes);

// Category routes
const categoryRoutes = require('./src/routes/categories');
app.use('/api/categories', categoryRoutes);

// Help request routes
const helpRequestRoutes = require('./src/routes/helpRequests');
app.use('/api/help-requests', helpRequestRoutes);

// Event routes
const eventRoutes = require('./src/routes/events');
app.use('/api/events', eventRoutes);

// Group routes
const groupRoutes = require('./src/routes/groups');
app.use('/api/groups', groupRoutes);

// Chat routes
const chatRoutes = require('./src/routes/chat');
app.use('/api/chat', chatRoutes);

// Wallet routes
const walletRoutes = require('./src/routes/wallet');
app.use('/api/wallet', walletRoutes);

// Rewards routes
const rewardsRoutes = require('./src/routes/rewards');
app.use('/api/rewards', rewardsRoutes);

// Payment routes (Razorpay)
const paymentRoutes = require('./src/routes/payments');
app.use('/api/payments', paymentRoutes);

// Rating routes
const ratingRoutes = require('./src/routes/ratings');
app.use('/api/ratings', ratingRoutes);

// Notification routes
const notificationRoutes = require('./src/routes/notifications');
app.use('/api/notifications', notificationRoutes);

// Upload routes
const uploadRoutes = require('./src/routes/upload');
app.use('/api/upload', uploadRoutes);

// Admin routes
const adminRoutes = require('./src/routes/admin');
app.use('/api/admin', adminRoutes);

// Firebase
require('./src/config/firebase');

// Socket.IO
const setupSocket = require('./src/socket/index');
setupSocket(io);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`LocalHands server running on port ${PORT}`);
});

module.exports = { app, server, io };
