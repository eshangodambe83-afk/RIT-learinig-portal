module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const occurredAt = String(body.occurredAt || new Date().toISOString());

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Valid email is required' });
    }

    const resendApiKey = process.env.RESEND_API_KEY || '';
    const fromEmail = process.env.SIGNUP_ALERT_FROM_EMAIL || '';

    if (!resendApiKey || !fromEmail) {
      return res.status(500).json({
        ok: false,
        error: 'Email provider not configured. Set RESEND_API_KEY and SIGNUP_ALERT_FROM_EMAIL.'
      });
    }

    const subject = 'RITP Portal Signup Alert';
    const text = [
      'Your Gmail was used to create an account on RITP Learning Portal.',
      '',
      `Email: ${email}`,
      `Time: ${occurredAt}`,
      '',
      'If this was not you, please contact the portal admin immediately.'
    ].join('\n');

    const html = [
      '<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #0f172a;">',
      '<h2 style="margin: 0 0 12px;">RITP Portal Signup Alert</h2>',
      '<p>Your Gmail was used to create an account on <strong>RITP Learning Portal</strong>.</p>',
      `<p><strong>Email:</strong> ${email}<br/><strong>Time:</strong> ${occurredAt}</p>`,
      '<p>If this was not you, please contact the portal admin immediately.</p>',
      '</div>'
    ].join('');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject,
        text,
        html
      })
    });

    if (!response.ok) {
      const details = await response.text();
      return res.status(502).json({ ok: false, error: 'Email provider request failed', details });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Unexpected server error', details: String(error.message || error) });
  }
};
