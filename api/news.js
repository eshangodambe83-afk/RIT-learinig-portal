module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const response = await fetch('https://news.google.com/rss/search?q=Artificial+Intelligence+when:1d&hl=en-US&gl=US&ceid=US:en');
    const xml = await response.text();

    // Simple regex-based parsing to avoid heavy XML dependencies
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
      const itemXml = match[1];
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemXml);
      const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(itemXml);
      const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(itemXml);

      if (titleMatch && linkMatch) {
        items.push({
          title: titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim(),
          link: linkMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1').trim(),
          pubDate: pubDateMatch ? pubDateMatch[1].trim() : ''
        });
      }
    }

    return res.status(200).json({ ok: true, items });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch news',
      details: String(error.message || error)
    });
  }
};
