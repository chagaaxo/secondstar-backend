const express = require('express');
const router = express.Router();
const { db } = require('../firebase'); 

// Get all orders
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.uid; // Assuming you have user auth middleware
    let query = db.collection('orders').orderBy('createdAt', 'desc');
    
    if (userId) {
      query = query.where('customer.uid', '==', userId);
    }

    const ordersSnapshot = await query.get();

    const orders = ordersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate().toISOString(),
        updatedAt: data.updatedAt?.toDate().toISOString(),
        paidAt: data.paidAt?.toDate().toISOString()
      };
    });

    res.json(orders);
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Get single order
router.get('/:orderId', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const doc = await db.collection('orders').doc(orderId).get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const data = doc.data();
    res.json({
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate().toISOString(),
      updatedAt: data.updatedAt?.toDate().toISOString(),
      paidAt: data.paidAt?.toDate().toISOString()
    });
  } catch (error) {
    console.error('Failed to fetch order:', error);
    res.status(500).json({ message: 'Failed to fetch order' });
  }
});

router.post('/orders/mark-sold', async (req, res) => {
  try {
    const { orderId, items } = req.body;
    
    // Update each product's stock
    await Promise.all(items.map(async item => {
      await Product.findByIdAndUpdate(item.productId, { 
        $inc: { stock: -item.quantity },
        $set: { lastSold: new Date() }
      });
    }));
    
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;