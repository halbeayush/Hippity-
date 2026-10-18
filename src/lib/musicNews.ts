import { XMLParser } from "fast-xml-parser";
import { mapWithConcurrency } from "./concurrency";
import { createPersistedLoader } from "./persistentCache";
import type { NewsItem } from "./types";

// A small set of well-established music publications with reliable public
// RSS feeds. Each is checked directly (see the investigation in git
// history) rather than assumed — a publication swapping feed URLs shows up
// as that source silently dropping out (fetchFeed fails soft), not a crash.
//
// Listed most reliable first: when several cover the same story, the row
// keeps the earliest one here (see dedupeStories). Billboard is the
// industry's trade paper of record, Rolling Stone and Pitchfork have
// long-standing newsrooms, and NME leans most toward tabloid-style
// headlines, so it goes last.
const FEEDS: { source: string; url: string }[] = [
  { source: "Billboard", url: "https://www.billboard.com/feed/" },
  {
    source: "Rolling Stone",
    url: "https://www.rollingstone.com/music/music-news/feed/",
  },
  { source: "Pitchfork", url: "https://pitchfork.com/rss/news/" },
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
// merged result is cached (in Postgres, so every instance and each new
// deploy shares it) and only actually refreshed on this cadence.
const CACHE_TTL_MS = 45 * 60 * 1000;

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

// Words too common in headlines to say two of them are about the same thing.
const HEADLINE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "his", "her", "their",
  "its", "new", "after", "about", "into", "over", "out", "has", "have", "are",
  "was", "will", "your", "you", "all", "but", "not", "just", "now", "how",
  "why", "what", "who", "says", "say", "watch", "listen", "hear", "video",
]);

// A headline's distinctive words: accents, punctuation, possessive "s" and
// filler dropped, so "Beyoncé's" and "Beyonce" match.
function headlineWords(title: string): Set<string> {
  return new Set(
    title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !HEADLINE_STOPWORDS.has(w)),
  );
}

// Two outlets' headlines for one story share most of their distinctive
// words ("Taylor Swift Announces New Album 'The Life of a Showgirl'" /
// "Taylor Swift Unveils The Life of a Showgirl"). Requiring 3+ shared words
// keeps two different stories about the same artist ("Taylor Swift
// announces tour" / "Taylor Swift breaks record") apart.
const MIN_SHARED_WORDS = 3;
const MIN_SHARED_FRACTION = 0.5;

function sameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (
    shared >= MIN_SHARED_WORDS &&
    shared / Math.min(a.size, b.size) >= MIN_SHARED_FRACTION
  );
}

// One item per story, from the most reliable outlet that covered it — FEEDS
// order — then newest first. Also drops a feed repeating its own link.
function dedupeStories(perFeed: NewsItem[][]): NewsItem[] {
  const kept: { item: NewsItem; words: Set<string> }[] = [];
  const links = new Set<string>();
  for (const item of perFeed.flat()) {
    if (links.has(item.link)) continue;
    const words = headlineWords(item.title);
    if (kept.some((k) => sameStory(k.words, words))) continue;
    links.add(item.link);
    kept.push({ item, words });
  }
  return kept
    .map((k) => k.item)
    .sort((a, b) => {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return +new Date(b.publishedAt) - +new Date(a.publishedAt);
    });
}

const ARTICLE_TIMEOUT_MS = 5000;
const ARTICLE_LOOKUP_CONCURRENCY = 6;

// The article's own preview image — the og:image every news site declares
// for link previews on social media. Null on any failure.
async function articleImage(link: string): Promise<string | null> {
  try {
    const response = await fetch(link, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(ARTICLE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const html = await response.text();
    // Either attribute order: <meta property="og:image" content="...">.
    const tag = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]*>/i)?.[0];
    const url = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (!url) return null;
    const absolute = new URL(decodeHtmlEntities(url), link);
    return absolute.protocol === "https:" ? absolute.toString() : null;
  } catch {
    return null;
  }
}

// Rolling Stone's feed carries no images at all and Billboard's only some,
// so a story without one gets its article's preview image instead. Only
// the stories actually shown are looked up, and the result is cached with
// the rest of the row (see CACHE_TTL_MS).
function withThumbnails(items: NewsItem[]): Promise<NewsItem[]> {
  return mapWithConcurrency(items, ARTICLE_LOOKUP_CONCURRENCY, async (item) =>
    item.thumbnailUrl
      ? item
      : { ...item, thumbnailUrl: await articleImage(item.link) },
  );
}

async function fetchMusicNews(): Promise<NewsItem[]> {
  // Promise.all keeps FEEDS order, which dedupeStories relies on.
  const perFeed = await Promise.all(
    FEEDS.map((feed) => fetchFeed(feed.source, feed.url)),
  );

  const merged = dedupeStories(perFeed);

  // Every feed failing (each fails soft to []) is an outage, not "no news":
  // throwing keeps the last good headlines instead of saving an empty row.
  if (merged.length === 0) throw new Error("every music news feed failed");
  return withThumbnails(merged.slice(0, TOTAL_LIMIT));
}

export const getMusicNews = createPersistedLoader(
  "home-music-news",
  CACHE_TTL_MS,
  fetchMusicNews,
);
