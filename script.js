(function () {
  'use strict';

  var CLOUD = 'czeeolul';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- tiny safe DOM helper (no innerHTML with data) ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  /* ---------- menu (3 lines) ---------- */
  var burger = $('#burger'), drawer = $('#drawer'), scrim = $('#scrim'), bar = $('#bar');
  function setMenu(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    scrim.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }
  burger.addEventListener('click', function () { setMenu(!drawer.classList.contains('open')); });
  scrim.addEventListener('click', function () { setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  document.querySelectorAll('[data-nav]').forEach(function (a) {
    a.addEventListener('click', function () { setMenu(false); });
  });
  function onScroll() { bar.classList.toggle('solid', window.scrollY > 40); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- reveal on scroll ---------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  document.querySelectorAll('.reveal').forEach(function (n) { io ? io.observe(n) : n.classList.add('in'); });

  /* ---------- background videos (Cloudinary, size adapts to device + network) ---------- */
  var conn = navigator.connection || {};
  var saveData = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = window.matchMedia('(max-width: 768px)').matches;
  var width = isMobile ? 720 : (window.innerWidth > 1500 ? 1920 : 1280);

  function vUrl(id, ext) {
    return 'https://res.cloudinary.com/' + CLOUD + '/video/upload/q_auto,w_' + width + ',c_limit/' + id + '.' + ext;
  }
  function posterUrl(id) {
    return 'https://res.cloudinary.com/' + CLOUD + '/video/upload/so_0,f_auto,q_auto,w_' + width + ',c_limit/' + id + '.jpg';
  }
  function initVideo(v) {
    var id = v.getAttribute('data-id');
    v.muted = true; v.defaultMuted = true; v.setAttribute('webkit-playsinline', '');
    v.poster = posterUrl(id);
    v.style.backgroundImage = 'url(' + posterUrl(id) + ')';
    // page-wide background: also keep the still poster on the container, so something shows even if autoplay is blocked
    if (v.getAttribute('data-mode') === 'fixed' && v.parentNode) v.parentNode.style.backgroundImage = 'url(' + posterUrl(id) + ')';
    if (saveData || reduce) return; // poster only
    var loaded = false, want = false;
    function tryPlay() { if (want && loaded && v.paused) { var q = v.play(); if (q && q.catch) q.catch(function () {}); } }
    // iPhone Low Power Mode / strict autoplay: retry on the first touches
    document.addEventListener('touchend', tryPlay, { passive: true });
    document.addEventListener('click', tryPlay);
    function load() {
      if (loaded) return; loaded = true;
      [['webm', 'video/webm'], ['mp4', 'video/mp4']].forEach(function (f) {
        v.appendChild(el('source', { src: vUrl(id, f[0]), type: f[1] }));
      });
      v.load();
    }
    if (v.getAttribute('data-mode') === 'fixed') {
      // page-wide background: wait until the hero is mostly scrolled away, then load + play; pause while hero covers it
      var hero = $('#home');
      var go = function (show) {
        want = show;
        if (show) { load(); var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
      };
      if (!hero || !('IntersectionObserver' in window)) { window.addEventListener('scroll', function once() { window.removeEventListener('scroll', once); go(true); }, { passive: true }); return; }
      new IntersectionObserver(function (es) { go(es[0].intersectionRatio < 0.8); },
        { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] }).observe(hero);
      return;
    }
    if (!('IntersectionObserver' in window)) { load(); v.play().catch(function () {}); return; }
    // load when near viewport, play only while visible (saves battery + data)
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        want = e.isIntersecting;
        if (e.isIntersecting) { load(); var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        else v.pause();
      });
    }, { rootMargin: '300px 0px' }).observe(v);
  }
  document.querySelectorAll('.bgvideo').forEach(initVideo);

  /* ---------- player modal ---------- */
  var modal = $('#modal'), modalBody = $('#modalBody');
  function openPlayer(iframe) {
    modalBody.textContent = '';
    modalBody.appendChild(iframe);
    if (modal.showModal) modal.showModal(); else modal.setAttribute('open', '');
  }
  function closePlayer() {
    modalBody.textContent = ''; // removing iframe stops playback
    if (modal.close) modal.close(); else modal.removeAttribute('open');
  }
  $('#modalX').addEventListener('click', closePlayer);
  modal.addEventListener('click', function (e) { if (e.target === modal) closePlayer(); });
  modal.addEventListener('close', function () { modalBody.textContent = ''; });

  function spotifyPlayer(id) {
    return el('iframe', {
      title: 'Spotify player', height: '352', loading: 'lazy',
      src: 'https://open.spotify.com/embed/album/' + encodeURIComponent(id) + '?utm_source=generator&theme=0',
      allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
    });
  }
  function applePlayer(url) {
    var u = safeUrl(url, ['music.apple.com']);
    if (!u) return el('p', { class: 'empty', text: 'Player unavailable.' });
    return el('iframe', {
      title: 'Apple Music player', height: '450', loading: 'lazy',
      src: u.replace('//music.apple.com', '//embed.music.apple.com'),
      allow: 'autoplay *; encrypted-media *; fullscreen *; clipboard-write',
      sandbox: 'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation'
    });
  }
  function ytPlaylistPlayer(list) {
    return el('iframe', {
      title: 'YouTube Music player', class: 'yt-frame',
      src: 'https://www.youtube-nocookie.com/embed/videoseries?list=' + encodeURIComponent(list) + '&autoplay=1&rel=0',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: ''
    });
  }
  function youtubePlayer(id) {
    return el('iframe', {
      title: 'YouTube player', class: 'yt-frame',
      src: 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: ''
    });
  }

  /* ---------- release cards ---------- */
  function fmtDate(d) {
    if (!d) return '';
    if (/^\d{4}$/.test(d)) return d;
    var t = new Date(d); if (isNaN(t)) return d;
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function safeUrl(u, hosts) {
    try { var x = new URL(u); return x.protocol === 'https:' && hosts.some(function (h) { return x.hostname === h || x.hostname.endsWith('.' + h); }) ? x.href : ''; }
    catch (e) { return ''; }
  }
  var IMG_HOSTS = ['scdn.co', 'spotifycdn.com', 'ytimg.com', 'googleusercontent.com', 'ggpht.com', 'mzstatic.com'];

  function card(item, kind) {
    var cover = safeUrl(item.cover, IMG_HOSTS);
    var img = el('img', { alt: 'Cover of ' + item.title, loading: 'lazy', width: '640', height: kind === 'yt' ? '360' : '640' });
    if (cover) img.src = cover;
    var coverBtn = el('button', { class: 'rel-cover', type: 'button', 'aria-label': 'Play ' + item.title }, [img, el('span', { class: 'play' })]);
    var open = function () { openPlayer(kind === 'ym' ? (item.playlist ? ytPlaylistPlayer(item.playlist) : applePlayer('')) : kind === 'yt' ? youtubePlayer(item.id) : kind === 'ap' ? applePlayer(item.appleUrl) : spotifyPlayer(item.id)); };
    coverBtn.addEventListener('click', open);

    var playBtn = el('button', { class: 'btn btn-pri btn-sm', type: 'button', text: 'Play here' });
    playBtn.addEventListener('click', open);
    var link = kind === 'ym'
      ? (item.playlist ? 'https://music.youtube.com/playlist?list=' + encodeURIComponent(item.playlist) : 'https://music.youtube.com/@asmoabdullah')
      : kind === 'yt'
      ? safeUrl(item.musicUrl, ['music.youtube.com'])
      : kind === 'ap'
        ? 'https://open.spotify.com/search/' + encodeURIComponent(item.title + ' ASMO ABDULLAH')
        : safeUrl(item.url, ['open.spotify.com']);
    var linkEl = el('a', { class: 'btn btn-ghost btn-sm', href: link || '#', target: '_blank', rel: 'noopener', text: (kind === 'yt' || kind === 'ym') ? 'YouTube Music' : 'Open in Spotify' });

    return el('article', { class: 'rel' }, [
      coverBtn,
      el('div', { class: 'rel-body' }, [
        el('h3', { class: 'rel-title', text: item.title }),
        el('p', { class: 'rel-meta', text: [item.type, fmtDate(item.date)].filter(Boolean).join(' · ') }),
        el('div', { class: 'rel-actions' }, [playBtn, linkEl])
      ])
    ]);
  }

  var LIMIT = 8;
  function renderList(gridId, moreId, btnId, items, kind, emptyText) {
    var grid = $(gridId), more = $(moreId), btn = $(btnId);
    grid.textContent = '';
    if (!items.length) { grid.appendChild(el('p', { class: 'empty', text: emptyText })); return; }
    items.forEach(function (it, i) {
      var c = card(it, kind);
      if (i >= LIMIT) c.hidden = true;
      grid.appendChild(c);
    });
    if (items.length > LIMIT) {
      more.hidden = false;
      btn.addEventListener('click', function () {
        grid.querySelectorAll('[hidden]').forEach(function (c) { c.hidden = false; });
        more.hidden = true;
      });
    }
  }

  fetch('releases.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(function () { return { apple: [], spotify: [], youtube: [] }; })
    .then(function (d) {
      var sp = (d.spotify || []).map(function (x) {
        return { id: x.id, title: x.name, type: x.type, date: x.date, cover: x.cover, url: x.url };
      });
      var useApple = !sp.length && (d.apple || []).length;
      if (useApple) {
        sp = d.apple.map(function (x) {
          return { id: x.id, title: x.name, type: x.type, date: x.date, cover: x.cover, appleUrl: x.url };
        });
      }
      var yt = (d.youtube || []).map(function (x) {
        return { id: x.id, title: x.title, type: 'Video', date: x.date, cover: x.thumb, musicUrl: 'https://music.youtube.com/watch?v=' + x.id };
      });
      renderList('#spotifyGrid', '#spotifyMore', '#spotifyMoreBtn', sp, useApple ? 'ap' : 'sp',
        'Releases will appear here after the first automatic sync. Meanwhile, use the playlist below.');
      var ym = (d.ytmusic || []).map(function (x) {
        return { id: x.browseId, playlist: x.playlist, title: x.name, type: x.type, date: x.year, cover: x.cover };
      });
      var useYm = ym.length > 0;
      if (useYm) { var yg = $('#youtubeGrid'); yg.classList.remove('grid-wide'); }
      renderList('#youtubeGrid', '#youtubeMore', '#youtubeMoreBtn', useYm ? ym : yt, useYm ? 'ym' : 'yt',
        'Videos will appear here after the first automatic sync.');
    });
})();
