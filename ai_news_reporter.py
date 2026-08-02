#!/usr/bin/env python3
import urllib.request
import xml.etree.ElementTree as ET
import sys
import html

def fetch_ai_news():
    url = "https://news.google.com/rss/search?q=Artificial+Intelligence+when:1d&hl=en-US&gl=US&ceid=US:en"
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )

    try:
        print("\n\033[1;36mFetching Latest Artificial Intelligence News...\033[0m\n")
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
            root = ET.fromstring(xml_data)

            items = root.findall('.//item')[:10]
            if not items:
                print("No news found at the moment.")
                return

            for i, item in enumerate(items, 1):
                title = item.find('title').text
                link = item.find('link').text
                pubDate = item.find('pubDate').text

                # Unescape HTML entities in title
                title = html.unescape(title)

                print(f"\033[1;32m{i}. {title}\033[0m")
                print(f"   📅 \033[90m{pubDate}\033[0m")
                print(f"   🔗 \033[4;34m{link}\033[0m\n")

    except Exception as e:
        print(f"\033[1;31mError fetching news: {e}\033[0m")
        sys.exit(1)

if __name__ == "__main__":
    fetch_ai_news()
