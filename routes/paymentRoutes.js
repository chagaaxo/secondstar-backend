const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Create Midtrans transaction
router.post('/midtrans-transaction', paymentController.createMidtransTransaction);

// Handle Midtrans payment notification
router.post('/midtrans-notification', paymentController.handleMidtransNotification);

// Check payment status
router.get('/status/:orderId', paymentController.checkPaymentStatus);

router.get('/debug/order/:orderId', async (req, res) => {
  try {
    const order = await db.collection('orders').doc(req.params.orderId).get();
    if (!order.exists) return res.status(404).send('Not found');
    res.json(order.data());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/debug/midtrans-status/:orderId', async (req, res) => {
  try {
    const status = await snap.transaction.status(req.params.orderId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;