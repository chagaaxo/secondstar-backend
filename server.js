require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { db } = require('./firebase'); // Firestore initialization
const paymentRoutes = require('./routes/paymentRoutes');
const orderRoutes = require('./routes/orderRoutes');
const admin = require('firebase-admin');

const app = express();

// CORS settings (adjust for production)
const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// API routes
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);

// Error handler (last middleware)
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Server start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = { db, admin };