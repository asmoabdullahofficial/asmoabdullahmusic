// Auto-sync -> releases.json
//  - Apple Music catalogue (free, no key)  : covers, titles, dates for ALL releases
//  - Spotify API (optional, needs Premium dev app keys)
//  - YouTube RSS (free, no key) or YouTube Data API (optional)
import { readFile, writeFile } from 'node:fs/promises';

const OUT = 'releases.json';
const APPLE_ARTIST_ID = process.env.APPLE_ARTIST_ID || '1860330114';
const SPOTIFY_ARTIST_ID = process.env.SPOTIFY_ARTIST_ID || '0Zw4jjy9vBDgwKBVbXfhYW';
const YT_HANDLE = (process.env.YT_HANDLE || 'asmoabdullah').replace(/^@/, '');
const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY, YT_CHANNEL_ID } = process.env;

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url.split('?')[0]}`);
  return r.json();
}
const norm = (s) => s.toLowerCase().replace(/\s*-\s*(single|ep)$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* ---------------- Apple Music (no key) ---------------- */
// Source 1: iTunes lookup API (can lag 1-3 days behind new releases)
// Source 2: the public Apple Music artist page (shows new releases immediately)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const hiRes = (u) => (u || '').replace(/\/[^\/]+\.(jpg|png|webp)$/i, '/600x600bb.jpg').replace(/\/\d+x\d+bb\./, '/600x600bb.');
const kindOf = (n) => (/-\s*EP$/i.test(n) ? 'EP' : /-\s*Single$/i.test(n) ? 'Single' : 'Album');
const cleanName = (n) => n.replace(/\s*-\s*(Single|EP)$/i, '').trim();

function metaOf(html, prop) {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'));
  const b = html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, 'i'));
  return decode((a || b || [])[1] || '');
}

async function appleAlbumFromPage(id, slug, store) {
  const url = `https://music.apple.com/${store}/album/${slug}/${id}`;
  const html = await (await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } })).text();
  if (!html.includes(APPLE_ARTIST_ID)) return null; // not this artist's own release
  let title = metaOf(html, 'og:title').replace(/^[‎‏\s]+/, '');
  title = title.replace(/\s+by\s+.+?\s+on\s+Apple\s+Music.*$/i, '').trim();
  if (!title) return null;
  const date = (metaOf(html, 'music:release_date') || '').slice(0, 10);
  return { id: String(id), name: cleanName(title), type: kindOf(title), date,
    cover: hiRes(metaOf(html, 'og:image')), url: `https://music.apple.com/${store}/album/${slug}/${id}` };
}

