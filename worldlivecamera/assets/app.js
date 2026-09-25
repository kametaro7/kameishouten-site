/* World Live Cam Map — app.js
 * データ: data/cameras.json（tools/build.py が生成） / 地図: MapLibre GL + OpenFreeMap / 再生: YouTube IFrame API
 */
(function () {
  'use strict';

  const VERSION = '2';

  // ---------- 定数 ----------
  const CAT_ORDER = ['city', 'landmark', 'beach', 'port', 'mountain', 'nature', 'animal', 'traffic', 'rail', 'airport', 'ski', 'volcano', 'weather', 'other'];
  const CAT_COLORS = {
    city: '#e5322d', landmark: '#d81b60', beach: '#00a3b8', port: '#1e63c4', mountain: '#2e7d32', nature: '#7cb342',
    animal: '#f4511e', traffic: '#f59e0b', rail: '#6a3fc1', airport: '#8e24aa', ski: '#3f51b5', volcano: '#6d4c41',
    weather: '#546e7a', other: '#78808a',
  };
  const LANGS = [
    ['en', 'English', 'English'], ['zh-CN', '简体中文', 'Chinese (Simplified)'], ['zh-TW', '繁體中文', 'Chinese (Traditional)'],
    ['es', 'Español', 'Spanish'], ['hi', 'हिन्दी', 'Hindi'], ['ru', 'Русский', 'Russian'], ['fr', 'Français', 'French'],
    ['pt', 'Português', 'Portuguese'], ['ar', 'العربية', 'Arabic'], ['ja', '日本語', 'Japanese'], ['de', 'Deutsch', 'German'],
    ['id', 'Bahasa Indonesia', 'Indonesian'], ['tr', 'Türkçe', 'Turkish'], ['it', 'Italiano', 'Italian'], ['ko', '한국어', 'Korean'],
    ['fa', 'فارسی', 'Persian'], ['bn', 'বাংলা', 'Bengali'], ['vi', 'Tiếng Việt', 'Vietnamese'], ['ur', 'اردو', 'Urdu'],
    ['th', 'ไทย', 'Thai'], ['pl', 'Polski', 'Polish'], ['mr', 'मराठी', 'Marathi'], ['te', 'తెలుగు', 'Telugu'], ['ta', 'தமிழ்', 'Tamil'],
    ['jv', 'Basa Jawa', 'Javanese'], ['nl', 'Nederlands', 'Dutch'], ['gu', 'ગુજરાતી', 'Gujarati'], ['uk', 'Українська', 'Ukrainian'],
    ['kn', 'ಕನ್ನಡ', 'Kannada'], ['ro', 'Română', 'Romanian'], ['az', 'Azərbaycanca', 'Azerbaijani'],
  ];
  const RTL = new Set(['ar', 'fa', 'ur']);
  // 地図タイルに無い言語は近い表記で代用（null はラテン文字）
  const TILE_LANG = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', mr: 'hi', jv: 'id', gu: null };
  const LAYOUTS = [{ n: 2, c: 2, r: 1 }, { n: 4, c: 2, r: 2 }, { n: 6, c: 3, r: 2 }, { n: 9, c: 3, r: 3 }, { n: 12, c: 4, r: 3 }, { n: 16, c: 4, r: 4 }];
  const AUTO_CHOICES = [0, 15, 30, 60, 180, 300, 600];
  const MAP_STYLES = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    standard: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  };
  const F_NOEMBED = 1, F_OFFLINE = 2, F_APPROX = 4;
  const MAX_SLOTS = 16;
  const YT_ID = /^[\w-]{11}$/;

  // ---------- 小物 ----------
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wlc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wlc.' + k, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } },
  };
  const isMobile = () => window.matchMedia('(max-width: 860px)').matches;
  const norm = (s) => (s || '').toString().normalize('NFKC').toLowerCase();
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((ch) => 0x1F1A5 + ch.charCodeAt(0))) : '');
  const rowH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 66;
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ytWatch(v) { return 'https://www.youtube.com/watch?v=' + encodeURIComponent(v); }
  function thumb(cam) { return 'https://i.ytimg.com/vi/' + encodeURIComponent(cam.v) + '/mqdefault.jpg'; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ---------- 翻訳 ----------
  const I18N = window.I18N_DATA || (window.I18N_DATA = {});
  let lang = 'en';
  let regionNames = null, numFmt = null, compactFmt = null;
  function t(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) != null ? I18N[lang][key] : (I18N.en && I18N.en[key]) != null ? I18N.en[key] : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }
  function loadLang(code) {
    return new Promise((resolve) => {
      if (I18N[code]) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'assets/i18n/' + code + '.js?v=' + VERSION;
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  function detectLang() {
    const q = new URLSearchParams(location.search).get('lang');
    const known = (c) => LANGS.some((l) => l[0] === c);
    if (q && known(q)) return q;
    const saved = store.get('lang', null);
    if (saved && known(saved)) return saved;
    for (const raw of navigator.languages || [navigator.language || 'en']) {
      const low = raw.toLowerCase();
      if (low.startsWith('zh')) return /tw|hk|mo|hant/.test(low) ? 'zh-TW' : 'zh-CN';
      const base = low.split('-')[0];
      if (known(base)) return base;
      if (base === 'ms') return 'id';
    }
    return 'en';
  }
  function fmt(n) { return numFmt ? numFmt.format(n) : String(n); }
  function countryName(cc) { try { return (regionNames && regionNames.of(cc)) || cc; } catch (e) { return cc; } }
  function setLocaleObjects() {
    const chain = lang === 'jv' ? ['jv', 'id', 'en'] : [lang, 'en'];
    try { regionNames = new Intl.DisplayNames(chain, { type: 'region' }); } catch (e) { regionNames = null; }
    try { numFmt = new Intl.NumberFormat(chain); compactFmt = new Intl.NumberFormat(chain, { notation: 'compact', maximumFractionDigits: 1 }); } catch (e) { numFmt = compactFmt = null; }
  }

  // ---------- 状態 ----------
  let CAMS = [];
  const BYID = new Map();
  let CHANNELS = [];
  let UPDATED = '';
  let FILTERED = [];
  let LIST = [];
  const F = { q: '', terms: [], cat: 'all', cc: 'all' };
  let scope = 'view';
  let current = null;
  let ccHay = {}, catHay = {};
  const BAD = new Map(Object.entries(store.get('bad', {})).filter(([, ts]) => Date.now() - ts < 3 * 864e5));
  function markBad(id) { BAD.set(id, Date.now()); store.set('bad', Object.fromEntries([...BAD].slice(-3000))); }

  // ---------- DOM ----------
  const E = {
    search: $('#search'), country: $('#country-select'), catBar: $('#cat-bar'), count: $('#count-badge'),
    sidebar: $('#sidebar'), list: $('#cam-list'), listInner: $('#cam-list-inner'), listCount: $('#list-count'), pickHint: $('#multi-pick-hint'),
    panel: $('#panel'), pName: $('#panel-name'), pPlace: $('#panel-place'), pCat: $('#panel-cat'), pTitle: $('#panel-title'),
    player: $('#player'), note: $('#player-note'), linkYt: $('#link-youtube'), linkCh: $('#link-channel'),
    nearby: $('#nearby-list'), foot: $('#panel-foot'), toast: $('#toast'), loading: $('#loading'), loadingText: $('#loading-text'),
    multi: $('#multi'), grid: $('#multi-grid'), btnMulti: $('#btn-multi'), multiCount: $('#multi-count'), layoutSeg: $('#layout-seg'),
    multiAuto: $('#multi-auto'), panelAuto: $('#panel-auto'), multiProg: $('#multi-progress'), panelProg: $('#panel-progress'),
    langBtn: $('#btn-lang'), langMenu: $('#lang-menu'),
  };

  // 一覧を開いている間はマルチビューを一覧の右側に寄せる（デスクトップ）
  new MutationObserver(() => $('#app').classList.toggle('side-open', E.sidebar.classList.contains('open')))
    .observe(E.sidebar, { attributes: true, attributeFilter: ['class'] });

  let toastTimer = null;
  function toast(msg) {
    E.toast.textContent = msg; E.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { E.toast.hidden = true; }, 2600);
  }
  async function copyText(url, okMsg) {
    try { await navigator.clipboard.writeText(url); toast(okMsg); } catch (e) { window.prompt(t('copyPrompt'), url); }
  }
  function shareBase() { return location.origin + location.pathname + (lang !== 'en' ? '?lang=' + encodeURIComponent(lang) : ''); }

  // ---------- 地図 ----------
  let mapStyle = store.get('mapStyle', 'light');
  if (!MAP_STYLES[mapStyle]) mapStyle = 'light';
  // アラビア文字などの右から左の文字は MapLibre 6.9 以降が自前で描くので、RTL プラグイン（setRTLTextPlugin は非推奨）は読み込まない
  const map = new maplibregl.Map({
    container: 'map', style: MAP_STYLES[mapStyle], center: [12, 28], zoom: isMobile() ? 0.8 : 1.7, minZoom: 0.5, maxZoom: 18,
    attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, fadeDuration: 150,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, fitBoundsOptions: { maxZoom: 9 } }), 'bottom-right');

  class StyleControl {
    onAdd() {
      this._c = el('div', 'maplibregl-ctrl maplibregl-ctrl-group map-style-ctrl');
      for (const k of Object.keys(MAP_STYLES)) {
        const b = el('button'); b.type = 'button'; b.dataset.k = k;
        b.addEventListener('click', () => setMapStyle(k));
        this._c.appendChild(b);
      }
      this.update();
      return this._c;
    }
    update() { if (!this._c) return; for (const b of this._c.children) { b.textContent = t('map.' + b.dataset.k); b.classList.toggle('active', b.dataset.k === mapStyle); } }
    onRemove() { this._c.remove(); }
  }
  const styleCtl = new StyleControl();
  map.addControl(styleCtl, 'bottom-right');

  function setMapStyle(k) {
    if (k === mapStyle) return;
    mapStyle = k; store.set('mapStyle', k); styleCtl.update();
    map.setStyle(MAP_STYLES[k]);
  }

  function styleFont() {
    const layers = (map.getStyle() && map.getStyle().layers) || [];
    for (const l of layers) {
      const f = l.layout && l.layout['text-font'];
      if (Array.isArray(f) && typeof f[0] === 'string') return [f[0]];
    }
    return ['Noto Sans Regular'];
  }

  function localizeLabels() {
    const style = map.getStyle();
    if (!style) return;
    const tl = Object.prototype.hasOwnProperty.call(TILE_LANG, lang) ? TILE_LANG[lang] : lang;
    const parts = [];
    if (tl) { parts.push(['get', 'name:' + tl]); if (tl.startsWith('zh')) parts.push(['get', 'name:zh']); }
    parts.push(['get', 'name:latin'], ['get', 'name']);
    const expr = ['coalesce', ...parts];
    for (const l of style.layers) {
      if (l.type !== 'symbol' || !l.layout || !l.layout['text-field'] || l.id.startsWith('wlc-')) continue;
      const tf = JSON.stringify(l.layout['text-field']);
      if (!/name/.test(tf) || /"ref"|housenumber/.test(tf)) continue;
      try { map.setLayoutProperty(l.id, 'text-field', expr); } catch (e) { /* 無視 */ }
    }
  }

  function geojson(list) {
    const features = new Array(list.length);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      features[k] = { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { i: c.i, c: c.cat, o: c.f & F_OFFLINE ? 1 : 0 } };
    }
    return { type: 'FeatureCollection', features };
  }
  function selGeojson() {
    return { type: 'FeatureCollection', features: current ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [current.lng, current.lat] }, properties: {} }] : [] };
  }

  function addCamLayers() {
    if (!map.getSource('wlc-cams')) {
      map.addSource('wlc-cams', { type: 'geojson', data: geojson(FILTERED), cluster: true, clusterMaxZoom: 12, clusterRadius: 46 });
    }
    if (!map.getSource('wlc-sel')) map.addSource('wlc-sel', { type: 'geojson', data: selGeojson() });
    const colorExpr = ['match', ['get', 'c']];
    for (const k of CAT_ORDER) colorExpr.push(k, CAT_COLORS[k]);
    colorExpr.push(CAT_COLORS.other);
    const dark = mapStyle === 'dark';
    map.addLayer({
      id: 'wlc-clusters', type: 'circle', source: 'wlc-cams', filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#f0645f', 30, '#e5322d', 300, '#b8211c', 3000, '#7d1410'],
        'circle-radius': ['step', ['get', 'point_count'], 13, 30, 17, 300, 22, 3000, 28],
        'circle-stroke-width': 2, 'circle-stroke-color': dark ? 'rgba(255,255,255,.55)' : '#fff', 'circle-opacity': 0.92,
      },
    });
    map.addLayer({
      id: 'wlc-cluster-count', type: 'symbol', source: 'wlc-cams', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': styleFont(), 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' },
    });
    map.addLayer({
      id: 'wlc-points', type: 'circle', source: 'wlc-cams', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': colorExpr,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 4.5, 8, 6.5, 14, 8.5],
        'circle-stroke-width': 1.6, 'circle-stroke-color': '#fff',
        'circle-opacity': ['case', ['==', ['get', 'o'], 1], 0.45, 1],
      },
    });
    map.addLayer({
      id: 'wlc-sel', type: 'circle', source: 'wlc-sel',
      paint: { 'circle-radius': 13, 'circle-color': 'rgba(229,50,45,.18)', 'circle-stroke-width': 3, 'circle-stroke-color': '#e5322d' },
    });
  }

  // style.load は言語ファイルの読み込み中にも来るので、言語確定後にも setLang から localizeLabels を呼ぶ
  let styleReady = false;
  map.on('style.load', () => {
    styleReady = true;
    addCamLayers();
    localizeLabels();
  });

  // ポイント・クラスタの操作
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'cam-tip', offset: 12 });
  let clusterPop = null;
  function camsAtPoint(e) {
    const feats = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['wlc-points'] });
    const seen = new Set(), out = [];
    for (const f of feats) { const c = CAMS[f.properties.i]; if (c && !seen.has(c.i)) { seen.add(c.i); out.push(c); } }
    return out;
  }
  function showCamListPopup(lngLat, cams, total) {
    if (clusterPop) clusterPop.remove();
    const box = el('div', 'cluster-pop');
    box.appendChild(el('h4', null, t('cluster.here', { n: fmt(total || cams.length) })));
    const list = el('div', 'list');
    for (const c of cams.slice(0, 100)) {
      const b = el('button'); b.type = 'button';
      const dot = el('span', 'dot'); dot.style.setProperty('--c', CAT_COLORS[c.cat]);
      const nm = el('span', null, c.name);
      nm.dir = 'auto';
      b.append(dot, nm);
      b.addEventListener('click', () => { clusterPop.remove(); pickCamera(c); });
      list.appendChild(b);
    }
    box.appendChild(list);
    clusterPop = new maplibregl.Popup({ maxWidth: '320px', offset: 10 }).setLngLat(lngLat).setDOMContent(box).addTo(map);
  }
  map.on('click', 'wlc-clusters', async (e) => {
    const f = e.features[0];
    const src = map.getSource('wlc-cams');
    const id = f.properties.cluster_id, count = f.properties.point_count;
    try {
      const z = await src.getClusterExpansionZoom(id);
      if (z <= 12.5 && map.getZoom() < 12) {
        map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.3, 14) });
      } else {
        const leaves = await src.getClusterLeaves(id, 100, 0);
        showCamListPopup(f.geometry.coordinates, leaves.map((l) => CAMS[l.properties.i]).filter(Boolean), count);
      }
    } catch (err) { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }); }
  });
  map.on('click', 'wlc-points', (e) => {
    const cams = camsAtPoint(e);
    if (cams.length > 1) showCamListPopup(e.lngLat, cams);
    else if (cams.length === 1) openCamera(cams[0], { fromMap: true });
  });
  for (const id of ['wlc-clusters', 'wlc-points']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; tip.remove(); });
  }
  map.on('mousemove', 'wlc-points', (e) => {
    if (isMobile()) return;
    const c = CAMS[e.features[0].properties.i];
    if (!c) return;
    const box = el('div', null, c.name);
    box.dir = 'auto';
    tip.setLngLat(e.features[0].geometry.coordinates).setDOMContent(box).addTo(map);
  });
  map.on('moveend', debounce(() => { if (scope === 'view') refreshList(false); }, 120));

  function panelPadding() {
    if (!E.panel.classList.contains('open')) return { top: 40, bottom: 40, left: 40, right: 40 };
    if (isMobile()) return { top: 20, bottom: map.getContainer().clientHeight * 0.74, left: 20, right: 20 };
    const w = E.panel.offsetWidth;
    return RTL.has(lang) ? { top: 40, bottom: 40, left: w + 20, right: 40 } : { top: 40, bottom: 40, left: 40, right: w + 20 };
  }

  function viewTest() {
    const b = map.getBounds();
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
    if (e - w >= 360) return (c) => c.lat >= s && c.lat <= n;
    return (c) => {
      if (c.lat < s || c.lat > n) return false;
      let x = c.lng;
      while (x < w) x += 360;
      while (x > w + 360) x -= 360;
      return x <= e;
    };
  }

  // ---------- 絞り込み ----------
  function baseHay(c) {
    if (c._h == null) c._h = norm([c.name, c.place, c.title, CHANNELS[c.ch] ? CHANNELS[c.ch][1] : '', c.cc].join(' '));
    return c._h;
  }
  function rebuildHays() {
    ccHay = {}; catHay = {};
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const c of CAMS) if (!(c.cc in ccHay)) {
      let s = c.cc;
      try { s += ' ' + en.of(c.cc) + ' ' + countryName(c.cc); } catch (e) { /* 不明な国コード */ }
      ccHay[c.cc] = norm(s);
    }
    for (const k of CAT_ORDER) catHay[k] = norm(t('cat.' + k) + ' ' + (I18N.en ? I18N.en['cat.' + k] : ''));
  }
  function applyFilter(opts) {
    opts = opts || {};
    const counts = {}; let total = 0;
    const out = [];
    const terms = F.terms;
    for (const c of CAMS) {
      if (F.cc !== 'all' && c.cc !== F.cc) continue;
      if (terms.length) {
        const h = baseHay(c), hc = ccHay[c.cc] || '', hk = catHay[c.cat] || '';
        let ok = true;
        for (const tm of terms) { if (!h.includes(tm) && !hc.includes(tm) && !hk.includes(tm)) { ok = false; break; } }
        if (!ok) continue;
      }
      counts[c.cat] = (counts[c.cat] || 0) + 1; total++;
      if (F.cat === 'all' || c.cat === F.cat) out.push(c);
    }
    FILTERED = out;
    updateCatCounts(counts, total);
    E.count.textContent = t('count', { shown: fmt(FILTERED.length), total: fmt(CAMS.length) });
    const src = map.getSource('wlc-cams');
    if (src) src.setData(geojson(FILTERED));
    refreshList(true);
    if (opts.fit) fitToList(FILTERED);
  }
  function fitToList(list) {
    if (!list.length) return;
    const lats = list.map((c) => c.lat).sort((a, b) => a - b), lngs = list.map((c) => c.lng).sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
    const lo = list.length > 20 ? 0.02 : 0, hi = 1 - lo;
    let w = q(lngs, lo), e = q(lngs, hi);
    const s = q(lats, lo), n = q(lats, hi);
    if (e - w < 0.05) { w -= 0.05; e += 0.05; }
    map.fitBounds([[w, Math.max(-85, s - 0.02)], [e, Math.min(85, n + 0.02)]], { padding: 60, maxZoom: 11, duration: 900 });
  }

  // カテゴリ
  function buildCatBar() {
    E.catBar.replaceChildren();
    const mk = (k, label, color) => {
      const b = el('button', 'cat-btn' + (F.cat === k ? ' active' : '')); b.type = 'button'; b.dataset.cat = k;
      if (color) { const sw = el('span', 'sw'); sw.style.setProperty('--c', color); b.appendChild(sw); }
      b.append(el('span', null, label), el('span', 'n'));
      E.catBar.appendChild(b);
    };
    mk('all', t('cat.all'));
    for (const k of CAT_ORDER) mk(k, t('cat.' + k), CAT_COLORS[k]);
  }
  function updateCatCounts(counts, total) {
    for (const b of E.catBar.children) {
      const k = b.dataset.cat, n = k === 'all' ? total : counts[k] || 0;
      b.querySelector('.n').textContent = fmt(n);
      b.hidden = k !== 'all' && n === 0 && F.cat !== k;
      b.classList.toggle('active', F.cat === k);
    }
  }
  E.catBar.addEventListener('click', (e) => {
    const b = e.target.closest('.cat-btn'); if (!b) return;
    F.cat = b.dataset.cat;
    applyFilter();
  });

  // 国・地域
  function buildCountrySelect() {
    const counts = {};
    for (const c of CAMS) counts[c.cc] = (counts[c.cc] || 0) + 1;
    const coll = new Intl.Collator(lang === 'jv' ? 'id' : lang);
    const arr = Object.keys(counts).map((cc) => [cc, countryName(cc)]).sort((a, b) => coll.compare(a[1], b[1]));
    const opts = [new Option(t('filter.allCountries') + ' (' + fmt(CAMS.length) + ')', 'all')];
    for (const [cc, nm] of arr) opts.push(new Option(flag(cc) + ' ' + nm + ' (' + fmt(counts[cc]) + ')', cc));
    E.country.replaceChildren(...opts);
    E.country.value = F.cc;
  }
  E.country.addEventListener('change', () => {
    F.cc = E.country.value;
    applyFilter({ fit: F.cc !== 'all' });
    if (F.cc === 'all') map.easeTo({ center: [12, 28], zoom: isMobile() ? 0.8 : 1.7 });
  });

  // 検索
  E.search.addEventListener('input', debounce(() => {
    F.q = E.search.value.trim();
    F.terms = norm(F.q).split(/\s+/).filter(Boolean);
    applyFilter();
    if (F.q) {
      if (scope === 'view') setScope('all');
      E.sidebar.classList.add('open');
    }
  }, 220));

  // ---------- 一覧（仮想スクロール） ----------
  const rendered = new Map();
  function setScope(s) {
    scope = s;
    for (const b of $('#list-scope').children) b.classList.toggle('active', b.dataset.scope === s);
    refreshList(true);
  }
  $('#list-scope').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setScope(b.dataset.scope); });
  function refreshList(resetScroll) {
    if (!CAMS.length) return;
    LIST = scope === 'view' ? FILTERED.filter(viewTest()) : FILTERED;
    E.listCount.textContent = t('list.count', { n: fmt(LIST.length) });
    for (const r of rendered.values()) r.remove();
    rendered.clear();
    E.listInner.style.height = LIST.length * rowH() + 'px';
    if (resetScroll) E.list.scrollTop = 0;
    const empty = E.listInner.querySelector('.list-empty');
    if (!LIST.length) {
      if (!empty) E.listInner.appendChild(el('div', 'list-empty', t(scope === 'view' && FILTERED.length ? 'list.emptyView' : 'list.empty')));
    } else if (empty) empty.remove();
    drawRows();
  }
  function drawRows() {
    const h = rowH(), top = E.list.scrollTop, vh = E.list.clientHeight || 700;
    const s = Math.max(0, Math.floor(top / h) - 4), e = Math.min(LIST.length, Math.ceil((top + vh) / h) + 4);
    for (const [k, r] of rendered) if (k < s || k >= e) { r.remove(); rendered.delete(k); }
    for (let k = s; k < e; k++) {
      if (rendered.has(k)) continue;
      const r = camRow(LIST[k]);
      r.style.top = k * h + 'px';
      E.listInner.appendChild(r);
      rendered.set(k, r);
    }
  }
  E.list.addEventListener('scroll', () => requestAnimationFrame(drawRows), { passive: true });

  function placeText(c) { return [c.place, countryName(c.cc)].filter(Boolean).join(', '); }
  function camRow(c, subText) {
    const d = el('div', 'cam-item' + (current === c ? ' active' : ''));
    d.dataset.i = c.i;
    const img = el('img'); img.loading = 'lazy'; img.alt = ''; img.src = thumb(c);
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    const body = el('div', 'ci-body');
    const name = el('div', 'ci-name', c.name);
    name.dir = 'auto';
    if (c.f & F_NOEMBED) name.append(' ', el('span', 'badge info', t('badge.ytOnly')));
    else if (c.f & F_OFFLINE || BAD.has(c.id)) name.append(' ', el('span', 'badge warn', t('badge.offline')));
    const sub = el('div', 'ci-sub');
    const dot = el('span', 'dot'); dot.style.setProperty('--c', CAT_COLORS[c.cat]);
    const st = el('span', 't', subText || (flag(c.cc) + ' ' + placeText(c)));
    st.dir = 'auto';
    sub.append(dot, st);
    if (c.w > 0 && !subText) sub.append(el('span', 'viewers', '● ' + (compactFmt ? compactFmt.format(c.w) : c.w)));
    body.append(name, sub);
    d.append(img, body);
    return d;
  }
  function onRowClick(e) {
    const r = e.target.closest('.cam-item'); if (!r) return;
    const c = CAMS[Number(r.dataset.i)]; if (c) pickCamera(c);
  }
  E.listInner.addEventListener('click', onRowClick);
  E.nearby.addEventListener('click', onRowClick);

  function pickCamera(c) {
    if (M.open) { addToMulti(c); return; }
    openCamera(c, { fly: true });
  }
  function markActiveRows() {
    for (const r of E.listInner.querySelectorAll('.cam-item')) r.classList.toggle('active', !!current && Number(r.dataset.i) === current.i);
  }

  // ---------- YouTube IFrame API ----------
  const YTS = { state: 'idle', waiters: [] };
  window.onYouTubeIframeAPIReady = () => { YTS.state = 'ready'; YTS.waiters.splice(0).forEach((f) => f(true)); };
  function ytReady() {
    return new Promise((resolve) => {
      if (YTS.state === 'ready') { resolve(true); return; }
      if (YTS.state === 'failed') { resolve(false); return; }
      YTS.waiters.push(resolve);
      if (YTS.state === 'idle') {
        YTS.state = 'loading';
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => { YTS.state = 'failed'; YTS.waiters.splice(0).forEach((f) => f(false)); };
        document.head.appendChild(s);
        setTimeout(() => { if (YTS.state !== 'ready') { YTS.state = 'failed'; YTS.waiters.splice(0).forEach((f) => f(false)); } }, 10000);
      }
    });
  }
  const PLAYER_VARS = { autoplay: 1, mute: 1, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1 };
  function plainIframe(v, title) {
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v) + '?autoplay=1&mute=1&playsinline=1&rel=0';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true; f.title = title || '';
    return f;
  }
  function vidOf(p) { try { return p.getVideoData().video_id; } catch (e) { return null; } }

  // ---------- 1台表示（パネル） ----------
  const single = { player: null, ready: false, cam: null };
  function destroySingle() {
    if (single.player && single.player.destroy) { try { single.player.destroy(); } catch (e) { /* 無視 */ } }
    single.player = null; single.ready = false; single.cam = null;
    E.player.replaceChildren();
    hideNote();
  }
  function hideNote() { E.note.hidden = true; E.note.replaceChildren(); }
  function showNote(msg, actions) {
    E.note.replaceChildren(el('span', null, msg));
    for (const a of actions || []) E.note.appendChild(a);
    E.note.hidden = false;
  }
  function noteButton(label, fn) { const b = el('button', null, label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function noteLink(label, href) { const a = el('a', null, label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }

  async function playSingle(cam) {
    hideNote();
    single.cam = cam;
    if (cam.f & F_NOEMBED) {
      if (single.player) destroySingle();
      single.cam = cam;
      E.player.replaceChildren(Object.assign(el('img'), { src: thumb(cam), alt: '', style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5' }));
      showNote(t('player.noembed'), [noteLink(t('openYoutube'), ytWatch(cam.v))]);
      return;
    }
    const ok = await ytReady();
    if (single.cam !== cam) return;
    if (!ok) { E.player.replaceChildren(plainIframe(cam.v, cam.name)); return; }
    if (single.player && single.ready) { single.player.loadVideoById(cam.v); return; }
    if (single.player) return; // 準備中: onReady で最新のカメラを読む
    const host = el('div');
    E.player.replaceChildren(host);
    single.player = new YT.Player(host, {
      host: 'https://www.youtube-nocookie.com', videoId: cam.v, playerVars: PLAYER_VARS,
      events: {
        onReady: (e) => {
          single.ready = true;
          if (single.cam && vidOf(e.target) !== single.cam.v) e.target.loadVideoById(single.cam.v);
          e.target.mute(); e.target.playVideo();
        },
        onError: (e) => onSingleError(e.data),
        onStateChange: (e) => { if (e.data === 0) showNote(t('player.ended'), channelFallbackActions(single.cam)); },
      },
    });
  }
  function channelFallbackActions(cam) {
    const acts = [];
    if (cam && CHANNELS[cam.ch]) acts.push(noteButton(t('player.tryChannel'), () => mountChannelLive(cam)));
    if (cam) acts.push(noteLink(t('openYoutube'), ytWatch(cam.v)));
    return acts;
  }
  function mountChannelLive(cam) {
    const ch = CHANNELS[cam.ch]; if (!ch) return;
    destroySingle();
    single.cam = cam;
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/live_stream?channel=' + encodeURIComponent(ch[0]) + '&autoplay=1&mute=1&playsinline=1';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true;
    E.player.replaceChildren(f);
    showNote(t('player.switchedChannel'));
  }
  function onSingleError(code) {
    const cam = single.cam; if (!cam) return;
    markBad(cam.id);
    if (AUTO.sec) { showNote(t('player.skipping')); setTimeout(() => { if (single.cam === cam) randomSingle(); }, 1500); return; }
    if (code === 101 || code === 150) showNote(t('player.noembed'), [noteLink(t('openYoutube'), ytWatch(cam.v))]);
    else if (code === 100 || code === 2) showNote(t('player.gone'), channelFallbackActions(cam));
    else showNote(t('player.error', { code }), channelFallbackActions(cam));
  }

  function openCamera(cam, opts) {
    opts = opts || {};
    if (clusterPop) clusterPop.remove();
    current = cam;
    E.pName.textContent = cam.name;
    E.pPlace.textContent = flag(cam.cc) + ' ' + placeText(cam) + (cam.f & F_APPROX ? ' · ' + t('approx') : '') +
      (cam.w > 0 ? ' · ' + t('viewers', { n: compactFmt ? compactFmt.format(cam.w) : cam.w }) : '');
    E.pCat.textContent = t('cat.' + cam.cat);
    E.pCat.style.setProperty('--c', CAT_COLORS[cam.cat]);
    E.pTitle.textContent = cam.title && cam.title !== cam.name ? t('panel.streamTitle', { title: cam.title }) : '';
    E.linkYt.href = ytWatch(cam.v);
    const ch = CHANNELS[cam.ch];
    E.linkCh.hidden = !ch;
    if (ch) { E.linkCh.href = 'https://www.youtube.com/channel/' + encodeURIComponent(ch[0]); E.linkCh.textContent = ch[1] || t('channel'); E.linkCh.title = t('channel'); }
    const wasOpen = E.panel.classList.contains('open');
    E.panel.classList.add('open');
    if (!wasOpen) E.panel.scrollTop = 0;
    playSingle(cam);
    renderNearby(cam);
    const sel = map.getSource('wlc-sel'); if (sel) sel.setData(selGeojson());
    markActiveRows();
    if (location.hash !== '#cam=' + cam.id) history.replaceState(null, '', location.pathname + location.search + '#cam=' + cam.id);
    document.title = cam.name + ' | ' + t('app.name');
    if (opts.fly) map.flyTo({ center: [cam.lng, cam.lat], zoom: Math.max(map.getZoom(), 11), padding: panelPadding(), speed: 1.6, essential: true });
    else if (opts.fromMap) map.easeTo({ center: [cam.lng, cam.lat], padding: panelPadding(), duration: 500 });
    if (isMobile()) E.sidebar.classList.remove('open');
    restartAuto();
  }
  function closePanel() {
    E.panel.classList.remove('open');
    destroySingle();
    current = null;
    const sel = map.getSource('wlc-sel'); if (sel) sel.setData(selGeojson());
    markActiveRows();
    if (location.hash.startsWith('#cam=')) history.replaceState(null, '', location.pathname + location.search);
    document.title = t('app.name');
    restartAuto();
  }

  function renderNearby(cam) {
    const R = Math.PI / 180, best = [];
    const cl = Math.cos(cam.lat * R);
    for (const c of CAMS) {
      if (c === cam) continue;
      const dx = (c.lng - cam.lng) * cl, dy = c.lat - cam.lat, d2 = dx * dx + dy * dy;
      if (best.length < 8 || d2 < best[best.length - 1][0]) {
        best.push([d2, c]); best.sort((a, b) => a[0] - b[0]);
        if (best.length > 8) best.pop();
      }
    }
    const frag = document.createDocumentFragment();
    for (const [, c] of best) {
      const km = haversine(cam, c);
      const dist = km < 1 ? fmt(Math.round(km * 1000)) + ' m' : fmt(Math.round(km * (km < 10 ? 10 : 1)) / (km < 10 ? 10 : 1)) + ' km';
      frag.appendChild(camRow(c, dist + ' · ' + flag(c.cc) + ' ' + placeText(c)));
    }
    E.nearby.replaceChildren(frag);
  }
  function haversine(a, b) {
    const R = 6371, p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ---------- ランダム ----------
  function randomPool(exclude) {
    return FILTERED.filter((c) => !(c.f & (F_NOEMBED | F_OFFLINE)) && !BAD.has(c.id) && !(exclude && exclude.has(c.id)));
  }
  function pickRandom(k, exclude) {
    const arr = randomPool(exclude), n = arr.length, out = [];
    for (let j = 0; j < Math.min(k, n); j++) {
      const r = j + Math.floor(Math.random() * (n - j));
      const tmp = arr[j]; arr[j] = arr[r]; arr[r] = tmp;
      out.push(arr[j]);
    }
    return out;
  }
  function randomSingle() {
    const ex = new Set(current ? [current.id] : []);
    const c = pickRandom(1, ex)[0] || pickRandom(1)[0];
    if (!c) { toast(t('random.none')); return; }
    openCamera(c, { fly: true });
  }

  // ---------- マルチビュー ----------
  const savedMulti = store.get('multi', null);
  const M = {
    open: false, n: 4, slots: new Array(MAX_SLOTS).fill(null), origin: new Array(MAX_SLOTS).fill('manual'),
    players: new Array(MAX_SLOTS).fill(null), ready: new Array(MAX_SLOTS).fill(false), retries: new Array(MAX_SLOTS).fill(0),
    els: new Array(MAX_SLOTS).fill(null), target: null, solo: null, audio: null,
  };
  if (savedMulti && LAYOUTS.some((l) => l.n === savedMulti.n)) M.n = savedMulti.n;

  function saveMulti() {
    store.set('multi', { n: M.n, slots: M.slots });
    const filled = M.slots.slice(0, M.n).filter(Boolean).length;
    E.multiCount.textContent = fmt(filled); E.multiCount.hidden = filled === 0;
    if (M.open) history.replaceState(null, '', location.pathname + location.search + '#multi=' + M.n + ':' + M.slots.slice(0, M.n).map((x) => x || '').join(','));
  }
  function buildLayoutSeg() {
    E.layoutSeg.replaceChildren();
    for (const L of LAYOUTS) {
      const b = el('button', null, L.c + '×' + L.r); b.type = 'button'; b.dataset.n = L.n;
      b.title = t('multi.layoutN', { n: L.n }); b.setAttribute('role', 'radio');
      E.layoutSeg.appendChild(b);
    }
    syncLayoutSeg();
  }
  function syncLayoutSeg() {
    for (const b of E.layoutSeg.children) { const on = Number(b.dataset.n) === M.n; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); }
  }
  E.layoutSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setLayout(Number(b.dataset.n));
  });
  function setLayout(n) {
    if (n === M.n) return;
    M.n = n; M.solo = null;
    if (M.audio != null && M.audio >= n) M.audio = null;
    if (M.target != null && M.target >= n) M.target = null;
    syncLayoutSeg();
    ensureSlots();
    for (let i = 0; i < n; i++) if (M.slots[i] && !M.players[i]) loadSlot(i);
    saveMulti();
    if (n === 16) toast(t('multi.heavy'));
  }

  function buildSlotEl(i) {
    const s = el('div', 'slot'); s.dataset.i = i;
    s.innerHTML =
      '<div class="slot-body"></div><div class="slot-veil"></div><div class="slot-tag" dir="auto"></div>' +
      '<div class="slot-head"><span class="slot-num"></span><span class="slot-name" dir="auto"></span>' +
      '<button type="button" class="slot-btn" data-act="audio">🔇</button>' +
      '<button type="button" class="slot-btn" data-act="solo">⤢</button>' +
      '<button type="button" class="slot-btn" data-act="random">🎲</button>' +
      '<button type="button" class="slot-btn" data-act="swap">⇄</button>' +
      '<a class="slot-btn" data-act="yt" target="_blank" rel="noopener">▶</a>' +
      '<button type="button" class="slot-btn" data-act="remove">✕</button></div>' +
      '<button type="button" class="slot-empty" data-act="pick"><b></b><small></small></button>' +
      '<div class="slot-msg" hidden></div>';
    s.querySelector('.slot-num').textContent = fmt(i + 1);
    return s;
  }
  function ensureSlots() {
    const L = LAYOUTS.find((l) => l.n === M.n);
    E.grid.style.setProperty('--cols', L.c);
    E.grid.style.setProperty('--rows', L.r);
    E.grid.style.setProperty('--mcols', M.n >= 6 ? 2 : 1);
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (i < M.n) {
        if (!M.els[i]) { M.els[i] = buildSlotEl(i); E.grid.appendChild(M.els[i]); }
        updateSlotUI(i);
      } else if (M.els[i]) {
        destroySlotPlayer(i); M.els[i].remove(); M.els[i] = null;
      }
    }
    E.grid.classList.toggle('solo', M.solo != null);
  }
  function updateSlotUI(i) {
    const s = M.els[i]; if (!s) return;
    const cam = M.slots[i] ? BYID.get(M.slots[i]) : null;
    s.classList.toggle('target', M.target === i);
    s.classList.toggle('big', M.solo === i);
    const empty = s.querySelector('.slot-empty');
    empty.hidden = !!cam;
    empty.querySelector('b').textContent = t('multi.emptySlot', { n: fmt(i + 1) });
    empty.querySelector('small').textContent = t('multi.emptyHint');
    s.querySelector('.slot-head').hidden = !cam;
    s.querySelector('.slot-tag').hidden = !cam;
    if (cam) {
      const nm = s.querySelector('.slot-name');
      nm.replaceChildren(document.createTextNode(cam.name), el('small', null, flag(cam.cc) + ' ' + placeText(cam)));
      s.querySelector('.slot-tag').textContent = flag(cam.cc) + ' ' + cam.name;
      const yt = s.querySelector('[data-act="yt"]'); yt.href = ytWatch(cam.v); yt.title = t('openYoutube');
    }
    const au = s.querySelector('[data-act="audio"]');
    au.textContent = M.audio === i ? '🔊' : '🔇'; au.classList.toggle('on', M.audio === i);
    au.title = M.audio === i ? t('slot.mute') : t('slot.unmute');
    const so = s.querySelector('[data-act="solo"]'); so.classList.toggle('on', M.solo === i); so.title = t('slot.solo');
    s.querySelector('[data-act="random"]').title = t('slot.random');
    s.querySelector('[data-act="swap"]').title = t('slot.swap');
    s.querySelector('[data-act="remove"]').title = t('slot.remove');
  }
  function slotMsg(i, msg, cam) {
    const s = M.els[i]; if (!s) return;
    const box = s.querySelector('.slot-msg');
    if (!msg) { box.hidden = true; box.replaceChildren(); return; }
    box.replaceChildren(el('b', null, msg));
    const row = el('div');
    const rb = el('button', 'pill-btn', '🎲 ' + t('slot.random')); rb.type = 'button'; rb.dataset.act = 'random';
    row.appendChild(rb);
    if (cam) { const a = el('a', 'pill-btn ghost-dark', '▶ YouTube'); a.href = ytWatch(cam.v); a.target = '_blank'; a.rel = 'noopener'; row.append(' ', a); }
    box.appendChild(row);
    box.hidden = false;
  }
  function destroySlotPlayer(i) {
    const p = M.players[i];
    if (p && p.destroy) { try { p.destroy(); } catch (e) { /* 無視 */ } }
    M.players[i] = null; M.ready[i] = false;
    if (M.els[i]) M.els[i].querySelector('.slot-body').replaceChildren();
  }
  function setSlot(i, cam, origin) {
    M.slots[i] = cam ? cam.id : null;
    M.origin[i] = origin || 'manual';
    slotMsg(i, null);
    if (!cam) { destroySlotPlayer(i); updateSlotUI(i); return; }
    updateSlotUI(i);
    loadSlot(i);
  }
  async function loadSlot(i) {
    const cam = BYID.get(M.slots[i]);
    const s = M.els[i];
    if (!cam || !s) return;
    if (cam.f & F_NOEMBED) { destroySlotPlayer(i); slotMsg(i, t('player.noembed'), cam); return; }
    const ok = await ytReady();
    if (!M.open || M.slots[i] !== cam.id || !M.els[i]) return;
    if (!ok) { s.querySelector('.slot-body').replaceChildren(plainIframe(cam.v, cam.name)); return; }
    const p = M.players[i];
    if (p && M.ready[i]) {
      p.loadVideoById(cam.v);
      if (M.audio === i) p.unMute(); else p.mute();
      return;
    }
    if (p) return; // 準備中: onReady で最新を読む
    const host = el('div');
    s.querySelector('.slot-body').replaceChildren(host);
    M.players[i] = new YT.Player(host, {
      host: 'https://www.youtube-nocookie.com', videoId: cam.v, playerVars: PLAYER_VARS,
      events: {
        onReady: (e) => {
          M.ready[i] = true;
          const want = M.slots[i] && BYID.get(M.slots[i]);
          if (want && vidOf(e.target) !== want.v) e.target.loadVideoById(want.v);
          if (M.audio === i) e.target.unMute(); else e.target.mute();
          e.target.playVideo();
        },
        onError: (e) => onSlotError(i, e.data, e.target),
      },
    });
  }
  function onSlotError(i, code, player) {
    const cam = M.slots[i] && BYID.get(M.slots[i]);
    if (!cam) return;
    const vid = vidOf(player);
    if (vid && vid !== cam.v) return;
    markBad(cam.id);
    if ((M.origin[i] === 'random' || AUTO.sec) && M.retries[i] < 4) {
      M.retries[i]++;
      const rep = pickRandom(1, new Set(M.slots.filter(Boolean)))[0];
      if (rep) { setSlot(i, rep, 'random'); return; }
    }
    slotMsg(i, code === 101 || code === 150 ? t('player.noembed') : code === 100 || code === 2 ? t('player.gone') : t('player.error', { code }), cam);
  }
  function shuffleAll() {
    const picked = pickRandom(M.n);
    if (!picked.length) { toast(t('random.none')); return; }
    M.retries.fill(0);
    if (M.audio != null) M.audio = null;
    M.target = null;
    E.pickHint.hidden = true;
    for (let i = 0; i < M.n; i++) setSlot(i, picked[i] || null, 'random');
    saveMulti();
    if (picked.length < M.n) toast(t('multi.fewer', { n: fmt(picked.length) }));
    restartAuto();
  }
  function setAudio(i) {
    M.audio = M.audio === i ? null : i;
    for (let k = 0; k < M.n; k++) {
      const p = M.players[k];
      if (p && M.ready[k]) { try { if (k === M.audio) { p.unMute(); p.setVolume(100); } else p.mute(); } catch (e) { /* 無視 */ } }
      updateSlotUI(k);
    }
  }
  function setTarget(i) {
    M.target = i;
    for (let k = 0; k < M.n; k++) updateSlotUI(k);
    E.pickHint.textContent = t('multi.pickHint', { n: fmt(i + 1) });
    E.pickHint.hidden = false;
    E.sidebar.classList.add('open');
    if (!isMobile()) E.search.focus();
  }
  E.grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const s = b.closest('.slot'); if (!s) return;
    const i = Number(s.dataset.i), act = b.dataset.act;
    if (act === 'yt') return;
    e.preventDefault();
    if (act === 'audio') setAudio(i);
    else if (act === 'solo') { M.solo = M.solo === i ? null : i; ensureSlots(); }
    else if (act === 'random') {
      const rep = pickRandom(1, new Set(M.slots.filter(Boolean)))[0];
      if (rep) { M.retries[i] = 0; setSlot(i, rep, 'random'); saveMulti(); } else toast(t('random.none'));
    } else if (act === 'swap' || act === 'pick') setTarget(i);
    else if (act === 'remove') {
      if (M.solo === i) M.solo = null;
      if (M.audio === i) M.audio = null;
      setSlot(i, null); ensureSlots(); saveMulti();
    }
  });

  function openMulti() {
    if (!M.open) {
      M.open = true;
      if (E.panel.classList.contains('open')) closePanel();
      E.multi.hidden = false;
      E.btnMulti.classList.add('active');
      document.title = t('multi') + ' | ' + t('app.name');
    }
    syncLayoutSeg();
    ensureSlots();
    for (let i = 0; i < M.n; i++) if (M.slots[i] && !M.players[i]) loadSlot(i);
    saveMulti();
    const filled = M.slots.slice(0, M.n).filter(Boolean).length;
    if (!filled) setTarget(0);
    restartAuto();
  }
  function closeMulti() {
    M.open = false; M.target = null; M.solo = null; M.audio = null;
    for (let i = 0; i < MAX_SLOTS; i++) { destroySlotPlayer(i); if (M.els[i]) { M.els[i].remove(); M.els[i] = null; } }
    E.multi.hidden = true;
    E.btnMulti.classList.remove('active');
    E.pickHint.hidden = true;
    if (location.hash.startsWith('#multi=')) history.replaceState(null, '', location.pathname + location.search);
    document.title = t('app.name');
    map.resize();
    restartAuto();
  }
  function addToMulti(cam) {
    if (!M.open) openMulti();
    const inSlot = M.slots.slice(0, M.n).indexOf(cam.id);
    if (inSlot >= 0) { toast(t('multi.already', { name: cam.name, n: fmt(inSlot + 1) })); return; }
    let i = M.target != null ? M.target : M.slots.slice(0, M.n).indexOf(null);
    if (i < 0) i = M.n - 1;
    setSlot(i, cam, 'manual');
    const next = M.slots.slice(0, M.n).indexOf(null);
    M.target = null;
    if (next >= 0 && E.sidebar.classList.contains('open') && !isMobile()) setTarget(next);
    else { E.pickHint.hidden = true; for (let k = 0; k < M.n; k++) updateSlotUI(k); if (isMobile() || next < 0) E.sidebar.classList.remove('open'); }
    saveMulti();
    toast(t('multi.added', { name: cam.name, n: fmt(i + 1) }));
  }
  E.btnMulti.addEventListener('click', () => (M.open ? closeMulti() : openMulti()));
  $('#multi-close').addEventListener('click', closeMulti);
  $('#multi-random').addEventListener('click', shuffleAll);
  $('#multi-clear').addEventListener('click', () => {
    M.solo = null; M.audio = null;
    for (let i = 0; i < MAX_SLOTS; i++) M.slots[i] = null;
    for (let i = 0; i < M.n; i++) setSlot(i, null);
    ensureSlots(); saveMulti(); setTarget(0);
  });
  $('#multi-share').addEventListener('click', () => copyText(shareBase() + '#multi=' + M.n + ':' + M.slots.slice(0, M.n).map((x) => x || '').join(','), t('copied')));
  $('#btn-add-multi').addEventListener('click', () => { if (current) addToMulti(current); });

  // ---------- 自動切り替え ----------
  const AUTO = { sec: AUTO_CHOICES.includes(store.get('auto', 0)) ? store.get('auto', 0) : 0, timer: null };
  function buildAutoSelects() {
    for (const sel of [E.multiAuto, E.panelAuto]) {
      sel.replaceChildren(...AUTO_CHOICES.map((s) => new Option(s === 0 ? t('auto.off') : s < 60 ? t('auto.sec', { n: fmt(s) }) : t('auto.min', { n: fmt(s / 60) }), s)));
      sel.value = AUTO.sec;
    }
  }
  function onAutoChange(e) {
    AUTO.sec = Number(e.target.value);
    store.set('auto', AUTO.sec);
    E.multiAuto.value = E.panelAuto.value = AUTO.sec;
    restartAuto();
  }
  E.multiAuto.addEventListener('change', onAutoChange);
  E.panelAuto.addEventListener('change', onAutoChange);
  function restartAuto() {
    clearTimeout(AUTO.timer);
    const bar = M.open ? E.multiProg : E.panelProg;
    for (const b of [E.multiProg, E.panelProg]) { b.hidden = b !== bar || !AUTO.sec; }
    const active = AUTO.sec && (M.open || E.panel.classList.contains('open'));
    const i = bar.firstElementChild;
    i.style.transition = 'none'; i.style.width = '0';
    if (!active) return;
    void i.offsetWidth;
    i.style.transition = 'width ' + AUTO.sec + 's linear'; i.style.width = '100%';
    AUTO.timer = setTimeout(() => {
      if (document.hidden) { restartAuto(); return; }
      if (M.open) shuffleAll();
      else if (E.panel.classList.contains('open')) randomSingle();
    }, AUTO.sec * 1000);
  }

  // ---------- 言語メニュー ----------
  function buildLangMenu() {
    E.langMenu.replaceChildren();
    for (const [code, native, english] of LANGS) {
      const b = el('button'); b.type = 'button'; b.dataset.code = code; b.setAttribute('role', 'option');
      b.classList.toggle('active', code === lang);
      b.setAttribute('aria-selected', code === lang);
      const nm = el('span', null, native); nm.lang = code;
      b.append(nm, el('small', null, english));
      E.langMenu.appendChild(b);
    }
  }
  function toggleLangMenu(open) {
    const want = open != null ? open : E.langMenu.hidden;
    E.langMenu.hidden = !want;
    E.langBtn.setAttribute('aria-expanded', want);
  }
  E.langBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLangMenu(); });
  E.langMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    toggleLangMenu(false);
    setLang(b.dataset.code);
  });
  document.addEventListener('click', (e) => { if (!E.langMenu.hidden && !e.target.closest('.lang-wrap')) toggleLangMenu(false); });

  async function setLang(code, initial) {
    await loadLang('en');
    if (code !== 'en') await loadLang(code);
    lang = I18N[code] ? code : 'en';
    store.set('lang', lang);
    const url = new URL(location.href);
    if (lang === 'en') url.searchParams.delete('lang'); else url.searchParams.set('lang', lang);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    setLocaleObjects();
    const root = document.documentElement;
    root.lang = lang;
    root.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
    for (const n of document.querySelectorAll('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
    for (const n of document.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
    for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
    E.langBtn.querySelector('#lang-label').textContent = LANGS.find((l) => l[0] === lang)[1];
    buildLangMenu();
    buildAutoSelects();
    buildLayoutSeg();
    styleCtl.update();
    if (styleReady) localizeLabels();
    if (!CAMS.length) { document.title = t('app.name'); E.loadingText.textContent = t('loading'); return; }
    rebuildHays();
    buildCatBar();
    buildCountrySelect();
    applyFilter();
    updateFoot();
    for (let i = 0; i < M.n; i++) updateSlotUI(i);
    if (current) openCamera(current);
    else document.title = M.open ? t('multi') + ' | ' + t('app.name') : t('app.name');
    if (!initial) E.search.placeholder = t('search.placeholder');
  }
  function updateFoot() {
    let date = UPDATED;
    try { date = new Intl.DateTimeFormat(lang === 'jv' ? 'id' : lang, { dateStyle: 'medium' }).format(new Date(UPDATED + 'T00:00:00')); } catch (e) { /* そのまま */ }
    E.foot.replaceChildren(
      el('span', null, t('foot.data', { date, n: fmt(CAMS.length) })), el('br'),
      el('span', null, t('foot.credit')), el('br'),
      Object.assign(el('a', null, '© OpenMapTiles'), { href: 'https://www.openmaptiles.org/', target: '_blank', rel: 'noopener' }), ' ',
      Object.assign(el('a', null, '© OpenStreetMap'), { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }), ' · ',
      Object.assign(el('a', null, 'OpenFreeMap'), { href: 'https://openfreemap.org/', target: '_blank', rel: 'noopener' }), ' · ',
      Object.assign(el('a', null, 'GeoNames'), { href: 'https://www.geonames.org/', target: '_blank', rel: 'noopener' }), ' · ',
      Object.assign(el('a', null, 'Cloudflare Web Analytics'), { href: 'https://www.cloudflare.com/web-analytics/', target: '_blank', rel: 'noopener' }),
    );
  }

  // ---------- その他の操作 ----------
  $('#btn-list').addEventListener('click', () => { E.sidebar.classList.toggle('open'); if (E.sidebar.classList.contains('open')) drawRows(); });
  $('#btn-close-list').addEventListener('click', () => { E.sidebar.classList.remove('open'); M.target = null; E.pickHint.hidden = true; for (let k = 0; k < M.n; k++) updateSlotUI(k); });
  $('#btn-close-panel').addEventListener('click', closePanel);
  $('#btn-random').addEventListener('click', () => { if (M.open) shuffleAll(); else randomSingle(); });
  $('#btn-next').addEventListener('click', randomSingle);
  $('#btn-share').addEventListener('click', () => { if (current) copyText(shareBase() + '#cam=' + current.id, t('copied')); });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (!E.langMenu.hidden) toggleLangMenu(false);
      else if (clusterPop && clusterPop.isOpen()) clusterPop.remove();
      else if (M.open && M.solo != null) { M.solo = null; ensureSlots(); }
      else if (M.open) closeMulti();
      else if (E.panel.classList.contains('open')) closePanel();
      else E.sidebar.classList.remove('open');
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); E.search.focus(); }
    else if (e.key === 'r') { if (M.open) shuffleAll(); else randomSingle(); }
    else if (e.key === 'm') { if (M.open) closeMulti(); else openMulti(); }
  });
  window.addEventListener('resize', debounce(() => refreshList(false), 150));
  window.addEventListener('hashchange', () => readHash());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) restartAuto(); });

  function readHash() {
    const h = location.hash;
    let m = h.match(/^#multi=(\d+):?([\w,-]*)/);
    if (m) {
      const n = Number(m[1]);
      M.n = LAYOUTS.some((l) => l.n === n) ? n : 4;
      const ids = m[2].split(',');
      for (let i = 0; i < MAX_SLOTS; i++) M.slots[i] = i < M.n && BYID.has(ids[i]) ? ids[i] : null;
      if (M.open) { for (let i = 0; i < M.n; i++) { destroySlotPlayer(i); } }
      openMulti();
      return true;
    }
    m = h.match(/^#cam=([\w-]+)/);
    if (m && BYID.has(m[1])) {
      if (M.open) closeMulti();
      const cam = BYID.get(m[1]);
      if (current !== cam) openCamera(cam, { fly: true });
      return true;
    }
    return false;
  }

  // ---------- 起動 ----------
  function loadData() {
    return fetch('data/cameras.json?v=' + VERSION).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((d) => {
      UPDATED = d.updated || '';
      CHANNELS = d.channels || [];
      const col = {};
      d.cols.forEach((c, k) => { col[c] = k; });
      const cats = d.cats;
      CAMS = d.rows.map((r) => ({
        id: r[col.id], v: r[col.v] || r[col.id], lat: r[col.lat], lng: r[col.lng], cat: cats[r[col.cat]] || 'other',
        cc: r[col.cc] || '', ch: r[col.ch], name: r[col.name] || '', place: r[col.place] || '', title: r[col.title] || '',
        f: r[col.f] || 0, w: r[col.w] || 0,
      })).filter((c) => YT_ID.test(c.v));
      CAMS.sort((a, b) => b.w - a.w);
      CAMS.forEach((c, k) => { c.i = k; BYID.set(c.id, c); });
    });
  }

  // 動作確認用（?debug=1 のときだけ内部状態を公開）
  if (new URLSearchParams(location.search).has('debug')) window.__wlc = { M, single, map, get cams() { return CAMS; } };

  (async function boot() {
    const want = detectLang();
    await setLang(want, true);
    if (savedMulti && Array.isArray(savedMulti.slots)) for (let i = 0; i < MAX_SLOTS; i++) M.slots[i] = savedMulti.slots[i] || null;
    try {
      await loadData();
    } catch (err) {
      E.loadingText.textContent = t('loading.error');
      E.loading.querySelector('.spinner').hidden = true;
      return;
    }
    for (let i = 0; i < MAX_SLOTS; i++) if (M.slots[i] && !BYID.has(M.slots[i])) M.slots[i] = null;
    await setLang(lang, true);
    E.loading.hidden = true;
    const src = map.getSource('wlc-cams');
    if (src) src.setData(geojson(FILTERED));
    saveMulti();
    if (!readHash() && !isMobile()) E.sidebar.classList.add('open');
    map.once('idle', () => refreshList(false));
  })();
})();
