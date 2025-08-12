const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const db = admin.firestore();

// Initialize Midtrans client with enhanced configuration
const isProduction = process.env.MIDTRANS_ENVIRONMENT === 'production';
const snap = new midtransClient.Snap({
  isProduction,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
  // Added timeout configuration
  requestOptions: {
    timeout: 10000
  }
});

// Status mapping with detailed cases
const STATUS_MAPPING = {
  'capture': {
    'accept': 'completed',
    'challenge': 'pending',
    'deny': 'failed'
  },
  'settlement': 'completed',
  'pending': 'pending',
  'deny': 'failed',
  'cancel': 'failed',
  'expire': 'failed',
  'refund': 'refunded',
  'partial_refund': 'partially_refunded'
};

// Enhanced transaction creation
exports.createMidtransTransaction = async (req, res) => {
  try {
    const { customer_details, item_details, transaction_details } = req.body;
    
    // Enhanced validation
    if (!customer_details || !item_details || !transaction_details) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          required: ['customer_details', 'item_details', 'transaction_details'],
          received: Object.keys(req.body)
        }
      });
    }

    // Generate order ID with better format
    const orderId = transaction_details.order_id || `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    transaction_details.order_id = orderId;

    // Create order document with enhanced structure
    const orderData = {
      orderId,
      orderNumber: orderId,
      customer: {
        ...customer_details,
        fullName: `${customer_details.first_name} ${customer_details.last_name}`.trim()
      },
      items: item_details.filter(item => item.id !== 'SHIPPING').map(item => ({
        ...item,
        totalPrice: item.price * item.quantity
      })),
      shipping: {
        fee: item_details.find(item => item.id === 'SHIPPING')?.price || 0,
        address: customer_details.shipping_address
      },
      payment: {
        method: req.body.payment_type || 'unknown',
        amount: transaction_details.gross_amount,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      midtrans: {
        orderId,
        status: 'pending'
      }
    };

    // Create the order document in Firestore first
    const orderRef = db.collection('orders').doc(orderId);
    await orderRef.set(orderData);

    // Create Midtrans transaction with error handling
    const transaction = await snap.createTransaction(req.body);

    // Enhanced payment data update
    const paymentData = {
      ...transaction,
      paymentUrl: transaction.redirect_url || null,
      lastChecked: admin.firestore.FieldValue.serverTimestamp()
    };

    await orderRef.update({
      'payment.data': paymentData,
      'midtrans.transaction': transaction
    });

    // Add initial status history
    await orderRef.collection('statusHistory').add({
      status: 'pending',
      type: 'initial',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      data: {
        request: req.body,
        response: transaction
      }
    });

    res.status(200).json({
      success: true,
      orderId,
      paymentData: transaction
    });
  } catch (error) {
    console.error('Transaction creation error:', error);
    res.status(500).json({ 
      success: false,
      error: 'TRANSACTION_CREATION_FAILED',
      message: error.message,
      details: error.response?.data || null
    });
  }
};

// Enhanced notification handler
exports.handleMidtransNotification = async (req, res) => {
  try {
    const notification = req.body;
    console.log('Received Midtrans notification:', JSON.stringify(notification, null, 2));
    
    const { transaction_status, fraud_status, order_id, status_code } = notification;
    
    // Validate notification
    if (!order_id || !transaction_status) {
      console.error('Invalid notification - missing order_id or transaction_status');
      return res.status(400).json({ error: 'Invalid notification' });
    }

    // Verify notification in production
    let verifiedNotification = notification;
    if (isProduction) {
      try {
        verifiedNotification = await snap.transaction.notification(notification);
        if (verifiedNotification.order_id !== order_id) {
          console.error('Notification verification failed - order ID mismatch');
          return res.status(403).json({ error: 'Verification failed' });
        }
      } catch (error) {
        console.error('Notification verification error:', error);
        return res.status(403).json({ 
          error: 'Verification failed',
          details: error.message
        });
      }
    }

    // Determine new status with enhanced logic
    let newStatus;
    if (STATUS_MAPPING[transaction_status]) {
      if (typeof STATUS_MAPPING[transaction_status] === 'object') {
        newStatus = STATUS_MAPPING[transaction_status][fraud_status] || 'pending';
      } else {
        newStatus = STATUS_MAPPING[transaction_status];
      }
    } else {
      newStatus = transaction_status.toLowerCase();
    }

    console.log(`Processing status update for order ${order_id}: ${newStatus}`);

    // Get order reference
    const orderRef = db.collection('orders').doc(order_id);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      console.error('Order not found:', order_id);
      return res.status(404).json({ error: 'Order not found' });
    }

    const currentStatus = orderDoc.data().status;

    // Only proceed if status changed
    if (currentStatus !== newStatus) {
      const updateData = {
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        'payment.status': newStatus,
        'midtrans.status': newStatus,
        'midtrans.lastNotification': verifiedNotification
      };

      // Add paidAt timestamp for completed payments
      if (newStatus === 'completed') {
        updateData['payment.paidAt'] = admin.firestore.FieldValue.serverTimestamp();
      }

      // Transaction for atomic updates
      await db.runTransaction(async (transaction) => {
        // Update main order document
        transaction.update(orderRef, updateData);
        
        // Add detailed status history
        const statusHistoryRef = orderRef.collection('statusHistory').doc();
        transaction.set(statusHistoryRef, {
          status: newStatus,
          type: 'notification',
          source: 'midtrans',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          notification: verifiedNotification,
          metadata: {
            statusCode: status_code,
            previousStatus: currentStatus
          }
        });

        // For completed payments, create an order fulfillment record
        if (newStatus === 'completed') {
          const fulfillmentRef = orderRef.collection('fulfillment').doc();
          transaction.set(fulfillmentRef, {
            status: 'pending_fulfillment',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      console.log(`Successfully updated order ${order_id} from ${currentStatus} to ${newStatus}`);
    } else {
      console.log(`Order ${order_id} status unchanged (${currentStatus})`);
    }

    res.status(200).json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Notification handling error:', error);
    res.status(500).json({ 
      success: false,
      error: 'NOTIFICATION_HANDLING_FAILED',
      message: error.message,
      stack: isProduction ? undefined : error.stack
    });
  }
};

// Enhanced payment status check with caching
exports.checkPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { forceCheck = false } = req.query;

    // Check Firestore first
    const orderRef = db.collection('orders').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_NOT_FOUND',
        message: 'Order not found in database'
      });
    }

    const orderData = orderDoc.data();
    const lastChecked = orderData.payment?.lastChecked?.toDate() || new Date(0);
    const now = new Date();

    // Return cached data if recently checked and not forced
    if (!forceCheck && now - lastChecked < 30000 && orderData.status !== 'pending') {
      return res.json({
        success: true,
        status: orderData.status,
        fromCache: true,
        order: orderData
      });
    }

    // Check with Midtrans API
    const midtransResponse = await snap.transaction.status(orderId);
    const midtransStatus = midtransResponse.transaction_status;
    
    // Determine status with mapping
    let mappedStatus;
    if (STATUS_MAPPING[midtransStatus]) {
      if (typeof STATUS_MAPPING[midtransStatus] === 'object') {
        mappedStatus = STATUS_MAPPING[midtransStatus][midtransResponse.fraud_status] || 'pending';
      } else {
        mappedStatus = STATUS_MAPPING[midtransStatus];
      }
    } else {
      mappedStatus = midtransStatus.toLowerCase();
    }

    // Update Firestore if status changed
    if (mappedStatus !== orderData.status) {
      await orderRef.update({
        status: mappedStatus,
        'payment.status': mappedStatus,
        'midtrans.status': mappedStatus,
        'midtrans.lastResponse': midtransResponse,
        'payment.lastChecked': admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Add status history
      await orderRef.collection('statusHistory').add({
        status: mappedStatus,
        type: 'status_check',
        source: 'api',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        response: midtransResponse,
        previousStatus: orderData.status
      });
    }

    // Get updated order data
    const updatedOrder = (await orderRef.get()).data();

    res.json({
      success: true,
      status: mappedStatus,
      midtransStatus,
      order: updatedOrder,
      fromCache: false
    });

  } catch (error) {
    console.error('Status check error:', error);
    
    // Return cached data if available when API fails
    const orderRef = db.collection('orders').doc(req.params.orderId);
    const orderDoc = await orderRef.get();
    
    if (orderDoc.exists) {
      const orderData = orderDoc.data();
      return res.json({
        success: true,
        status: orderData.status,
        fromCache: true,
        order: orderData,
        error: 'MIDTRANS_API_FAILED',
        message: 'Using cached data due to API failure'
      });
    }

    res.status(500).json({
      success: false,
      error: 'STATUS_CHECK_FAILED',
      message: error.message
    });
  }
};