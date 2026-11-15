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
    v.poster = posterUrl(id);
    v.style.backgroundImage = 'url(' + posterUrl(id) + ')';
    if (saveData || reduce) return; // poster only
    var loaded = false;
    function load() {
      if (loaded) return; loaded = true;
      [['webm', 'video/webm'], ['mp4', 'video/mp4']].forEach(function (f) {
        v.appendChild(el('source', { src: vUrl(id, f[0]), type: f[1] }));
      });
      v.load();
    }
    if (!('IntersectionObserver' in window)) { load(); v.play().catch(function () {}); return; }
    // load when near viewport, play only while visible (saves battery + data)
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
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
    var t = new Date(d); if (isNaN(t)) return d;
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function safeUrl(u, hosts) {
    try { var x = new URL(u); return x.protocol === 'https:' && hosts.some(function (h) { return x.hostname === h || x.hostname.endsWith('.' + h); }) ? x.href : ''; }
    catch (e) { return ''; }
  }
  var IMG_HOSTS = ['scdn.co', 'spotifycdn.com', 'ytimg.com', 'googleusercontent.com', 'ggpht.com'];

  function card(item, kind) {
    var cover = safeUrl(item.cover, IMG_HOSTS);
    var img = el('img', { alt: 'Cover of ' + item.title, loading: 'lazy', width: '640', height: kind === 'yt' ? '360' : '640' });
    if (cover) img.src = cover;
    var coverBtn = el('button', { class: 'rel-cover', type: 'button', 'aria-label': 'Play ' + item.title }, [img, el('span', { class: 'play' })]);
    var open = function () { openPlayer(kind === 'yt' ? youtubePlayer(item.id) : spotifyPlayer(item.id)); };
    coverBtn.addEventListener('click', open);

    var playBtn = el('button', { class: 'btn btn-pri btn-sm', type: 'button', text: 'Play here' });
    playBtn.addEventListener('click', open);
    var link = kind === 'yt'
      ? safeUrl(item.musicUrl, ['music.youtube.com'])
      : safeUrl(item.url, ['open.spotify.com']);
    var linkEl = el('a', { class: 'btn btn-ghost btn-sm', href: link || '#', target: '_blank', rel: 'noopener', text: kind === 'yt' ? 'YouTube Music' : 'Open in Spotify' });

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

  fetch('data/releases.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(function () { return { spotify: [], youtube: [] }; })
    .then(function (d) {
      var sp = (d.spotify || []).map(function (x) {
        return { id: x.id, title: x.name, type: x.type, date: x.date, cover: x.cover, url: x.url };
      });
      var yt = (d.youtube || []).map(function (x) {
        return { id: x.id, title: x.title, type: 'Video', date: x.date, cover: x.thumb, musicUrl: 'https://music.youtube.com/watch?v=' + x.id };
      });
      renderList('#spotifyGrid', '#spotifyMore', '#spotifyMoreBtn', sp, 'sp',
        'Releases will appear here after the first automatic sync. Meanwhile, use the playlist below.');
      renderList('#youtubeGrid', '#youtubeMore', '#youtubeMoreBtn', yt, 'yt',
        'Videos will appear here after the first automatic sync.');
    });
})();