async function syncApple() {
  const seen = new Map();   // normalised name -> item
  const haveIds = new Set();
  const add = (it) => {
    const key = norm(it.name);
    if (!key || seen.has(key)) return;
    seen.set(key, it); haveIds.add(it.id);
  };

  // Source 1: lookup API, all storefronts merged
  for (const cc of ['om', 'us', 'in', 'bd', 'gb']) {
    try {
      const d = await getJson(`https://itunes.apple.com/lookup?id=${APPLE_ARTIST_ID}&entity=album&limit=200&country=${cc}&t=${Date.now()}`);
      for (const r of d.results || []) {
        if (r.wrapperType !== 'collection' || !r.collectionName) continue;
        add({ id: String(r.collectionId), name: cleanName(r.collectionName), type: kindOf(r.collectionName),
          date: (r.releaseDate || '').slice(0, 10), cover: hiRes(r.artworkUrl100), url: (r.collectionViewUrl || '').split('?')[0] });
      }
    } catch (e) { console.warn(`Apple lookup ${cc}:`, e.message); }
  }
  console.log(`Apple lookup API: ${seen.size} releases`);

  // Source 2: artist page, catches releases the lookup API does not have yet
  for (const store of ['om', 'us']) {
    try {
      const html = await (await fetch(`https://music.apple.com/${store}/artist/asmo-abdullah/${APPLE_ARTIST_ID}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } })).text();
      const found = new Map();
      for (const m of html.matchAll(/\/album\/([^"'\s<>\\\/?]+)\/(\d{6,})/g)) if (!found.has(m[2])) found.set(m[2], m[1]);
      const missing = [...found].filter(([id]) => !haveIds.has(id)).slice(0, 25);
      console.log(`Apple page (${store}): ${found.size} albums linked, ${missing.length} not in lookup`);
      for (const [id, slug] of missing) {
        try { const it = await appleAlbumFromPage(id, slug, store); if (it) { add(it); console.log('  + added from page:', it.name, it.date); } }
        catch (e) { console.warn('  page album failed', id, e.message); }
      }
      if (found.size) break;
    } catch (e) { console.warn(`Apple page ${store}:`, e.message); }
  }
  return [...seen.values()].sort((x, y) => (y.date || '').localeCompare(x.date || ''));
}

/* ---------------- Spotify (optional) ---------------- */
async function syncSpotify() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const tok = await getJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const headers = { Authorization: `Bearer ${tok.access_token}` };
  const items = [];
  let url = `https://api.spotify.com/v1/artists/${SPOTIFY_ARTIST_ID}/albums?include_groups=album,single&limit=10&offset=0`;
  for (let page = 0; url && page < 10; page++) {
    const d = await getJson(url, { headers });
    items.push(...(d.items || []));
    url = d.next;
  }
  const seen = new Set(), out = [];
  for (const a of items) {
    const key = norm(a.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const img = (a.images || [])[1] || (a.images || [])[0] || {};
    out.push({ id: a.id, name: a.name, type: a.album_type === 'single' ? 'Single' : 'Album', date: a.release_date,
      cover: img.url || '', url: a.external_urls?.spotify || `https://open.spotify.com/album/${a.id}` });
  }
  return out.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
}

/* ---------------- YouTube ---------------- */
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function ytViaApi() {
  const ch = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(YT_HANDLE)}&key=${YOUTUBE_API_KEY}`);
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('YouTube channel not found for handle ' + YT_HANDLE);
  const out = []; let token = '';
  for (let page = 0; page < 4; page++) {
    const d = await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}&key=${YOUTUBE_API_KEY}${token}`);
    for (const it of d.items || []) {
      const t = it.snippet?.title || '';
      if (/^(Private|Deleted) video$/i.test(t)) continue;
      const th = it.snippet.thumbnails || {};
      out.push({ id: it.contentDetails.videoId, title: t,
        date: (it.contentDetails.videoPublishedAt || it.snippet.publishedAt || '').slice(0, 10),
        thumb: (th.high || th.medium || th.default || {}).url || `https://i.ytimg.com/vi/${it.contentDetails.videoId}/hqdefault.jpg` });
    }
    if (!d.nextPageToken) break;
    token = `&pageToken=${d.nextPageToken}`;
  }
  return out;
}

async function findChannelId() {
  if (YT_CHANNEL_ID) return YT_CHANNEL_ID;
  const headers = { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' };
  for (const u of [`https://www.youtube.com/@${YT_HANDLE}`, `https://www.youtube.com/@${YT_HANDLE}/videos`]) {
    try {
      const html = await (await fetch(u, { headers })).text();
      const m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
      if (m) return m[1];
    } catch { /* try next */ }
  }
  return null;
}

async function ytViaRss() {
  const id = await findChannelId();
  if (!id) throw new Error('Could not find YouTube channel id. Add a repository variable/secret YT_CHANNEL_ID.');
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text();
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const vid = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
    if (!vid) continue;
    out.push({ id: vid, title: decode((e.match(/<title>([^<]*)</) || [])[1] || ''),
      date: ((e.match(/<published>([^<]+)</) || [])[1] || '').slice(0, 10), thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` });
  }
  if (!out.length) throw new Error('YouTube RSS returned no videos');
  return out;
}

async function syncYouTube(previous) {
  const fresh = YOUTUBE_API_KEY ? await ytViaApi() : await ytViaRss();
  const map = new Map();
  for (const v of [...fresh, ...previous]) if (!map.has(v.id)) map.set(v.id, v);
  const all = [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 100);
  let checks = 0;
  for (const v of all) {            // drop Shorts (checked once, then remembered)
    if (v.short === undefined && checks < 40) { checks++; const r = await isShort(v.id); if (r !== null) v.short = r; }
  }
  return all.filter((v) => !v.short);
}

/* ---------------- YouTube Music artist profile (no key) ---------------- */
// Uses the same web endpoint the music.youtube.com site itself calls. Unofficial, so every step is defensive.
const YTM = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
async function ytmBrowse(body) {
  const r = await fetch(YTM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com', 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241106.01.00', hl: 'en', gl: 'US' } }, ...body }),
  });
  if (!r.ok) throw new Error(`YT Music ${r.status}`);
  return r.json();
}
function* walk(o) {
  if (Array.isArray(o)) { for (const x of o) yield* walk(x); return; }
  if (o && typeof o === 'object') { yield o; for (const k of Object.keys(o)) yield* walk(o[k]); }
}
const runsText = (x) => (x?.runs || []).map((r) => r.text).join('');
function ytmItems(json) {
  const out = [];
  for (const o of walk(json)) {
    const it = o.musicTwoRowItemRenderer;
    if (!it) continue;
    const title = runsText(it.title);
    const bid = it.navigationEndpoint?.browseEndpoint?.browseId || it.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    if (!title || !bid || !/^MPRE/.test(bid)) continue; // albums / singles only
    const th = it.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const sub = runsText(it.subtitle).split('•').map((t) => t.trim()).filter(Boolean);
    out.push({ browseId: bid, title, thumb: (th[th.length - 1] || {}).url || '',
      type: sub.find((t) => /^(Album|Single|EP)$/i.test(t)) || 'Release', year: (sub.find((t) => /^\d{4}$/.test(t)) || '') });
  }
  return out;
}
async function syncYtMusic(previous) {
  const channelId = await findChannelId();
  if (!channelId) throw new Error('no channel id for YT Music');
  const page = await ytmBrowse({ browseId: channelId });
  let items = [];
  for (const o of walk(page)) {   // only the Albums / Singles shelves (not "Appears on", "Fans also like")
    const sh = o.musicCarouselShelfRenderer;
    if (sh && /^(Albums|Singles)/i.test(runsText(sh.header?.musicCarouselShelfBasicHeaderRenderer?.title))) items = items.concat(ytmItems(sh.contents));
  }
  // follow the "more" buttons of the Albums / Singles shelves for the complete lists
  for (const o of walk(page)) {
    const shelf = o.musicCarouselShelfRenderer;
    if (!shelf) continue;
    const head = runsText(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title);
    if (!/^(Albums|Singles)/i.test(head)) continue;
    const ep = shelf.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint;
    if (!ep?.browseId) continue;
    try { items = items.concat(ytmItems(await ytmBrowse({ browseId: ep.browseId, params: ep.params }))); }
    catch (e) { console.warn('YT Music "more" failed:', e.message); }
  }
  const uniq = new Map();
  for (const i of items) if (!uniq.has(i.browseId)) uniq.set(i.browseId, i);
  if (!uniq.size) throw new Error('YT Music artist page returned no albums/singles');

  const prevById = new Map((previous || []).map((x) => [x.browseId, x]));
  const out = [];
  let lookups = 0;
  for (const i of uniq.values()) {
    let playlist = prevById.get(i.browseId)?.playlist || '';
    if (!playlist && lookups < 40) {
      lookups++;
      try { const a = await ytmBrowse({ browseId: i.browseId }); playlist = (JSON.stringify(a).match(/list=(OLAK5uy_[\w-]+)/) || [])[1] || ''; }
      catch (e) { console.warn('YT Music album lookup failed:', i.title, e.message); }
    }
    out.push({ browseId: i.browseId, playlist, name: i.title, type: i.type, year: i.year,
      cover: (i.thumb || '').replace(/=w\d+-h\d+[^\s"]*$/, '=w600-h600-l90-rj') });
  }
  return out; // YT Music lists newest first
}

async function isShort(id) {
  try { const r = await fetch(`https://www.youtube.com/shorts/${id}`, { redirect: 'manual', headers: { 'User-Agent': UA } }); return r.status === 200; }
  catch { return null; }
}

/* ---------------- main ---------------- */
let old = {};
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
const next = { updated: old.updated || null, apple: old.apple || [], spotify: old.spotify || [], ytmusic: old.ytmusic || [], youtube: old.youtube || [] };
let ok = 0;

try { const a = await syncApple(); if (a.length) { next.apple = a; ok++; } console.log(`Apple Music: ${a.length} releases`); }
catch (e) { console.warn('Apple sync failed:', e.message); }

try { const s = await syncSpotify(); if (s) { next.spotify = s; ok++; console.log(`Spotify: ${s.length} releases`); } else console.log('Spotify keys not set, skipping (fine)'); }
catch (e) { console.warn('Spotify sync failed:', e.message); }

try { const m = await syncYtMusic(next.ytmusic); next.ytmusic = m; ok++; console.log(`YouTube Music: ${m.length} releases`); }
catch (e) { console.warn('YouTube Music sync failed:', e.message); }

try { next.youtube = await syncYouTube(next.youtube); ok++; console.log(`YouTube: ${next.youtube.length} videos`); }
catch (e) { console.warn('YouTube sync failed:', e.message); }

const sig = (o) => JSON.stringify([o.apple, o.spotify, o.ytmusic, o.youtube]);
const changed = sig(old) !== sig(next);
if (changed) next.updated = new Date().toISOString();
await writeFile(OUT, JSON.stringify(next, null, 2) + '\n');
console.log(changed ? 'releases.json updated' : 'No changes');
if (ok === 0) process.exit(1);
