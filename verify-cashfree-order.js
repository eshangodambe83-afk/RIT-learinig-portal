module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const orderId = String(body.orderId || '').trim();

    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'Order ID is required' });
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

    const response = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01'
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: data.message || data.error || 'Cashfree order verify failed',
        details: data
      });
    }

    const orderStatus = String(data.order_status || '').toUpperCase();
    const paid = orderStatus === 'PAID';

    return res.status(200).json({
      ok: true,
      paid,
      orderId: String(data.order_id || orderId),
      orderStatus,
      orderAmount: Number(data.order_amount || 0),
      orderCurrency: String(data.order_currency || 'INR')
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Unexpected server error',
      details: String(error && error.message ? error.message : error)
    });
  }
};
