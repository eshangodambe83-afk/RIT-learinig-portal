module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '').trim().toLowerCase();
    const userEmail = normalizeEmail(body.userEmail);
    const userRole = String(body.userRole || 'Student').trim();
    const courseName = String(body.courseName || '').trim();

    if (!action) {
      return res.status(400).json({ ok: false, error: 'Action is required' });
    }
    if (!userEmail || !isValidEmail(userEmail)) {
      return res.status(400).json({ ok: false, error: 'Valid userEmail is required' });
    }
    if (!courseName) {
      return res.status(400).json({ ok: false, error: 'courseName is required' });
    }

    if (action === 'history') {
      const history = await fetchChatHistory(userEmail, courseName);
      return res.status(200).json({ ok: true, history });
    }

    if (action === 'clear') {
      const cleared = await clearChatHistory(userEmail, courseName);
      return res.status(200).json({ ok: true, cleared });
    }

    if (action !== 'ask') {
      return res.status(400).json({ ok: false, error: 'Unsupported action' });
    }

    const question = String(body.question || '').trim();
    if (!question) {
      return res.status(400).json({ ok: false, error: 'Question is required' });
    }
    if (question.length > 700) {
      return res.status(400).json({ ok: false, error: 'Question too long (max 700 chars)' });
    }

    const openaiApiKey = String(process.env.OPENAI_API_KEY || '').trim();
    const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    const forceFaqOnly = String(process.env.RITP_FAQ_ONLY || '').trim().toLowerCase() === 'true';
    let answer = '';

    if (forceFaqOnly || !openaiApiKey) {
      answer = buildFaqAnswer(question, courseName);
    } else {
      const recentHistory = await fetchChatHistory(userEmail, courseName, 14);
      const messages = buildModelMessages(recentHistory, question, courseName, userRole);

      const completionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.25,
          max_tokens: 420,
          messages
        })
      });

      if (completionResponse.ok) {
        const completionData = await completionResponse.json();
        answer = String(
          completionData && completionData.choices && completionData.choices[0] && completionData.choices[0].message
            ? completionData.choices[0].message.content || ''
            : ''
        ).trim();
      } else {
        // If OpenAI is unavailable (quota, billing, etc.), gracefully fallback to FAQ bot.
        answer = buildFaqAnswer(question, courseName);
      }
    }

    if (!answer) {
      answer = buildFaqAnswer(question, courseName);
    }

    // Best-effort persistence.
    await appendChatMessage(userEmail, courseName, 'user', question);
    await appendChatMessage(userEmail, courseName, 'assistant', answer);

    return res.status(200).json({ ok: true, answer });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Unexpected server error',
      details: String((error && error.message) || error || 'Unknown error')
    });
  }
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function normalizeRole(role) {
  const clean = String(role || '').trim().toLowerCase();
  if (clean === 'assistant') return 'assistant';
  return 'user';
}

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.RITP_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const table = String(process.env.SUPABASE_COURSE_CHAT_TABLE || 'ritp_course_chat').trim();
  const enabled = url.startsWith('http') && serviceRoleKey.length > 20 && table.length > 0;
  return { enabled, url, serviceRoleKey, table };
}

function getSupabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
  };
}

