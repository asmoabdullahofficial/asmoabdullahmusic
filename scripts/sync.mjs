// Auto-sync: Spotify releases + YouTube uploads -> data/releases.json
// Runs on GitHub Actions (Node 20+, no dependencies).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = 'data/releases.json';
const SPOTIFY_ARTIST_ID = process.env.SPOTIFY_ARTIST_ID || '0Zw4jjy9vBDgwKBVbXfhYW';
const YT_HANDLE = (process.env.YT_HANDLE || 'asmoabdullah').replace(/^@/, '');

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, YOUTUBE_API_KEY, YT_CHANNEL_ID } = process.env;

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url.split('?')[0]}`);
  return r.json();
}

/* ---------------- Spotify ---------------- */
async function syncSpotify() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify secrets missing');
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

  const seen = new Set();
  const out = [];
  for (const a of items) {
    const key = `${a.name}`.trim().toLowerCase();
    if (seen.has(key)) continue; // same release listed for several markets
    seen.add(key);
    const img = (a.images || [])[1] || (a.images || [])[0] || {};
    out.push({
      id: a.id,
      name: a.name,
      type: a.album_type === 'single' ? 'Single' : 'Album',
      date: a.release_date,
      cover: img.url || '',
      url: a.external_urls?.spotify || `https://open.spotify.com/album/${a.id}`,
    });
  }
  out.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  return out;
}

/* ---------------- YouTube ---------------- */
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function ytViaApi() {
  const ch = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(YT_HANDLE)}&key=${YOUTUBE_API_KEY}`);
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('YouTube channel not found for handle ' + YT_HANDLE);
  const out = [];
  let token = '';
  for (let page = 0; page < 4; page++) {
    const d = await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}&key=${YOUTUBE_API_KEY}${token}`);
    for (const it of d.items || []) {
      const t = it.snippet?.title || '';
      if (/^(Private|Deleted) video$/i.test(t)) continue;
      const th = it.snippet.thumbnails || {};
      out.push({
        id: it.contentDetails.videoId,
        title: t,
        date: (it.contentDetails.videoPublishedAt || it.snippet.publishedAt || '').slice(0, 10),
        thumb: (th.high || th.medium || th.default || {}).url || `https://i.ytimg.com/vi/${it.contentDetails.videoId}/hqdefault.jpg`,
      });
    }
    if (!d.nextPageToken) break;
    token = `&pageToken=${d.nextPageToken}`;
  }
  return out;
}

async function ytViaRss() {
  let id = YT_CHANNEL_ID;
  if (!id) {
    const html = await (await fetch(`https://www.youtube.com/@${YT_HANDLE}`, { headers: { 'Accept-Language': 'en' } })).text();
    id = (html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || [])[1];
  }
  if (!id) throw new Error('Could not find YouTube channel id. Set YT_CHANNEL_ID.');
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`)).text();
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const vid = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
    if (!vid) continue;
    out.push({
      id: vid,
      title: decode((e.match(/<title>([^<]*)</) || [])[1] || ''),
      date: ((e.match(/<published>([^<]+)</) || [])[1] || '').slice(0, 10),
      thumb: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    });
  }
  return out;
}

async function syncYouTube(previous) {
  const fresh = YOUTUBE_API_KEY ? await ytViaApi() : await ytViaRss();
  // keep older videos the RSS feed no longer lists
  const map = new Map();
  for (const v of [...fresh, ...previous]) if (!map.has(v.id)) map.set(v.id, v);
  return [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 100);
}

/* ---------------- main ---------------- */
let old = { updated: null, spotify: [], youtube: [] };
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

const next = { updated: old.updated, spotify: old.spotify || [], youtube: old.youtube || [] };
let problems = 0;

try { next.spotify = await syncSpotify(); console.log(`Spotify: ${next.spotify.length} releases`); }
catch (e) { problems++; console.warn('Spotify sync skipped:', e.message); }

try { next.youtube = await syncYouTube(next.youtube); console.log(`YouTube: ${next.youtube.length} videos`); }
catch (e) { problems++; console.warn('YouTube sync skipped:', e.message); }

const changed = JSON.stringify([old.spotify, old.youtube]) !== JSON.stringify([next.spotify, next.youtube]);
if (changed) next.updated = new Date().toISOString();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(next, null, 2) + '\n');
console.log(changed ? 'releases.json updated' : 'No changes');

// fail the run only if BOTH sources failed, so you notice in the Actions tab
if (problems === 2) process.exit(1);
