// firestore.js
const { admin, db } = require('./firebase');

const saveOrderToFirestore = async (orderData, paymentResponse) => {
  try {
    const orderRef = db.collection('orders').doc(orderData.transaction_details.order_id);

    await orderRef.set({
      customer: {
        name: `${orderData.customer_details.first_name} ${orderData.customer_details.last_name}`,
        email: orderData.customer_details.email,
        phone: orderData.customer_details.phone,
        address: orderData.customer_details.shipping_address.address
      },
      items: orderData.item_details,
      totalAmount: orderData.transaction_details.gross_amount,
      paymentMethod: orderData.payment_type,
      status: 'pending',
      midtransResponse: paymentResponse,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return orderRef.id;
  } catch (error) {
    console.error('Error saving order to Firestore:', error);
    throw error;
  }
};

const updateOrderStatus = async (orderId, status) => {
  try {
    console.log('Updating order status:', orderId, status);

    const orderRef = db.collection('orders').doc(orderId);

    await orderRef.update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await orderRef.collection('statusHistory').add({
      status,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return true;
  } catch (error) {
    console.error('Error updating order status:', error);
    throw error;
  }
};

module.exports = {
  saveOrderToFirestore,
  updateOrderStatus
};