async function fetchChatHistory(userEmail, courseName, limit = 20) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled) return [];

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const base = cfg.url.replace(/\/+$/, '');
  const user = encodeURIComponent(userEmail);
  const course = encodeURIComponent(courseName);
  const table = encodeURIComponent(cfg.table);
  const url = `${base}/rest/v1/${table}?select=role,message,created_at&user_email=eq.${user}&course_name=eq.${course}&order=created_at.asc&limit=${safeLimit}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getSupabaseHeaders(cfg.serviceRoleKey)
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((row) => ({
        role: normalizeRole(row && row.role),
        text: String(row && row.message ? row.message : '').trim(),
        created_at: row && row.created_at ? String(row.created_at) : ''
      }))
      .filter((row) => row.text)
      .slice(-safeLimit);
  } catch (error) {
    return [];
  }
}

async function appendChatMessage(userEmail, courseName, role, message) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled) return false;
  const text = String(message || '').trim();
  if (!text) return false;

  const base = cfg.url.replace(/\/+$/, '');
  const table = encodeURIComponent(cfg.table);
  const url = `${base}/rest/v1/${table}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(cfg.serviceRoleKey),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        user_email: userEmail,
        course_name: courseName,
        role: normalizeRole(role),
        message: text.slice(0, 6000)
      })
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function clearChatHistory(userEmail, courseName) {
  const cfg = getSupabaseConfig();
  if (!cfg.enabled) return false;

  const base = cfg.url.replace(/\/+$/, '');
  const user = encodeURIComponent(userEmail);
  const course = encodeURIComponent(courseName);
  const table = encodeURIComponent(cfg.table);
  const url = `${base}/rest/v1/${table}?user_email=eq.${user}&course_name=eq.${course}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...getSupabaseHeaders(cfg.serviceRoleKey),
        Prefer: 'return=minimal'
      }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

function buildModelMessages(history, question, courseName, userRole) {
  const basePrompt = [
    'You are the RITP Course Doubt Assistant.',
    `Current course: ${courseName}.`,
    `User role: ${userRole}.`,
    'Answer only educational/course-related doubts clearly and briefly.',
    'If question is outside this course context, politely say it is outside scope and ask for a course-specific doubt.',
    'Use simple language and include short steps/examples when useful.',
    'Do not invent policies, marks, or deadlines.'
  ].join(' ');

  const historyMessages = Array.isArray(history)
    ? history
      .map((entry) => ({
        role: normalizeRole(entry && entry.role),
        content: String(entry && entry.text ? entry.text : '').trim()
      }))
      .filter((entry) => entry.content)
      .slice(-12)
    : [];

  return [
    { role: 'system', content: basePrompt },
    ...historyMessages,
    { role: 'user', content: question }
  ];
}

function buildFaqAnswer(question, courseName) {
  const q = String(question || '').trim().toLowerCase();
  const course = String(courseName || '').trim();

  if (!q) {
    return `Please ask a clear doubt for ${course || 'this course'}.`;
  }

  const has = (words) => words.some((word) => q.includes(word));

  if (has(['ac current', 'alternating current', 'ac'])) {
    return [
      `In ${course || 'this course'}, AC means Alternating Current.`,
      'AC changes direction periodically (usually sinusoidal).',
      'Key points:',
      '1. Frequency tells how fast direction changes (Hz).',
      '2. RMS value is used for effective power calculations.',
      '3. AC allows easy voltage transformation using transformers.'
    ].join('\n');
  }

  if (has(['dc current', 'direct current', 'dc'])) {
    return [
      'DC means Direct Current.',
      'It flows in one direction only and is commonly used in batteries/electronics.',
      'For many circuits: V = I * R and power P = V * I.'
    ].join('\n');
  }

  if (has(['ohm', 'resistance', 'v=i', 'ohm law', 'ohms law'])) {
    return [
      "Ohm's Law: V = I * R",
      'Where V = voltage, I = current, R = resistance.',
      'You can rearrange as I = V/R and R = V/I.'
    ].join('\n');
  }

  if (has(['capacitor', 'capacitance'])) {
    return [
      'Capacitor basics:',
      '1. Stores electrical energy in electric field.',
      '2. Opposes sudden voltage change.',
      '3. In AC, reactance Xc = 1/(2*pi*f*C).'
    ].join('\n');
  }

  if (has(['inductor', 'inductance', 'coil'])) {
    return [
      'Inductor basics:',
      '1. Stores energy in magnetic field.',
      '2. Opposes sudden current change.',
      '3. In AC, reactance Xl = 2*pi*f*L.'
    ].join('\n');
  }

  if (has(['assignment', 'submit', 'submission', 'drive link'])) {
    return [
      'Assignment help:',
      '1. Open the course assignment section.',
      '2. Paste valid Google Drive link.',
      '3. Ensure sharing permission is set (viewer).',
      '4. Submit before due date.'
    ].join('\n');
  }

  if (has(['quiz', 'test', 'mcq'])) {
    return [
      'Quiz tip:',
      '1. Watch lecture fully first.',
      '2. Note formulas/definitions.',
      '3. Attempt MCQs after understanding concepts.'
    ].join('\n');
  }

  return [
    `I can help with ${course || 'course'} basics, formulas, assignments, and quiz doubts.`,
    'Please ask in this format for best answer:',
    '"Topic + what you did not understand + where you got stuck".'
  ].join('\n');
}
