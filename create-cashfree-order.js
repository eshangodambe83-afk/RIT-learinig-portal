module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const courseName = String(body.courseName || '').trim();
    const amount = Number(body.amount || 0);
    const customerEmail = String(body.customerEmail || '').trim().toLowerCase();
    const customerName = String(body.customerName || 'RITP Student').trim().slice(0, 80) || 'RITP Student';
    const customerPhone = String(body.customerPhone || '').replace(/\D/g, '').slice(-10) || '9999999999';

    if (!courseName) {
      return res.status(400).json({ ok: false, error: 'Course name is required' });
    }
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ ok: false, error: 'Valid amount is required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ ok: false, error: 'Valid customer email is required' });
    }

    const appId = String(process.env.CASHFREE_APP_ID || '').trim();
    const secretKey = String(process.env.CASHFREE_SECRET_KEY || '').trim();
    const envRaw = String(process.env.CASHFREE_ENV || 'sandbox').trim().toLowerCase();
    const env = envRaw === 'production' ? 'production' : 'sandbox';

    if (!appId || !secretKey) {
      return res.status(500).json({
        ok: false,
        error: 'Cashfree is not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.'
      });
    }

    const baseUrl = env === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';

    const orderId = `ritp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const orderPayload = {
      order_id: orderId,
      order_amount: Number(amount.toFixed(2)),
      order_currency: 'INR',
      customer_details: {
        customer_id: customerEmail.replace(/[^a-z0-9]/gi, '_').slice(0, 40) || `user_${Date.now()}`,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone
      },
      order_meta: {
        return_url: String(body.returnUrl || '').trim() || undefined,
        notify_url: String(process.env.CASHFREE_NOTIFY_URL || '').trim() || undefined
      },
      order_note: `RITP Course Purchase: ${courseName}`
    };

    if (!orderPayload.order_meta.return_url && !orderPayload.order_meta.notify_url) {
      delete orderPayload.order_meta;
    }

    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01'
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: data.message || data.error || 'Cashfree order create failed',
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      orderId: String(data.order_id || orderId),
      paymentSessionId: String(data.payment_session_id || ''),
      orderStatus: String(data.order_status || '')
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Unexpected server error',
      details: String(error && error.message ? error.message : error)
    });
  }
};
