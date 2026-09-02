import { XMLParser } from "fast-xml-parser";
import { createTtlCache } from "./apiCache";
import type { NewsItem } from "./types";

// A small set of well-established music publications with reliable public
// RSS feeds. Each is checked directly (see the investigation in git
// history) rather than assumed — a publication swapping feed URLs shows up
// as that source silently dropping out (fetchFeed fails soft), not a crash.
const FEEDS: { source: string; url: string }[] = [
  { source: "Pitchfork", url: "https://pitchfork.com/rss/news/" },
  { source: "Billboard", url: "https://www.billboard.com/feed/" },
  {
    source: "Rolling Stone",
    url: "https://www.rollingstone.com/music/music-news/feed/",
  },
  { source: "Stereogum", url: "https://www.stereogum.com/feed/" },
  { source: "NME", url: "https://www.nme.com/news/music/feed" },
];

const USER_AGENT = "Spinsheet/0.1.0 ( halbeayush2@gmail.com )";
const FEED_TIMEOUT_MS = 6000;
const ITEMS_PER_FEED = 8;
const TOTAL_LIMIT = 16;
const EXCERPT_MAX_LENGTH = 200;
// Refetching five publications' feeds on every Home page load would hammer
// them for no benefit — headlines don't change minute to minute — so the
// merged result is cached here and only actually refreshed on this cadence.
const CACHE_TTL_MS = 45 * 60 * 1000;

const cache = createTtlCache<NewsItem[]>(CACHE_TTL_MS);
const CACHE_KEY = "merged";

// htmlEntities also decodes numeric character references (e.g. &#8217;)
// that show up inline in titles — without it those come through literally
// instead of as the punctuation they represent.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  htmlEntities: true,
});

type RssNode = string | { "@_url"?: string; [key: string]: unknown } | undefined;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

// fast-xml-parser's htmlEntities option decodes entities at the XML layer,
// but per the XML spec it correctly leaves CDATA content untouched — and
// some feeds' CDATA blocks contain text that's *already* HTML-entity-
// encoded (e.g. a "The post Foo&#8217;s Bar appeared first on..." blurb
// nested inside the description). That text still needs decoding to
// display right, so it gets a second, explicit pass here.
function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function firstImgSrc(value: unknown): string | null {
  const html = asString(value);
  const match = html.match(/<img[^>]+src="([^"]+)"/i);
  return match ? match[1] : null;
}

function stripHtml(value: unknown): string {
  return asString(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// RSS feeds carry a thumbnail in whichever of several conventions the
// publication's CMS happens to emit — tries each in turn rather than
// assuming one shape.
function extractThumbnail(item: Record<string, unknown>): string | null {
  const thumbnail = item["media:thumbnail"] as RssNode;
  if (thumbnail && typeof thumbnail === "object" && thumbnail["@_url"]) {
    return thumbnail["@_url"];
  }
  const mediaContent = item["media:content"] as RssNode;
  if (mediaContent && typeof mediaContent === "object" && mediaContent["@_url"]) {
    return mediaContent["@_url"];
  }
  const enclosure = item["enclosure"] as RssNode;
  if (enclosure && typeof enclosure === "object" && enclosure["@_url"]) {
    return enclosure["@_url"];
  }
  return (
    firstImgSrc(item["content:encoded"]) ?? firstImgSrc(item["description"])
  );
}

async function fetchFeed(source: string, url: string): Promise<NewsItem[]> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const data = parser.parse(xml);
    const rawItems = data?.rss?.channel?.item;
    const items: Record<string, unknown>[] = Array.isArray(rawItems)
      ? rawItems
      : rawItems
        ? [rawItems]
        : [];

    return items
      .slice(0, ITEMS_PER_FEED)
      .map((item): NewsItem => {
        const pubDate = asString(item.pubDate);
        const parsedDate = pubDate ? new Date(pubDate) : null;
        const excerpt = decodeHtmlEntities(stripHtml(item.description)).slice(
          0,
          EXCERPT_MAX_LENGTH,
        );

        return {
          title: decodeHtmlEntities(asString(item.title).trim()),
          link: asString(item.link).trim(),
          source,
          publishedAt:
            parsedDate && !Number.isNaN(parsedDate.getTime())
              ? parsedDate.toISOString()
              : null,
          thumbnailUrl: extractThumbnail(item),
          excerpt: excerpt || null,
        };
      })
      .filter((item) => item.title && item.link);
  } catch (err) {
    console.error(`music news feed failed: ${source}`, err);
    return [];
  }
}

export async function getMusicNews(): Promise<NewsItem[]> {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const perFeed = await Promise.all(
    FEEDS.map((feed) => fetchFeed(feed.source, feed.url)),
  );

  const merged = perFeed.flat().sort((a, b) => {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return +new Date(b.publishedAt) - +new Date(a.publishedAt);
  });

  const items = merged.slice(0, TOTAL_LIMIT);
  cache.set(CACHE_KEY, items);
  return items;
}
