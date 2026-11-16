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
async function syncApple() {
  const seen = new Map();
  for (const cc of ['us', 'om', 'in', 'bd', 'gb']) {
    let d;
    try { d = await getJson(`https://itunes.apple.com/lookup?id=${APPLE_ARTIST_ID}&entity=album&limit=200&country=${cc}`); }
    catch (e) { console.warn(`Apple ${cc}:`, e.message); continue; }
    for (const r of d.results || []) {
      if (r.wrapperType !== 'collection' || !r.collectionName) continue;
      const key = norm(r.collectionName);
      if (seen.has(key)) continue;
      const kind = /-\s*EP$/i.test(r.collectionName) ? 'EP' : /-\s*Single$/i.test(r.collectionName) ? 'Single' : 'Album';
      seen.set(key, {
        id: String(r.collectionId),
        name: r.collectionName.replace(/\s*-\s*(Single|EP)$/i, ''),
        type: kind,
        date: (r.releaseDate || '').slice(0, 10),
        cover: (r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
        url: (r.collectionViewUrl || '').split('?')[0],
      });
    }
    if (seen.size) break; // first storefront that has the artist is enough
  }
  return [...seen.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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
  return [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 100);
}

/* ---------------- main ---------------- */
let old = {};
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
const next = { updated: old.updated || null, apple: old.apple || [], spotify: old.spotify || [], youtube: old.youtube || [] };
let ok = 0;

try { const a = await syncApple(); if (a.length) { next.apple = a; ok++; } console.log(`Apple Music: ${a.length} releases`); }
catch (e) { console.warn('Apple sync failed:', e.message); }

try { const s = await syncSpotify(); if (s) { next.spotify = s; ok++; console.log(`Spotify: ${s.length} releases`); } else console.log('Spotify keys not set, skipping (fine)'); }
catch (e) { console.warn('Spotify sync failed:', e.message); }

try { next.youtube = await syncYouTube(next.youtube); ok++; console.log(`YouTube: ${next.youtube.length} videos`); }
catch (e) { console.warn('YouTube sync failed:', e.message); }

const sig = (o) => JSON.stringify([o.apple, o.spotify, o.youtube]);
const changed = sig(old) !== sig(next);
if (changed) next.updated = new Date().toISOString();
await writeFile(OUT, JSON.stringify(next, null, 2) + '\n');
console.log(changed ? 'releases.json updated' : 'No changes');
if (ok === 0) process.exit(1);
