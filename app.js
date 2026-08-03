/* Stoplume — client-side optics engine. No network, no tracking. */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- i18n */
  var LANG = 'en';
  function L(en, zh) { return LANG === 'zh' ? zh : en; }

  function applyLang() {
    document.documentElement.setAttribute('data-lang', LANG);
    document.documentElement.setAttribute('lang', LANG === 'zh' ? 'zh-CN' : 'en');
    var nodes = document.querySelectorAll('[data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], v = n.getAttribute(LANG === 'zh' ? 'data-zh' : 'data-en');
      if (v === null) continue;
      if (n.tagName === 'TITLE') { document.title = v; }
      else if (n.tagName === 'META') { n.setAttribute('content', v); }
      else if (n.tagName === 'OPTION') { n.textContent = v; }
      else if (v.indexOf('<') >= 0) { n.innerHTML = v; }
      else { n.textContent = v; }
    }
    var lb = document.getElementById('lang-btn');
    if (lb) lb.textContent = LANG === 'zh' ? 'EN' : '中文';
    renderAll();
  }

  /* -------------------------------------------------------------- helpers */
  function $(id) { return document.getElementById(id); }
  function num(id, dflt) { var e = $(id); if (!e) return dflt; var v = parseFloat(e.value); return isFinite(v) ? v : dflt; }
  function val(id, dflt) { var e = $(id); return e ? e.value : dflt; }
  function fmt(v, d) {
    if (!isFinite(v)) return '∞';
    d = d === undefined ? 2 : d;
    var a = Math.abs(v);
    if (a !== 0 && a < 0.001) return v.toExponential(2);
    return v.toFixed(d).replace(/\.?0+$/, function (m) { return m.indexOf('.') === 0 ? '' : m; });
  }
  function fmtSig(v) {
    if (!isFinite(v)) return '∞';
    var a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 10) return v.toFixed(2);
    if (a >= 1) return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }

  /* shutter parsing / formatting */
  function parseShutter(s) {
    if (s === undefined || s === null) return NaN;
    s = String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/"|”|s$|sec$|seconds?$/g, '');
    if (!s) return NaN;
    if (s.indexOf('/') >= 0) {
      var p = s.split('/');
      var a = parseFloat(p[0]), b = parseFloat(p[1]);
      if (!isFinite(a) || !isFinite(b) || b === 0) return NaN;
      return a / b;
    }
    var v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }
  function fmtShutter(t) {
    if (!isFinite(t) || t <= 0) return '—';
    if (t < 0.7) {
      var d = 1 / t;
      return '1/' + (d >= 10 ? Math.round(d) : d.toFixed(1).replace(/\.0$/, ''));
    }
    if (t < 60) return fmt(t, 2) + ' s';
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var o = [];
    if (h) o.push(h + ' h');
    if (m) o.push(m + ' min');
    if (s >= 0.5 || (!h && !m)) o.push(Math.round(s) + ' s');
    return o.join(' ');
  }

  var STD_AP = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45];
  var STD_SH = [1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000,
    1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50,
    1 / 40, 1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1,
    1.3, 1.6, 2, 2.5, 3.2, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30];
  var STD_ISO = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200,
    4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200, 64000, 80000, 102400];
  function nearest(arr, v) {
    var best = arr[0], bd = Infinity;
    for (var i = 0; i < arr.length; i++) { var d = Math.abs(Math.log(arr[i]) - Math.log(v)); if (d < bd) { bd = d; best = arr[i]; } }
    return best;
  }

  /* ------------------------------------------------------- camera profile */
  var SENSORS = {
    ff: { n: 'Full Frame 36 × 24', w: 36, h: 24 },
    apsc: { n: 'APS-C 23.5 × 15.6', w: 23.5, h: 15.6 },
    apsc_c: { n: 'APS-C 22.3 × 14.9 (Canon)', w: 22.3, h: 14.9 },
    apsh: { n: 'APS-H 27.9 × 18.6', w: 27.9, h: 18.6 },
    mft: { n: 'Micro Four Thirds 17.3 × 13.0', w: 17.3, h: 13.0 },
    one: { n: '1" type 13.2 × 8.8', w: 13.2, h: 8.8 },
    gfx: { n: 'Medium format 43.8 × 32.9', w: 43.8, h: 32.9 },
    s35: { n: 'Super 35 cine 24.89 × 18.66', w: 24.89, h: 18.66 },
    smaller: { n: '1/1.28" phone 9.8 × 7.3', w: 9.8, h: 7.3 },
    custom: { n: 'Custom', w: 36, h: 24 }
  };
  var FF_DIAG = Math.sqrt(36 * 36 + 24 * 24); // 43.2666

  var CAM = { key: 'ff', w: 36, h: 24, mp: 24 };

  function camDerived(c) {
    var diag = Math.sqrt(c.w * c.w + c.h * c.h);
    var crop = FF_DIAG / diag;
    var aspect = c.w / c.h;
    var pxW = Math.sqrt(c.mp * 1e6 * aspect);
    var pxH = pxW / aspect;
    var pitch = c.w / pxW;              // mm
    return { diag: diag, crop: crop, pxW: Math.round(pxW), pxH: Math.round(pxH), pitch: pitch, pitchUm: pitch * 1000, aspect: aspect };
  }
  function sensorOf(key) {
    if (key === 'custom') return { w: CAM.w, h: CAM.h, n: L('Custom', '自定义') };
    var s = SENSORS[key] || SENSORS.ff; return { w: s.w, h: s.h, n: s.n };
  }

  function loadCam() {
    try {
      var raw = localStorage.getItem('stoplume.cam');
      if (raw) { var o = JSON.parse(raw); if (o && o.key) CAM = { key: o.key, w: +o.w || 36, h: +o.h || 24, mp: +o.mp || 24 }; }
    } catch (e) { }
  }
  function saveCam() { try { localStorage.setItem('stoplume.cam', JSON.stringify(CAM)); } catch (e) { } }

  function syncCamUI() {
    var sel = $('cam-sensor'); if (!sel) return;
    sel.value = CAM.key;
    $('cam-w').value = CAM.w; $('cam-h').value = CAM.h; $('cam-mp').value = CAM.mp;
    var isC = CAM.key === 'custom';
    $('cam-custom-w').hidden = !isC; $('cam-custom-h').hidden = !isC;
    var d = camDerived(CAM);
    $('cam-derived').innerHTML =
      '<span>' + L('Diagonal', '对角线') + ' <b>' + fmt(d.diag, 2) + ' mm</b></span>' +
      '<span>' + L('Crop factor', '等效系数') + ' <b>' + fmt(d.crop, 2) + '×</b></span>' +
      '<span>' + L('Pixels', '像素') + ' <b>' + d.pxW + ' × ' + d.pxH + '</b></span>' +
      '<span>' + L('Pixel pitch', '像素间距') + ' <b>' + fmt(d.pitchUm, 2) + ' µm</b></span>';
    var chips = document.querySelectorAll('.camchip-name');
    var s = sensorOf(CAM.key);
    for (var i = 0; i < chips.length; i++) {
      chips[i].textContent = (CAM.key === 'custom' ? (fmt(CAM.w, 2) + ' × ' + fmt(CAM.h, 2) + ' mm') : s.n) + ' · ' + fmt(CAM.mp, 0) + ' MP';
    }
  }

  /* --------------------------------------------------------- render utils */
  function group(title, rows, extra) {
    var h = '<div class="res-group"><h4>' + esc(title) + '</h4>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r === null) continue;
      if (r.raw) { h += r.raw; continue; }
      h += '<div class="res-row' + (r.big ? ' big' : '') + '"><span class="k">' + esc(r.k) + '</span>' +
        '<span class="v' + (r.cls ? ' ' + r.cls : '') + '">' + r.v + '</span></div>';
    }
    if (extra) h += extra;
    return h + '</div>';
  }
  function note(text, cls) { return '<div class="res-note' + (cls ? ' ' + cls : '') + '">' + text + '</div>'; }
  function svg(id, inner, w, h) {
    var e = $(id + '-svg'); if (!e) return;
    e.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="diagram" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  }
  function cap(id, t) { var e = $(id + '-cap'); if (e) e.textContent = t; }
  function css(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';
  }
  function txt(x, y, s, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" fill="' + (o.fill || css('--tx2')) + '" font-size="' + (o.size || 11) +
      '" text-anchor="' + (o.anchor || 'middle') + '" font-family="ui-monospace,Menlo,monospace"' +
      (o.weight ? ' font-weight="' + o.weight + '"' : '') + '>' + esc(s) + '</text>';
  }

  /* ================================================================ TOOLS */
  var TOOLS = {};

  /* ------------------------------------------------------------ 1. DoF */
  TOOLS.dof = function () {
    var d = camDerived(CAM);
    var mode = val('dof-coc', '1442');
    var c;
    if (mode === 'pixel') c = 2 * d.pitch;
    else if (mode === 'custom') c = num('dof-coc-custom', 0.03);
    else c = d.diag / parseFloat(mode);
    $('dof-coc-custom').closest('.field').style.display = (mode === 'custom') ? '' : 'none';

    var f = num('dof-focal', 50), N = num('dof-aperture', 2.8);
    var unit = val('dof-unit', 'm');
    var sIn = num('dof-distance', 3);
    var toMM = unit === 'm' ? 1000 : 304.8;
    var s = sIn * toMM;
    var uname = unit === 'm' ? 'm' : 'ft';

    if (!(f > 0 && N > 0 && s > f && c > 0)) {
      $('dof-out').innerHTML = note(L('Focus distance must be greater than the focal length.', '对焦距离必须大于焦距。'), 'bad');
      svg('dof', '', 600, 160); return;
    }

    var H = (f * f) / (N * c) + f;
    var Dn = s * (H - f) / (H + s - 2 * f);
    var Df = (s < H) ? s * (H - f) / (H - s) : Infinity;
    var total = Df - Dn;
    var front = s - Dn, back = isFinite(Df) ? Df - s : Infinity;

    var lam = 0.00055; // 550 nm in mm
    var airy = 2.44 * lam * N;            // mm
    var DLA = c / (2.44 * lam);
    var airyPx = airy / d.pitch;
    var dlaPix = (2 * d.pitch) / (2.44 * lam);

    // Hansma-style: sharpest aperture that still covers the SAME depth band
    var bestN = N, bestBlur = Infinity;
    function defocusAt(dist, ap) {
      if (!isFinite(dist)) { return (f * f) / (ap * (s - f)); } // object at infinity
      return (f * f / ap) * Math.abs(dist - s) / (dist * (s - f));
    }
    for (var i = 0; i < STD_AP.length; i++) {
      var ap = STD_AP[i]; if (ap < 1 || ap > 32) continue;
      var a2 = 2.44 * lam * ap;
      var b1 = Math.sqrt(Math.pow(defocusAt(Dn, ap), 2) + a2 * a2);
      var b2 = Math.sqrt(Math.pow(defocusAt(Df, ap), 2) + a2 * a2);
      var worst = Math.max(b1, b2);
      if (worst < bestBlur - 1e-9) { bestBlur = worst; bestN = ap; }
    }

    var fromMM = 1 / toMM;
    var rows = [
      { k: L('Near limit', '近点'), v: fmtSig(Dn * fromMM) + ' ' + uname, big: true },
      { k: L('Far limit', '远点'), v: (isFinite(Df) ? fmtSig(Df * fromMM) + ' ' + uname : '∞'), big: true },
      { k: L('Total depth of field', '总景深'), v: isFinite(total) ? fmtSig(total * fromMM) + ' ' + uname : '∞' },
      { k: L('In front of subject', '主体前'), v: fmtSig(front * fromMM) + ' ' + uname + ' (' + (isFinite(back) ? Math.round(100 * front / total) : 0) + '%)' },
      { k: L('Behind subject', '主体后'), v: isFinite(back) ? fmtSig(back * fromMM) + ' ' + uname + ' (' + Math.round(100 * back / total) + '%)' : '∞' },
      { k: L('Hyperfocal distance', '超焦距'), v: fmtSig(H * fromMM) + ' ' + uname },
      { k: L('Focus at hyperfocal → sharp from', '对焦超焦距 → 清晰起始'), v: fmtSig(H / 2 * fromMM) + ' ' + uname + ' → ∞' }
    ];
    var cocName = mode === 'pixel' ? L('2 × pixel pitch', '2 × 像素间距')
      : mode === 'custom' ? L('custom', '自定义') : L('diagonal ÷ ', '对角线 ÷ ') + mode;
    var diffRows = [
      { k: L('Circle of confusion used', '所用弥散圆'), v: fmt(c * 1000, 1) + ' µm', cls: 'ok' },
      { k: L('Airy disk at f/', '当前光圈艾里斑 f/') + fmt(N, 1), v: fmt(airy * 1000, 1) + ' µm' },
      { k: L('Airy disk vs pixel pitch', '艾里斑 / 像素间距'), v: fmt(airyPx, 2) + ' px', cls: airyPx > 2 ? 'bad' : (airyPx > 1 ? 'warn' : 'ok') },
      { k: L('Diffraction-limited aperture (CoC)', '衍射极限光圈（按弥散圆）'), v: 'f/' + fmt(DLA, 1), cls: N > DLA ? 'warn' : 'ok' },
      { k: L('Diffraction visible at 100 % beyond', '100% 查看时衍射可见于'), v: 'f/' + fmt(dlaPix, 1) },
      { k: L('Sharpest aperture covering this same depth', '覆盖同样景深的最锐光圈'), v: 'f/' + fmt(bestN, 1), cls: 'ok' }
    ];
    var verdict;
    if (N > DLA * 1.4) verdict = note(L('At f/' + fmt(N, 1) + ' diffraction dominates: the Airy disk is larger than your sharpness criterion, so the whole frame is softening. Opening up to f/' + fmt(bestN, 1) + ' keeps the same depth band sharper.',
      '在 f/' + fmt(N, 1) + ' 下衍射已占主导：艾里斑大于你的清晰判据，整幅画面都在变肉。开大到 f/' + fmt(bestN, 1) + ' 能让同样的景深范围更锐。'), 'bad');
    else if (N > DLA) verdict = note(L('You are just past the diffraction limit for this criterion. Extra depth now costs a little global sharpness — usually still a fair trade.',
      '你刚刚越过该判据下的衍射极限。此后多出来的景深会略微牺牲整体锐度——通常仍算划算。'), 'warn');
    else verdict = note(L('Defocus, not diffraction, is the limiting blur here. You have room to stop down further if you need more depth.',
      '这里的限制模糊是失焦而不是衍射。如果需要更多景深，还有收缩光圈的余地。'));

    $('dof-out').innerHTML =
      group(L('Depth of field', '景深'), rows) +
      group(L('Diffraction & sharpness', '衍射与锐度'), diffRows, verdict);

    /* SVG: to-scale depth strip */
    var W = 620, Hh = 170, pad = 40;
    var maxD = isFinite(Df) ? Math.min(Df * 1.25, H * 1.6) : H * 1.8;
    var scale = function (x) { return pad + (Math.min(x, maxD) / maxD) * (W - 2 * pad); };
    var g = '<rect x="0" y="0" width="' + W + '" height="' + Hh + '" fill="none"/>';
    g += '<line x1="' + pad + '" y1="115" x2="' + (W - pad) + '" y2="115" stroke="' + css('--line2') + '" stroke-width="1.5"/>';
    var x0 = scale(Dn), x1 = scale(isFinite(Df) ? Df : maxD), xs = scale(s), xh = scale(H);
    g += '<rect x="' + x0 + '" y="62" width="' + Math.max(2, x1 - x0) + '" height="46" fill="' + css('--gold') + '" opacity="0.22" rx="4"/>';
    g += '<rect x="' + x0 + '" y="62" width="' + Math.max(2, x1 - x0) + '" height="46" fill="none" stroke="' + css('--gold') + '" stroke-width="1.5" rx="4"/>';
    g += '<line x1="' + xs + '" y1="52" x2="' + xs + '" y2="122" stroke="' + css('--cyan') + '" stroke-width="2"/>';
    g += '<circle cx="' + xs + '" cy="46" r="4" fill="' + css('--cyan') + '"/>';
    if (xh < W - pad) g += '<line x1="' + xh + '" y1="66" x2="' + xh + '" y2="118" stroke="' + css('--violet') + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
    g += txt(xs, 36, L('focus ', '对焦 ') + fmtSig(s * fromMM) + uname, { fill: css('--cyan'), size: 11 });
    g += txt(x0, 132, fmtSig(Dn * fromMM) + uname, { size: 10.5 });
    g += txt(Math.min(x1, W - pad - 6), 132, isFinite(Df) ? fmtSig(Df * fromMM) + uname : '∞', { size: 10.5 });
    if (xh < W - pad) g += txt(xh, 148, 'H ' + fmtSig(H * fromMM) + uname, { fill: css('--violet'), size: 10.5 });
    g += txt(pad, 148, L('camera', '相机'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    // blur bar comparison
    var bw = 150, bx = W - pad - bw;
    g += txt(bx, 18, L('blur budget', '模糊预算'), { anchor: 'start', size: 10, fill: css('--tx3') });
    var mx = Math.max(c, airy) * 1.15;
    g += '<rect x="' + bx + '" y="23" width="' + (bw * c / mx) + '" height="7" fill="' + css('--ok') + '" rx="2"/>';
    g += '<rect x="' + bx + '" y="33" width="' + (bw * airy / mx) + '" height="7" fill="' + (airy > c ? css('--bad') : css('--tx3')) + '" rx="2"/>';
    g += txt(bx + bw + 4, 30, 'CoC', { anchor: 'start', size: 9, fill: css('--ok') });
    g += txt(bx + bw + 4, 40, 'Airy', { anchor: 'start', size: 9, fill: airy > c ? css('--bad') : css('--tx3') });
    svg('dof', g, W, Hh);
    cap('dof', L('Depth of field drawn to scale from the camera. Bars top-right compare your sharpness criterion against the Airy disk.',
      '按真实比例绘制的景深带（自相机起）。右上方两条为清晰判据与艾里斑的直接对比。'));
  };

  /* ------------------------------------------------------- 2. Exposure */
  TOOLS.exp = function () {
    var solve = val('exp-solve', 'shutter');
    var N = num('exp-aperture', 8), t = parseShutter(val('exp-shutter', '1/250')),
      iso = num('exp-iso', 100), ev100 = num('exp-ev', 15), comp = num('exp-comp', 0);
    var sc = val('exp-scene', '');
    if (sc !== '' && $('exp-scene').dataset.touched === '1') {
      ev100 = parseFloat(sc); $('exp-ev').value = ev100; $('exp-scene').dataset.touched = '0';
    }
    ['exp-aperture', 'exp-shutter', 'exp-iso', 'exp-ev'].forEach(function (id) {
      var fieldMap = { shutter: 'exp-shutter', aperture: 'exp-aperture', iso: 'exp-iso', ev: 'exp-ev' };
      var el = $(id); if (!el) return;
      el.closest('.field').style.opacity = (fieldMap[solve] === id) ? '0.5' : '1';
      el.disabled = (fieldMap[solve] === id);
    });

    var out = [], evCamTarget, res = '';
    if (solve === 'shutter') {
      evCamTarget = ev100 + Math.log2(iso / 100) - comp;
      t = N * N / Math.pow(2, evCamTarget);
      res = fmtShutter(t);
      out.push({ k: L('Required shutter speed', '所需快门'), v: res, big: true });
      out.push({ k: L('Nearest camera setting', '最接近的机身档位'), v: fmtShutter(nearest(STD_SH, t)), cls: 'ok' });
    } else if (solve === 'aperture') {
      evCamTarget = ev100 + Math.log2(iso / 100) - comp;
      N = Math.sqrt(t * Math.pow(2, evCamTarget));
      out.push({ k: L('Required aperture', '所需光圈'), v: 'f/' + fmt(N, 2), big: true });
      out.push({ k: L('Nearest camera setting', '最接近的机身档位'), v: 'f/' + nearest(STD_AP, N), cls: 'ok' });
    } else if (solve === 'iso') {
      var evCam = Math.log2(N * N / t);
      iso = 100 * Math.pow(2, evCam - ev100 + comp);
      out.push({ k: L('Required ISO', '所需 ISO'), v: Math.round(iso), big: true });
      out.push({ k: L('Nearest camera setting', '最接近的机身档位'), v: nearest(STD_ISO, iso), cls: 'ok' });
    } else {
      var evCam2 = Math.log2(N * N / t);
      ev100 = evCam2 - Math.log2(iso / 100) + comp;
      out.push({ k: L('Scene EV at ISO 100', 'ISO 100 下场景 EV'), v: fmt(ev100, 2), big: true });
    }
    if (!(isFinite(N) && isFinite(t) && isFinite(iso) && N > 0 && t > 0 && iso > 0)) {
      $('exp-out').innerHTML = note(L('Check your inputs — shutter accepts 1/250, 0.5 or 30s.', '请检查输入——快门可写 1/250、0.5 或 30s。'), 'bad');
      svg('exp', '', 600, 150); return;
    }
    var evCamF = Math.log2(N * N / t);
    out.push({ k: L('Camera exposure EV (N²/t)', '相机曝光 EV（N²/t）'), v: fmt(evCamF, 2) });
    out.push({ k: L('Scene EV at ISO 100', 'ISO 100 场景 EV'), v: fmt(ev100, 2) });
    out.push({ k: L('Exposure compensation', '曝光补偿'), v: (comp >= 0 ? '+' : '') + fmt(comp, 2) + ' ' + L('stops', '档') });
    out.push({ k: L('Light level', '光照水平'), v: fmt(2.5 * Math.pow(2, ev100), 0) + ' lx ' + L('(approx.)', '（约）') });

    /* equivalent exposures */
    var tb = '<table class="res-table"><thead><tr><th>f/</th><th>' + L('Shutter', '快门') + '</th><th>' + L('Stops from now', '相对档差') + '</th></tr></thead><tbody>';
    var evT = ev100 + Math.log2(iso / 100) - comp;
    [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22].forEach(function (a) {
      var tt = a * a / Math.pow(2, evT);
      var hl = Math.abs(Math.log2(a / N)) < 0.12 ? ' class="hl"' : '';
      tb += '<tr' + hl + '><td>f/' + a + '</td><td>' + fmtShutter(tt) + '</td><td>' + (2 * Math.log2(a / N) >= 0 ? '+' : '') + fmt(2 * Math.log2(a / N), 1) + '</td></tr>';
    });
    tb += '</tbody></table>';

    $('exp-out').innerHTML = group(L('Solution', '求解结果'), out) +
      group(L('Equivalent exposures at ISO ', '等效曝光组合，ISO ') + Math.round(iso), [{ raw: tb }]);

    /* SVG triangle bars */
    var W = 620, Hh = 150;
    var g = '';
    var bars = [
      { lbl: L('Aperture', '光圈'), v: 'f/' + fmt(N, 1), p: Math.min(1, Math.max(0, (Math.log2(N / 1) / Math.log2(32)))), col: css('--gold') },
      { lbl: L('Shutter', '快门'), v: fmtShutter(t), p: Math.min(1, Math.max(0, (Math.log2(t / (1 / 8000)) / Math.log2(30 / (1 / 8000))))), col: css('--cyan') },
      { lbl: 'ISO', v: Math.round(iso), p: Math.min(1, Math.max(0, Math.log2(iso / 50) / Math.log2(102400 / 50))), col: css('--violet') }
    ];
    bars.forEach(function (b, i) {
      var y = 34 + i * 36;
      g += txt(14, y + 4, b.lbl, { anchor: 'start', size: 11.5 });
      g += '<rect x="110" y="' + (y - 9) + '" width="400" height="14" rx="7" fill="' + css('--line') + '"/>';
      g += '<rect x="110" y="' + (y - 9) + '" width="' + Math.max(6, 400 * b.p) + '" height="14" rx="7" fill="' + b.col + '"/>';
      g += txt(606, y + 4, b.v, { anchor: 'end', size: 12, fill: b.col, weight: 700 });
    });
    g += txt(14, 18, L('Exposure triangle — bar position is stops within the usable range', '曝光三角——条形位置表示在可用范围内的档位'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    g += txt(310, 142, 'EV' + fmt(evCamF, 1) + '  ·  ' + L('scene', '场景') + ' EV' + fmt(ev100, 1) + ' @ISO100', { size: 11, fill: css('--tx2') });
    svg('exp', g, W, Hh);
    cap('exp', L('All three settings expressed on a common stop scale.', '三个参数放在同一档位标尺上表示。'));
  };

  /* ---------------------------------------------------------- 3. Crop */
  TOOLS.crop = function () {
    var from = sensorOf(CAM.key), to = sensorOf(val('crop-to', 'ff'));
    var f = num('crop-focal', 25), N = num('crop-aperture', 1.8), iso = num('crop-iso', 800);
    var dF = Math.sqrt(from.w * from.w + from.h * from.h), dT = Math.sqrt(to.w * to.w + to.h * to.h);
    if (!(dF > 0 && dT > 0 && f > 0 && N > 0)) { $('crop-out').innerHTML = note(L('Check inputs.', '请检查输入。'), 'bad'); return; }
    var r = dT / dF;
    var aovD = 2 * deg(Math.atan(dF / (2 * f)));
    var aovH = 2 * deg(Math.atan(from.w / (2 * f)));

    var rows = [
      { k: L('Equivalent focal length', '等效焦距'), v: fmt(f * r, 1) + ' mm', big: true },
      { k: L('Equivalent aperture (DoF & total light)', '等效光圈（景深与总进光）'), v: 'f/' + fmt(N * r, 2), big: true },
      { k: L('Equivalent ISO (same noise per area)', '等效 ISO（单位面积同噪点）'), v: Math.round(iso * r * r) },
      { k: L('Metered exposure', '测光曝光'), v: L('unchanged — f/', '不变 — f/') + fmt(N, 1), cls: 'ok' },
      { k: L('Format ratio (to ÷ from)', '画幅比值（目标 ÷ 当前）'), v: fmt(r, 3) + '×' },
      { k: L('Crop factor of your sensor', '你的画幅等效系数'), v: fmt(FF_DIAG / dF, 2) + '×' },
      { k: L('Crop factor of target', '目标画幅等效系数'), v: fmt(FF_DIAG / dT, 2) + '×' },
      { k: L('Diagonal angle of view', '对角视角'), v: fmt(aovD, 1) + '°' },
      { k: L('Horizontal angle of view', '水平视角'), v: fmt(aovH, 1) + '°' },
      { k: L('Sensor area ratio', '面积比'), v: fmt((to.w * to.h) / (from.w * from.h), 2) + '×' }
    ];
    var n1 = note(L('To frame identically from the same spot, a ' + fmt(f, 0) + ' mm on your sensor needs a ' + fmt(f * r, 0) +
      ' mm on the target format. Depth of field and total gathered light match at f/' + fmt(N * r, 1) +
      ' there — but your meter still reads f/' + fmt(N, 1) + ', because the f-number sets image brightness on every format.',
      '要在同一位置得到相同构图，你这块传感器上的 ' + fmt(f, 0) + 'mm 对应目标画幅的 ' + fmt(f * r, 0) +
      'mm。景深与总进光量在那边等于 f/' + fmt(N * r, 1) + '——但测光仍然读 f/' + fmt(N, 1) + '，因为 f 值在任何画幅上都决定画面亮度。'));

    $('crop-out').innerHTML = group(L('Equivalence', '等效换算'), rows, n1);

    var W = 620, Hh = 230;
    var maxW = Math.max(from.w, to.w), maxH = Math.max(from.h, to.h);
    var sc = Math.min(430 / maxW, 170 / maxH);
    var cx = W / 2, cy = 112;
    function rect(w, h, col, dash, lbl, ly) {
      var x = cx - w * sc / 2, y = cy - h * sc / 2;
      return '<rect x="' + x + '" y="' + y + '" width="' + (w * sc) + '" height="' + (h * sc) + '" fill="' + col +
        '" fill-opacity="0.10" stroke="' + col + '" stroke-width="2"' + (dash ? ' stroke-dasharray="6 4"' : '') + ' rx="3"/>' +
        txt(cx, ly, lbl, { fill: col, size: 11.5, weight: 700 });
    }
    var g = rect(to.w, to.h, css('--violet'), true, to.n + '  ' + fmt(dT, 1) + ' mm', 20);
    g += rect(from.w, from.h, css('--gold'), false, (CAM.key === 'custom' ? fmt(from.w, 1) + ' × ' + fmt(from.h, 1) : from.n) + '  ' + fmt(dF, 1) + ' mm', 214);
    g += txt(cx, cy + 5, fmt(r, 2) + '×', { size: 22, fill: css('--tx'), weight: 800 });
    svg('crop', g, W, Hh);
    cap('crop', L('Both sensors drawn to the same scale.', '两块传感器按同一比例绘制。'));
  };

  /* ----------------------------------------------------------- 4. FoV */
  TOOLS.fov = function () {
    var d = camDerived(CAM), s0 = sensorOf(CAM.key);
    var port = val('fov-orient', 'land') === 'port';
    var w = port ? s0.h : s0.w, h = port ? s0.w : s0.h;
    var f = num('fov-focal', 85), dist = num('fov-distance', 4), sub = num('fov-subject', 1.75);
    if (!(f > 0 && dist > 0)) { $('fov-out').innerHTML = note(L('Check inputs.', '请检查输入。'), 'bad'); return; }
    var distMM = dist * 1000;
    var diag = Math.sqrt(w * w + h * h);
    var aovH = 2 * deg(Math.atan(w / (2 * f))), aovV = 2 * deg(Math.atan(h / (2 * f))), aovD = 2 * deg(Math.atan(diag / (2 * f)));
    var m = f / (distMM - f);
    var fw = w / m, fh = h / m;                    // mm
    var mNeed = h / (sub * 1000);
    var sNeed = f * (1 + 1 / mNeed);               // mm
    var pxW = port ? d.pxH : d.pxW;
    var gsd = fw / pxW;                            // mm per pixel

    var rows = [
      { k: L('Horizontal angle of view', '水平视角'), v: fmt(aovH, 1) + '°', big: true },
      { k: L('Vertical angle of view', '垂直视角'), v: fmt(aovV, 1) + '°' },
      { k: L('Diagonal angle of view', '对角视角'), v: fmt(aovD, 1) + '°' },
      { k: L('Frame width at ' + fmt(dist, 2) + ' m', fmt(dist, 2) + ' m 处画面宽度'), v: fmt(fw / 1000, 2) + ' m', big: true },
      { k: L('Frame height', '画面高度'), v: fmt(fh / 1000, 2) + ' m' },
      { k: L('Magnification at that distance', '该距离放大倍率'), v: '1 : ' + fmt(1 / m, 0) },
      { k: L('Ground sample distance', '地面采样距离'), v: fmt(gsd, 3) + ' mm/px' },
      { k: L('Distance to fill height with ' + fmt(sub, 2) + ' m subject', fmt(sub, 2) + ' m 主体充满画面的距离'), v: fmt(sNeed / 1000, 2) + ' m', cls: 'ok' },
      { k: L('Equivalent full-frame focal length', '等效全画幅焦距'), v: fmt(f * (FF_DIAG / Math.sqrt(s0.w * s0.w + s0.h * s0.h)), 0) + ' mm' }
    ];
    var n = note(L('At ' + fmt(dist, 2) + ' m this lens covers ' + fmt(fw / 1000, 2) + ' × ' + fmt(fh / 1000, 2) +
      ' m. One pixel spans ' + fmt(gsd, 3) + ' mm of your subject, so detail finer than about ' + fmt(gsd * 2, 2) +
      ' mm cannot be resolved no matter how good the focus.',
      '在 ' + fmt(dist, 2) + ' m 处，这支镜头覆盖 ' + fmt(fw / 1000, 2) + ' × ' + fmt(fh / 1000, 2) +
      ' m。一个像素对应主体上 ' + fmt(gsd, 3) + ' mm，因此小于约 ' + fmt(gsd * 2, 2) + ' mm 的细节，无论对焦多准都分辨不出来。'));
    $('fov-out').innerHTML = group(L('Field of view', '视角与画面'), rows, n);

    var W = 620, Hh = 210, apex = { x: 44, y: 105 };
    var half = rad(aovH / 2);
    var len = 520;
    var y1 = apex.y - Math.tan(half) * len, y2 = apex.y + Math.tan(half) * len;
    var maxSpread = 88;
    if (Math.abs(y1 - apex.y) > maxSpread) { len = maxSpread / Math.tan(half); y1 = apex.y - maxSpread; y2 = apex.y + maxSpread; }
    var ex = apex.x + len;
    var g = '<path d="M' + apex.x + ' ' + apex.y + ' L' + ex + ' ' + y1 + ' L' + ex + ' ' + y2 + ' Z" fill="' + css('--gold') + '" fill-opacity="0.13" stroke="' + css('--gold') + '" stroke-width="1.4"/>';
    g += '<rect x="' + (apex.x - 16) + '" y="' + (apex.y - 11) + '" width="16" height="22" fill="' + css('--tx3') + '" rx="2"/>';
    g += '<line x1="' + ex + '" y1="' + y1 + '" x2="' + ex + '" y2="' + y2 + '" stroke="' + css('--cyan') + '" stroke-width="2.5"/>';
    g += txt(ex - 8, y1 - 8, fmt(fw / 1000, 2) + ' m', { anchor: 'end', size: 11.5, fill: css('--cyan'), weight: 700 });
    g += txt(apex.x + 46, apex.y - 6, fmt(aovH, 1) + '°', { anchor: 'start', size: 12, fill: css('--gold'), weight: 700 });
    g += '<line x1="' + apex.x + '" y1="' + (apex.y + 62) + '" x2="' + ex + '" y2="' + (apex.y + 62) + '" stroke="' + css('--line2') + '" stroke-width="1" stroke-dasharray="3 3"/>';
    g += txt((apex.x + ex) / 2, apex.y + 78, fmt(dist, 2) + ' m', { size: 11 });
    var subH = Math.min(Math.abs(y2 - y1) * (sub * 1000) / fh, 150);
    g += '<rect x="' + (ex - 26) + '" y="' + (apex.y - subH / 2) + '" width="7" height="' + subH + '" fill="' + css('--rose') + '" rx="2"/>';
    g += txt(ex - 32, apex.y + 4, fmt(sub, 2) + 'm', { anchor: 'end', size: 10, fill: css('--rose') });
    g += txt(14, 18, L('Top-down view of the horizontal field', '水平视场俯视图'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    svg('fov', g, W, Hh);
    cap('fov', L('Cone drawn from the true horizontal angle of view; subject bar is to scale within the frame.',
      '按真实水平视角绘制的视场锥；主体色条在画面内按比例显示。'));
  };

  /* --------------------------------------------------------- 5. Astro */
  TOOLS.astro = function () {
    var d = camDerived(CAM);
    var f = num('astro-focal', 20), N = num('astro-aperture', 2.8), dec = num('astro-dec', 0),
      k = parseFloat(val('astro-acc', '1')), tTest = parseShutter(val('astro-test', '20s'));
    var cd = Math.cos(rad(Math.max(-89, Math.min(89, dec))));
    if (!(f > 0 && N > 0)) { $('astro-out').innerHTML = note(L('Check inputs.', '请检查输入。'), 'bad'); return; }
    var p = d.pitchUm;
    var npf = k * (35 * N + 30 * p) / (f * Math.max(cd, 1e-3));
    var eqf = f * d.crop;
    var r500 = 500 / eqf / Math.max(cd, 1e-3), r400 = 400 / eqf / Math.max(cd, 1e-3), r300 = 300 / eqf / Math.max(cd, 1e-3);
    var arcPerPx = 206265 * (d.pitch / f);
    var drift = 15.041 * cd;
    var t1px = arcPerPx / drift, t2px = 2 * t1px;
    var trail = isFinite(tTest) ? drift * tTest / arcPerPx : NaN;

    var rows = [
      { k: L('NPF rule (your pixel pitch)', 'NPF 法则（按你的像素间距）'), v: fmt(npf, 1) + ' s', big: true },
      { k: L('500 rule', '500 法则'), v: fmt(r500, 1) + ' s' },
      { k: L('400 rule / 300 rule', '400 / 300 法则'), v: fmt(r400, 1) + ' s / ' + fmt(r300, 1) + ' s' },
      { k: L('Pixel pitch used', '所用像素间距'), v: fmt(p, 2) + ' µm' },
      { k: L('Equivalent focal length', '等效焦距'), v: fmt(eqf, 0) + ' mm' },
      { k: L('Angular size of one pixel', '单像素角尺寸'), v: fmt(arcPerPx, 2) + '″/px' },
      { k: L('Star drift rate at δ=' + fmt(dec, 0) + '°', 'δ=' + fmt(dec, 0) + '° 处漂移速率'), v: fmt(drift, 2) + '″/s' },
      { k: L('Exposure for ≤ 1 px trail', '拖线 ≤ 1 px 的曝光'), v: fmt(t1px, 1) + ' s', cls: 'ok' },
      { k: L('Exposure for ≤ 2 px trail', '拖线 ≤ 2 px 的曝光'), v: fmt(t2px, 1) + ' s' }
    ];
    var testRows = isFinite(tTest) ? [
      { k: L('Trail length at ' + fmtShutter(tTest), fmtShutter(tTest) + ' 时的拖线长度'), v: fmt(trail, 1) + ' px', big: true, cls: trail > 2.5 ? 'bad' : (trail > 1.2 ? 'warn' : 'ok') },
      { k: L('Trail as fraction of frame width', '拖线占画幅宽度'), v: fmt(100 * trail / d.pxW, 4) + ' %' }
    ] : [{ k: L('Test shutter', '试算快门'), v: '—' }];

    var verdict = trail > 2.5 ? note(L('Stars will be visibly elongated at 100 %. Shorten to about ' + fmt(t2px, 0) + ' s, open the aperture, or stack more frames.',
      '在 100% 查看下星点会明显拉长。缩短到约 ' + fmt(t2px, 0) + ' s、开大光圈，或者多张叠加。'), 'bad')
      : trail > 1.2 ? note(L('Slight elongation — invisible in web-size output, detectable in a large print.',
        '轻微拉长——网络尺寸看不出来，大幅输出时能察觉。'), 'warn')
        : note(L('Stars stay within roughly one pixel: points, not dashes.', '星点保持在约一个像素内：是点，不是短线。'));

    $('astro-out').innerHTML = group(L('Maximum exposure', '最长曝光'), rows) +
      group(L('Trail check', '拖线检查'), testRows, verdict);

    var W = 620, Hh = 170;
    var g = '<rect x="0" y="0" width="' + W + '" height="' + Hh + '" fill="#05070d"/>';
    for (var i = 0; i < 46; i++) {
      var x = 20 + ((i * 97) % (W - 40)), y = 22 + ((i * 53) % (Hh - 60)), r = 0.6 + ((i * 7) % 5) / 5;
      g += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#cfe0ff" opacity="' + (0.3 + (i % 5) / 8) + '"/>';
    }
    var scalePx = 26; // screen px per sensor px
    var cy = Hh - 34;
    [[t1px, css('--ok'), '1 px'], [isFinite(tTest) ? tTest : npf, trail > 2.5 ? css('--bad') : css('--gold'), isFinite(tTest) ? fmtShutter(tTest) : 'NPF']].forEach(function (a, idx) {
      var tt = a[0]; if (!isFinite(tt)) return;
      var lenPx = drift * tt / arcPerPx * scalePx;
      var x0 = 90 + idx * 250;
      g += '<line x1="' + x0 + '" y1="' + cy + '" x2="' + (x0 + Math.min(lenPx, 200)) + '" y2="' + cy + '" stroke="' + a[1] + '" stroke-width="6" stroke-linecap="round"/>';
      g += txt(x0, cy + 22, a[2] + ' · ' + fmt(drift * tt / arcPerPx, 1) + ' px', { anchor: 'start', size: 11, fill: a[1] });
    });
    g += '<line x1="90" y1="' + (cy - 22) + '" x2="' + (90 + scalePx) + '" y2="' + (cy - 22) + '" stroke="#7788a5" stroke-width="1.5"/>';
    g += txt(90 + scalePx + 6, cy - 18, L('= 1 sensor pixel', '= 1 个传感器像素'), { anchor: 'start', size: 10, fill: '#7788a5' });
    g += txt(16, 20, L('Star trail length, magnified to pixel scale', '星点拖线长度（放大到像素尺度）'), { anchor: 'start', size: 10.5, fill: '#7788a5' });
    svg('astro', g, W, Hh);
    cap('astro', L('Bars show how far a star smears across the sensor, drawn at 26× pixel scale.',
      '色条表示星点在传感器上拖过的距离，按 26 倍像素尺度绘制。'));
  };

  /* ------------------------------------------------------------ 6. ND */
  TOOLS.nd = function () {
    var base = parseShutter(val('nd-base', '1/60'));
    var sel = val('nd-filter', '10');
    var stops = sel === 'custom' ? num('nd-custom', 10) : parseFloat(sel);
    $('nd-custom').closest('.field').style.display = (sel === 'custom') ? '' : 'none';
    var stack = num('nd-stack', 0);
    var total = stops + stack;
    var target = parseShutter(val('nd-target', '30s'));
    if (!isFinite(base) || base <= 0) { $('nd-out').innerHTML = note(L('Enter a metered shutter such as 1/60.', '请输入测得的快门，如 1/60。'), 'bad'); return; }
    var t2 = base * Math.pow(2, total);
    var need = isFinite(target) && target > 0 ? Math.log2(target / base) : NaN;

    var rows = [
      { k: L('Exposure with filter', '加镜后曝光'), v: fmtShutter(t2), big: true },
      { k: L('Total filtration', '总减光'), v: fmt(total, 1) + ' ' + L('stops', '档') },
      { k: L('ND factor', '滤镜倍数'), v: '×' + fmt(Math.pow(2, total), 0) },
      { k: L('Optical density', '光学密度'), v: fmt(total * 0.30103, 2) },
      { k: L('Common name', '常见标称'), v: 'ND' + fmt(Math.pow(2, total), 0) + ' / ' + fmt(total * 0.30103, 1) },
      { k: L('Bulb mode needed', '需要 B 门'), v: t2 > 30 ? L('yes — beyond 30 s', '需要 — 超过 30 s') : L('no', '不需要'), cls: t2 > 30 ? 'warn' : 'ok' }
    ];
    var rev = isFinite(need) ? [
      { k: L('To reach ' + fmtShutter(target), '要达到 ' + fmtShutter(target)), v: fmt(need, 1) + ' ' + L('stops needed', '档减光'), big: true },
      { k: L('Nearest standard filter', '最接近的标准滤镜'), v: 'ND' + Math.pow(2, Math.round(need)) + ' (' + Math.round(need) + ' ' + L('stops', '档') + ')' },
      { k: L('Suggested stack', '建议叠加'), v: suggestStack(Math.round(need)) },
      { k: L('You currently have', '你当前拥有'), v: fmt(total, 1) + ' ' + L('stops', '档') + (total >= need ? ' ✓' : ' — ' + L('short by ', '还差 ') + fmt(need - total, 1)), cls: total >= need ? 'ok' : 'warn' }
    ] : [];

    var tb = '<table class="res-table"><thead><tr><th>' + L('Stops', '档') + '</th><th>ND</th><th>' + L('Density', '密度') + '</th><th>' + L('Exposure', '曝光') + '</th></tr></thead><tbody>';
    [1, 2, 3, 4, 5, 6, 8, 10, 13, 15].forEach(function (s) {
      var hl = Math.abs(s - total) < 0.4 ? ' class="hl"' : '';
      tb += '<tr' + hl + '><td>' + s + '</td><td>ND' + Math.pow(2, s) + '</td><td>' + (s * 0.30103).toFixed(1) + '</td><td>' + fmtShutter(base * Math.pow(2, s)) + '</td></tr>';
    });
    tb += '</tbody></table>';

    $('nd-out').innerHTML = group(L('With your filter', '使用你的滤镜'), rows) +
      (rev.length ? group(L('Reverse: hit a target time', '反解：达到目标时间'), rev) : '') +
      group(L('Filter chart from ' + fmtShutter(base), '以 ' + fmtShutter(base) + ' 为基准的滤镜表'), [{ raw: tb }]);

    var W = 620, Hh = 130;
    var g = txt(14, 20, L('Exposure time on a logarithmic scale', '曝光时间（对数刻度）'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    var lo = Math.log2(1 / 8000), hi = Math.log2(3600);
    function px(t) { return 40 + (Math.log2(t) - lo) / (hi - lo) * (W - 80); }
    g += '<line x1="40" y1="72" x2="' + (W - 40) + '" y2="72" stroke="' + css('--line2') + '" stroke-width="2"/>';
    [1 / 1000, 1 / 60, 1, 30, 300, 3600].forEach(function (t) {
      g += '<line x1="' + px(t) + '" y1="66" x2="' + px(t) + '" y2="78" stroke="' + css('--line2') + '" stroke-width="1"/>';
      g += txt(px(t), 94, fmtShutter(t), { size: 9.5, fill: css('--tx3') });
    });
    g += '<circle cx="' + px(base) + '" cy="72" r="6" fill="' + css('--cyan') + '"/>';
    g += txt(px(base), 56, L('metered', '测得'), { size: 10, fill: css('--cyan') });
    if (t2 <= 3600) {
      g += '<circle cx="' + px(t2) + '" cy="72" r="6" fill="' + css('--gold') + '"/>';
      g += txt(px(t2), 56, fmtShutter(t2), { size: 10.5, fill: css('--gold'), weight: 700 });
      g += '<line x1="' + px(base) + '" y1="72" x2="' + px(t2) + '" y2="72" stroke="' + css('--gold') + '" stroke-width="4" opacity="0.5"/>';
      g += txt((px(base) + px(t2)) / 2, 116, '+' + fmt(total, 1) + ' ' + L('stops', '档'), { size: 11, fill: css('--gold') });
    }
    svg('nd', g, W, Hh);
    cap('nd', L('Each equal step along the axis is one stop of light.', '轴上每一等距刻度代表一档光。'));
  };
  function suggestStack(n) {
    var have = [10, 6, 5, 4, 3, 2, 1], out = [], rem = n;
    for (var i = 0; i < have.length && rem > 0; i++) {
      while (rem >= have[i]) { out.push('ND' + Math.pow(2, have[i])); rem -= have[i]; }
    }
    return out.length ? out.join(' + ') : '—';
  }

  /* --------------------------------------------------------- 7. Flash */
  TOOLS.flash = function () {
    var mode = val('flash-mode', 'aperture');
    var gn = num('flash-gn', 36), dist = num('flash-distance', 3), N = num('flash-aperture', 8),
      iso = num('flash-iso', 100), pw = parseFloat(val('flash-power', '1')), d2 = num('flash-second', 4.5);
    var k = Math.sqrt(iso / 100) * Math.sqrt(pw);
    var gnEff = gn * k;
    var rows = [];
    if (mode === 'aperture') { N = gnEff / dist; rows.push({ k: L('Required aperture', '所需光圈'), v: 'f/' + fmt(N, 2), big: true }); rows.push({ k: L('Nearest setting', '最近档位'), v: 'f/' + nearest(STD_AP, N), cls: 'ok' }); }
    else if (mode === 'distance') { dist = gnEff / N; rows.push({ k: L('Flash-to-subject distance', '灯到主体距离'), v: fmt(dist, 2) + ' m', big: true }); }
    else { gn = N * dist / (k || 1); rows.push({ k: L('Required guide number', '所需闪光指数'), v: fmt(gn, 1) + ' m @ISO100', big: true }); gnEff = gn * k; }
    rows.push({ k: L('Effective guide number', '有效闪光指数'), v: fmt(gnEff, 1) + ' m' });
    rows.push({ k: L('ISO gain', 'ISO 增益'), v: '×' + fmt(Math.sqrt(iso / 100), 2) + ' (' + fmt(Math.log2(iso / 100), 1) + ' ' + L('stops', '档') + ')' });
    rows.push({ k: L('Power setting', '输出档位'), v: '1/' + Math.round(1 / pw) + ' (' + fmt(Math.log2(pw), 1) + ' ' + L('stops', '档') + ')' });
    rows.push({ k: L('Illuminance ratio at ' + fmt(dist, 2) + ' m', fmt(dist, 2) + ' m 处照度比'), v: '1.00' });

    var stopsDiff = 2 * Math.log2(d2 / dist);
    var ratioRows = [
      { k: L('Second subject at ' + fmt(d2, 2) + ' m', '第二主体在 ' + fmt(d2, 2) + ' m'), v: (stopsDiff >= 0 ? '−' : '+') + fmt(Math.abs(stopsDiff), 2) + ' ' + L('stops', '档'), big: true, cls: Math.abs(stopsDiff) > 1 ? 'warn' : 'ok' },
      { k: L('Lighting ratio', '光比'), v: '1 : ' + fmt(Math.pow(2, Math.abs(stopsDiff)), 2) },
      { k: L('Relative brightness', '相对亮度'), v: fmt(100 * Math.pow(dist / d2, 2), 1) + ' %' },
      { k: L('Aperture for that subject', '该主体所需光圈'), v: 'f/' + fmt(gnEff / d2, 1) }
    ];
    var tb = '<table class="res-table"><thead><tr><th>' + L('Distance', '距离') + '</th><th>f/</th><th>' + L('Stops', '档差') + '</th></tr></thead><tbody>';
    [0.5, 0.7, 1, 1.4, 2, 2.8, 4, 5.6, 8].forEach(function (mul) {
      var dd = dist * mul, st = -2 * Math.log2(mul);
      tb += '<tr' + (mul === 1 ? ' class="hl"' : '') + '><td>' + fmt(dd, 2) + ' m</td><td>f/' + fmt(gnEff / dd, 1) + '</td><td>' + (st >= 0 ? '+' : '') + fmt(st, 1) + '</td></tr>';
    });
    tb += '</tbody></table>';

    $('flash-out').innerHTML = group(L('Flash exposure', '闪光曝光'), rows) +
      group(L('Inverse square falloff', '平方反比衰减'), ratioRows,
        note(L('Moving a subject from ' + fmt(dist, 2) + ' m to ' + fmt(d2, 2) + ' m changes illumination by ' + fmt(Math.abs(stopsDiff), 2) +
          ' stops. Move the light back to flatten the falloff across a group; move it in to make the background go dark.',
          '主体从 ' + fmt(dist, 2) + ' m 移到 ' + fmt(d2, 2) + ' m，照度变化 ' + fmt(Math.abs(stopsDiff), 2) +
          ' 档。想让一群人受光均匀就把灯拉远；想让背景压黑就把灯拉近。'))) +
      group(L('Distance ladder', '距离阶梯'), [{ raw: tb }]);

    var W = 620, Hh = 190, x0 = 52, y0 = 26, gw = W - 100, gh = 120;
    var g = '<line x1="' + x0 + '" y1="' + (y0 + gh) + '" x2="' + (x0 + gw) + '" y2="' + (y0 + gh) + '" stroke="' + css('--line2') + '"/>';
    g += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + (y0 + gh) + '" stroke="' + css('--line2') + '"/>';
    var dmax = Math.max(dist, d2) * 2.2, path = '';
    for (var i = 0; i <= 100; i++) {
      var dd = 0.25 + (dmax - 0.25) * i / 100;
      var rel = Math.pow(dist / dd, 2); if (rel > 1) rel = 1;
      var X = x0 + gw * (dd / dmax), Y = y0 + gh - gh * rel;
      path += (i ? ' L' : 'M') + X.toFixed(1) + ' ' + Y.toFixed(1);
    }
    g += '<path d="' + path + '" fill="none" stroke="' + css('--gold') + '" stroke-width="2.5"/>';
    [[dist, css('--cyan')], [d2, css('--rose')]].forEach(function (a) {
      var X = x0 + gw * (a[0] / dmax), rel = Math.min(1, Math.pow(dist / a[0], 2)), Y = y0 + gh - gh * rel;
      g += '<line x1="' + X + '" y1="' + Y + '" x2="' + X + '" y2="' + (y0 + gh) + '" stroke="' + a[1] + '" stroke-width="1.5" stroke-dasharray="3 3"/>';
      g += '<circle cx="' + X + '" cy="' + Y + '" r="5" fill="' + a[1] + '"/>';
      g += txt(X, y0 + gh + 15, fmt(a[0], 2) + ' m', { size: 10, fill: a[1] });
    });
    g += txt(x0 - 8, y0 + 6, '100%', { anchor: 'end', size: 10, fill: css('--tx3') });
    g += txt(x0 - 8, y0 + gh, '0', { anchor: 'end', size: 10, fill: css('--tx3') });
    g += txt(14, 16, L('Relative illuminance vs distance (1/d²)', '相对照度 - 距离曲线（1/d²）'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    g += txt(W / 2, Hh - 6, L('distance from flash', '距闪光灯距离'), { size: 10, fill: css('--tx3') });
    svg('flash', g, W, Hh);
    cap('flash', L('The curve is the inverse-square law; markers are your two subject distances.',
      '曲线为平方反比定律，标记点为你的两个主体距离。'));
  };

  /* ----------------------------------------------------------- 8. Sun */
  function solarCalc(lat, lon, y, mo, da, tz) {
    function jdFromDate(Y, M, D) {
      if (M <= 2) { Y -= 1; M += 12; }
      var A = Math.floor(Y / 100), B = 2 - A + Math.floor(A / 4);
      return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D + B - 1524.5;
    }
    var jd = jdFromDate(y, mo, da) + 0.5 - tz / 24; // local noon expressed in UT
    var T = (jd - 2451545.0) / 36525.0;
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360; if (L0 < 0) L0 += 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
    var trueLong = L0 + C;
    var appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * T));
    var mo0 = 23 + (26 + ((21.448 - T * (46.815 + T * (0.00059 - T * 0.001813)))) / 60) / 60;
    var oc = mo0 + 0.00256 * Math.cos(rad(125.04 - 1934.136 * T));
    var decl = deg(Math.asin(Math.sin(rad(oc)) * Math.sin(rad(appLong))));
    var vy = Math.tan(rad(oc / 2)) * Math.tan(rad(oc / 2));
    var eqTime = 4 * deg(vy * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) +
      4 * e * vy * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
      0.5 * vy * vy * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
    var noon = 720 - 4 * lon - eqTime + tz * 60; // minutes local
    function haFor(h) {
      var c = (Math.sin(rad(h)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl)));
      if (c > 1) return null;   // sun never reaches this elevation
      if (c < -1) return NaN;   // sun always above this elevation
      return deg(Math.acos(c));
    }
    function azFor(h, rising) {
      var ha = haFor(h); if (ha === null || isNaN(ha)) return NaN;
      var c = (Math.sin(rad(decl)) - Math.sin(rad(h)) * Math.sin(rad(lat))) / (Math.cos(rad(h)) * Math.cos(rad(lat)));
      c = Math.max(-1, Math.min(1, c));
      var a = deg(Math.acos(c));
      return rising ? a : 360 - a;
    }
    return { decl: decl, eqTime: eqTime, noon: noon, haFor: haFor, azFor: azFor };
  }
  function hm(mins) {
    if (mins === null || !isFinite(mins)) return '—';
    mins = ((mins % 1440) + 1440) % 1440;
    var h = Math.floor(mins / 60), m = Math.round(mins - h * 60);
    if (m === 60) { m = 0; h = (h + 1) % 24; }
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function dur(mins) {
    if (!isFinite(mins) || mins < 0) return '—';
    var h = Math.floor(mins / 60), m = Math.round(mins - h * 60);
    return (h ? h + ' h ' : '') + m + ' min';
  }

  TOOLS.sun = function () {
    var pl = val('sun-place', '');
    if (pl && $('sun-place').dataset.touched === '1') {
      var q = pl.split(',');
      $('sun-lat').value = q[0]; $('sun-lon').value = q[1]; $('sun-tz').value = q[2];
      $('sun-place').dataset.touched = '0';
    }
    var lat = num('sun-lat', 40.7128), lon = num('sun-lon', -74.006), tz = num('sun-tz', -5);
    var dstr = val('sun-date', '');
    var dt = dstr ? dstr.split('-') : null;
    var y, mo, da;
    if (dt && dt.length === 3) { y = +dt[0]; mo = +dt[1]; da = +dt[2]; }
    else { var n = new Date(); y = n.getFullYear(); mo = n.getMonth() + 1; da = n.getDate(); }
    if (!(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90)) { $('sun-out').innerHTML = note(L('Check coordinates.', '请检查坐标。'), 'bad'); return; }

    var S = solarCalc(lat, lon, y, mo, da, tz);
    function ev(h) {
      var ha = S.haFor(h);
      if (ha === null) return { rise: null, set: null, none: 'never' };
      if (isNaN(ha)) return { rise: null, set: null, none: 'always' };
      return { rise: S.noon - 4 * ha, set: S.noon + 4 * ha };
    }
    var sun = ev(-0.833), civ = ev(-6), gh = ev(6), gl = ev(-4);
    var noonElev = 90 - Math.abs(lat - S.decl);
    var dayLen = (sun.rise !== null) ? sun.set - sun.rise : (sun.none === 'always' ? 1440 : 0);

    var rows = [
      { k: L('Sunrise', '日出'), v: sun.rise !== null ? hm(sun.rise) : (sun.none === 'always' ? L('midnight sun', '极昼') : L('polar night', '极夜')), big: true },
      { k: L('Sunset', '日落'), v: sun.set !== null ? hm(sun.set) : '—', big: true },
      { k: L('Solar noon', '太阳正午'), v: hm(S.noon) },
      { k: L('Day length', '日照时长'), v: dur(dayLen) },
      { k: L('Max sun elevation', '最大太阳高度角'), v: fmt(noonElev, 1) + '°' },
      { k: L('Shadow length at noon', '正午影长'), v: noonElev > 0 ? fmt(1 / Math.tan(rad(noonElev)), 2) + '× ' + L('object height', '物体高度') : '—' },
      { k: L('Solar declination', '太阳赤纬'), v: fmt(S.decl, 2) + '°' },
      { k: L('Equation of time', '时差'), v: fmt(S.eqTime, 1) + ' min' }
    ];
    var azR = S.azFor(-0.833, true), azS = S.azFor(-0.833, false);
    var lightRows = [
      { k: L('Morning golden hour', '清晨黄金时刻'), v: (gl.rise !== null && gh.rise !== null) ? hm(gl.rise) + ' – ' + hm(gh.rise) : '—', big: true },
      { k: L('Evening golden hour', '傍晚黄金时刻'), v: (gh.set !== null && gl.set !== null) ? hm(gh.set) + ' – ' + hm(gl.set) : '—', big: true },
      { k: L('Golden hour length', '黄金时刻长度'), v: (gl.rise !== null && gh.rise !== null) ? dur(gh.rise - gl.rise) : '—' },
      { k: L('Morning blue hour', '清晨蓝调时刻'), v: (civ.rise !== null && gl.rise !== null) ? hm(civ.rise) + ' – ' + hm(gl.rise) : '—' },
      { k: L('Evening blue hour', '傍晚蓝调时刻'), v: (gl.set !== null && civ.set !== null) ? hm(gl.set) + ' – ' + hm(civ.set) : '—' },
      { k: L('Civil twilight begins / ends', '民用曙暮光 起 / 止'), v: civ.rise !== null ? hm(civ.rise) + ' / ' + hm(civ.set) : '—' },
      { k: L('Sunrise azimuth', '日出方位角'), v: isFinite(azR) ? fmt(azR, 1) + '° ' + compass(azR) : '—', cls: 'ok' },
      { k: L('Sunset azimuth', '日落方位角'), v: isFinite(azS) ? fmt(azS, 1) + '° ' + compass(azS) : '—', cls: 'ok' }
    ];
    var warn = Math.abs(lat) > 66.5 ? note(L('Above the polar circle some thresholds are never crossed on this date; blank fields mean the event does not occur rather than a calculation failure.',
      '在极圈以上，这个日期可能根本不会越过某些阈值；空白表示该现象不发生，而不是计算失败。'), 'warn') : '';

    $('sun-out').innerHTML =
      group(L('Sun for ' + y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da + ' (UTC' + (tz >= 0 ? '+' : '') + tz + ')',
        y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da + ' 的太阳（UTC' + (tz >= 0 ? '+' : '') + tz + '）'), rows) +
      group(L('Light windows', '光线窗口'), lightRows, warn +
        note(L('Thresholds used on this site: golden hour −4° to +6°, blue hour −6° to −4°, civil twilight −6°, sunrise/sunset −0.833°.',
          '本站使用的阈值：黄金时刻 −4° 至 +6°，蓝调时刻 −6° 至 −4°，民用曙暮光 −6°，日出日落 −0.833°。')));

    /* sun arc */
    var W = 620, Hh = 200, cx = W / 2, cy = 158, R = 130;
    var g = '<rect x="0" y="0" width="' + W + '" height="' + Hh + '" fill="none"/>';
    g += '<line x1="' + (cx - R - 20) + '" y1="' + cy + '" x2="' + (cx + R + 20) + '" y2="' + cy + '" stroke="' + css('--line2') + '" stroke-width="1.5"/>';
    var arc = '', got = false;
    for (var i = 0; i <= 96; i++) {
      var mins = i / 96 * 1440;
      var ha = (mins - S.noon) / 4;
      var el = deg(Math.asin(Math.sin(rad(lat)) * Math.sin(rad(S.decl)) + Math.cos(rad(lat)) * Math.cos(rad(S.decl)) * Math.cos(rad(ha))));
      var X = cx + R * (mins - S.noon) / 720 * 1.0;
      var Y = cy - R * Math.sin(rad(Math.max(el, -18))) / Math.sin(rad(90)) * 0.95;
      if (X < cx - R || X > cx + R) continue;
      arc += (got ? ' L' : 'M') + X.toFixed(1) + ' ' + Y.toFixed(1); got = true;
    }
    g += '<path d="' + arc + '" fill="none" stroke="' + css('--gold') + '" stroke-width="2.5"/>';
    function bandY(elv) { return cy - R * Math.sin(rad(elv)) * 0.95; }
    g += '<rect x="' + (cx - R) + '" y="' + bandY(6) + '" width="' + (2 * R) + '" height="' + Math.max(1, bandY(-4) - bandY(6)) + '" fill="' + css('--gold') + '" opacity="0.14"/>';
    g += '<rect x="' + (cx - R) + '" y="' + bandY(-4) + '" width="' + (2 * R) + '" height="' + Math.max(1, bandY(-6) - bandY(-4)) + '" fill="' + css('--violet') + '" opacity="0.22"/>';
    g += txt(cx - R + 4, bandY(3), L('golden', '黄金'), { anchor: 'start', size: 9.5, fill: css('--gold') });
    g += txt(cx - R + 4, bandY(-5.2), L('blue', '蓝调'), { anchor: 'start', size: 9.5, fill: css('--violet') });
    if (sun.rise !== null) {
      var xr = cx + R * (sun.rise - S.noon) / 720, xs = cx + R * (sun.set - S.noon) / 720;
      g += '<circle cx="' + xr + '" cy="' + bandY(-0.833) + '" r="4.5" fill="' + css('--cyan') + '"/>';
      g += '<circle cx="' + xs + '" cy="' + bandY(-0.833) + '" r="4.5" fill="' + css('--rose') + '"/>';
      g += txt(xr, cy + 18, hm(sun.rise), { size: 10, fill: css('--cyan') });
      g += txt(xs, cy + 18, hm(sun.set), { size: 10, fill: css('--rose') });
    }
    g += '<circle cx="' + cx + '" cy="' + bandY(noonElev) + '" r="7" fill="' + css('--gold') + '"/>';
    g += txt(cx, bandY(noonElev) - 12, hm(S.noon) + ' · ' + fmt(noonElev, 0) + '°', { size: 10.5, fill: css('--gold'), weight: 700 });
    g += txt(14, 16, L('Sun elevation across the day', '一天中的太阳高度角'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    g += txt(cx + R + 4, cy + 4, L('horizon', '地平线'), { anchor: 'start', size: 9, fill: css('--tx3') });
    svg('sun', g, W, Hh);
    cap('sun', L('Solar elevation from local midnight to midnight, with the golden and blue hour bands marked.',
      '从当地午夜到午夜的太阳高度角曲线，并标出黄金与蓝调时刻带。'));
  };
  function compass(a) {
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(((a % 360) + 360) % 360 / 22.5) % 16];
  }

  /* ----------------------------------------------------- 9. Time-lapse */
  TOOLS.tl = function () {
    var solve = val('tl-solve', 'clip');
    var iv = num('tl-interval', 5), shoot = num('tl-shoot', 60) * 60, clip = num('tl-clip', 20),
      fps = parseFloat(val('tl-fps', '24')), size = num('tl-size', 30), sh = parseShutter(val('tl-shutter', '1/4'));
    var mapf = { clip: 'tl-clip', interval: 'tl-interval', shoot: 'tl-shoot' };
    ['tl-clip', 'tl-interval', 'tl-shoot'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.disabled = (mapf[solve] === id); el.closest('.field').style.opacity = (mapf[solve] === id) ? '0.5' : '1';
    });
    var frames;
    if (solve === 'clip') { frames = shoot / iv; clip = frames / fps; }
    else if (solve === 'interval') { frames = clip * fps; iv = shoot / frames; }
    else { frames = clip * fps; shoot = frames * iv; }
    if (!(isFinite(frames) && frames > 0 && iv > 0)) { $('tl-out').innerHTML = note(L('Check inputs.', '请检查输入。'), 'bad'); return; }
    frames = Math.round(frames);
    var storage = frames * size / 1024;
    var speed = iv * fps;
    var angle = isFinite(sh) ? 360 * sh / iv : NaN;

    var rows = [
      { k: L('Frames to shoot', '需要拍摄帧数'), v: frames.toLocaleString(), big: true },
      { k: L('Final clip length', '成片时长'), v: fmt(clip, 1) + ' s', big: true },
      { k: L('Shooting interval', '拍摄间隔'), v: fmt(iv, 2) + ' s' },
      { k: L('Total shooting time', '总拍摄时长'), v: dur(shoot / 60) },
      { k: L('Speed-up factor', '加速倍数'), v: '×' + fmt(speed, 0) },
      { k: L('Card space needed', '需要存储空间'), v: fmt(storage, 2) + ' GB', cls: storage > 64 ? 'warn' : 'ok' },
      { k: L('Shutter actuations', '快门次数'), v: frames.toLocaleString() }
    ];
    var motion = isFinite(angle) ? [
      { k: L('Equivalent shutter angle', '等效快门角度'), v: fmt(angle, 0) + '°', big: true, cls: (angle < 90 || angle > 300) ? 'warn' : 'ok' },
      { k: L('Exposure duty cycle', '曝光占空比'), v: fmt(100 * sh / iv, 1) + ' %' },
      { k: L('Shutter for a 180° look', '要 180° 观感所需快门'), v: fmtShutter(iv / 2) },
      { k: L('ND stops needed for that', '为此所需 ND 档数'), v: (sh > 0 && iv / 2 > sh) ? fmt(Math.log2((iv / 2) / sh), 1) + ' ' + L('stops', '档') : L('none', '不需要') }
    ] : [];
    var v = isFinite(angle) ? (angle < 90 ? note(L('Below about 90° the motion will look stuttery — each frame freezes too much. Lengthen the shutter with an ND filter.',
      '低于约 90° 时运动会顿挫——每帧都定格得太死。用 ND 镜延长快门。'), 'warn')
      : angle > 300 ? note(L('Above 300° neighbouring frames overlap heavily and fine detail smears. Shorten the shutter or lengthen the interval.',
        '高于 300° 时相邻帧严重重叠，细节被抹掉。缩短快门或拉长间隔。'), 'warn')
        : note(L('This sits in the smooth-motion range — close to the 180° cinema convention.', '这落在顺滑运动区间内——接近电影惯用的 180°。'))) : '';

    $('tl-out').innerHTML = group(L('Shooting plan', '拍摄计划'), rows) +
      (motion.length ? group(L('Motion rendering', '运动表现'), motion, v) : '');

    var W = 620, Hh = 150;
    var g = txt(14, 18, L('Real time compressed into the clip', '真实时间被压缩进成片'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    g += '<rect x="40" y="34" width="540" height="22" rx="5" fill="' + css('--cyan') + '" opacity="0.28"/>';
    g += txt(310, 49, L('shooting ', '拍摄 ') + dur(shoot / 60) + ' · ' + frames + ' ' + L('frames', '帧'), { size: 11.5, fill: css('--cyan') });
    var cw = Math.max(16, 540 * Math.min(1, clip / (shoot || 1)));
    g += '<rect x="40" y="82" width="' + cw + '" height="22" rx="5" fill="' + css('--gold') + '" opacity="0.85"/>';
    g += txt(40 + cw + 8, 97, L('clip ', '成片 ') + fmt(clip, 1) + ' s  (×' + fmt(speed, 0) + ')', { anchor: 'start', size: 11.5, fill: css('--gold'), weight: 700 });
    for (var i = 0; i < Math.min(frames, 60); i++) {
      var x = 40 + i * (540 / Math.min(frames, 60));
      g += '<line x1="' + x.toFixed(1) + '" y1="60" x2="' + x.toFixed(1) + '" y2="70" stroke="' + css('--tx3') + '" stroke-width="1"/>';
    }
    g += txt(40, 128, L('each tick = one exposure (max 60 shown)', '每一刻度 = 一次曝光（最多显示 60）'), { anchor: 'start', size: 9.5, fill: css('--tx3') });
    if (isFinite(angle)) {
      var ax = 520, ay = 122, rr = 15;
      var a2 = Math.min(360, angle);
      var lg = a2 > 180 ? 1 : 0;
      var ex = ax + rr * Math.sin(rad(a2)), ey = ay - rr * Math.cos(rad(a2));
      g += '<circle cx="' + ax + '" cy="' + ay + '" r="' + rr + '" fill="none" stroke="' + css('--line2') + '"/>';
      g += '<path d="M' + ax + ' ' + ay + ' L' + ax + ' ' + (ay - rr) + ' A' + rr + ' ' + rr + ' 0 ' + lg + ' 1 ' + ex.toFixed(1) + ' ' + ey.toFixed(1) + ' Z" fill="' + css('--gold') + '" opacity="0.8"/>';
      g += txt(ax - rr - 8, ay + 4, fmt(angle, 0) + '°', { anchor: 'end', size: 10.5, fill: css('--gold') });
    }
    svg('tl', g, W, Hh);
    cap('tl', L('Top bar is real elapsed time, lower bar the finished clip at the same scale.',
      '上方为真实经过时间，下方为同比例的成片长度。'));
  };

  /* -------------------------------------------------------- 10. Macro */
  TOOLS.macro = function () {
    var s0 = sensorOf(CAM.key), d = camDerived(CAM);
    var f = num('macro-focal', 100), ml = num('macro-mlens', 1), ext = num('macro-ext', 0),
      N = num('macro-aperture', 8), p = num('macro-pupil', 1), c = num('macro-coc', 0.03);
    if (!(f > 0 && N > 0 && p > 0)) { $('macro-out').innerHTML = note(L('Check inputs.', '请检查输入。'), 'bad'); return; }
    var m = ml + ext / f;
    var rows;
    if (m <= 0) {
      rows = [{ k: L('Magnification', '放大倍率'), v: '0 — ' + L('add extension or a macro lens', '请增加接圈或使用微距镜头') }];
      $('macro-out').innerHTML = group(L('Magnification', '放大倍率'), rows); svg('macro', '', 620, 170); return;
    }
    var Neff = N * (1 + m / p);
    var comp = 2 * Math.log2(1 + m / p);
    var dofmm = 2 * N * c * (1 + m / p) / (m * m);
    var subW = s0.w / m, subH = s0.h / m;
    var wd = f * (1 + 1 / m);
    var airy = 2.44 * 0.00055 * Neff;
    var airyPx = airy / d.pitch;

    rows = [
      { k: L('Total magnification', '总放大倍率'), v: fmt(m, 3) + '×  (1:' + fmt(1 / m, 2) + ')', big: true },
      { k: L('Effective aperture', '有效光圈'), v: 'f/' + fmt(Neff, 1), big: true, cls: Neff > 22 ? 'bad' : (Neff > 16 ? 'warn' : 'ok') },
      { k: L('Exposure compensation', '曝光补偿'), v: '+' + fmt(comp, 2) + ' ' + L('stops', '档') },
      { k: L('Depth of field', '景深'), v: fmt(dofmm, 3) + ' mm' },
      { k: L('Subject area covered', '被摄面积'), v: fmt(subW, 1) + ' × ' + fmt(subH, 1) + ' mm' },
      { k: L('Lens-to-subject distance', '镜头到主体距离'), v: fmt(wd, 0) + ' mm' },
      { k: L('Magnification from tube alone', '仅接圈提供的倍率'), v: fmt(ext / f, 3) + '×' },
      { k: L('Airy disk at effective aperture', '有效光圈下艾里斑'), v: fmt(airy * 1000, 1) + ' µm (' + fmt(airyPx, 1) + ' px)', cls: airyPx > 2 ? 'bad' : 'ok' },
      { k: L('Frames for a 5 mm stack', '5 mm 景深合成所需张数'), v: Math.max(1, Math.ceil(5 / dofmm)) }
    ];
    var v = Neff > 22 ? note(L('At an effective f/' + fmt(Neff, 0) + ' diffraction is already limiting: the Airy disk covers ' + fmt(airyPx, 1) +
      ' pixels. Open up and stack ' + Math.max(1, Math.ceil(5 / dofmm)) + ' frames instead of stopping down further.',
      '有效光圈已到 f/' + fmt(Neff, 0) + '，衍射成为瓶颈：艾里斑覆盖 ' + fmt(airyPx, 1) + ' 个像素。与其继续收缩，不如开大光圈并合成约 ' +
      Math.max(1, Math.ceil(5 / dofmm)) + ' 张。'), 'bad')
      : note(L('Effective aperture is f/' + fmt(Neff, 1) + ' — ' + fmt(comp, 1) + ' stops darker than the marked f/' + fmt(N, 1) +
        '. Through-the-lens metering handles this automatically; manual flash calculations do not.',
        '有效光圈为 f/' + fmt(Neff, 1) + '——比标称 f/' + fmt(N, 1) + ' 暗 ' + fmt(comp, 1) +
        ' 档。TTL 测光会自动处理，手动闪光计算不会。'));
    $('macro-out').innerHTML = group(L('Macro geometry', '微距几何'), rows, v);

    var W = 620, Hh = 180;
    var maxmm = Math.max(subW, s0.w) * 1.15;
    var sc = 420 / maxmm;
    var cx = W / 2, cy = 92;
    var g = txt(14, 18, L('Subject area vs sensor, drawn to the same scale', '被摄面积与传感器，按同一比例绘制'), { anchor: 'start', size: 10.5, fill: css('--tx3') });
    g += '<rect x="' + (cx - subW * sc / 2) + '" y="' + (cy - subH * sc / 2) + '" width="' + (subW * sc) + '" height="' + (subH * sc) +
      '" fill="' + css('--cyan') + '" fill-opacity="0.10" stroke="' + css('--cyan') + '" stroke-width="2" rx="3"/>';
    g += '<rect x="' + (cx - s0.w * sc / 2) + '" y="' + (cy - s0.h * sc / 2) + '" width="' + (s0.w * sc) + '" height="' + (s0.h * sc) +
      '" fill="none" stroke="' + css('--gold') + '" stroke-width="2" stroke-dasharray="5 4" rx="3"/>';
    g += txt(cx, 34, L('subject ', '被摄 ') + fmt(subW, 1) + ' × ' + fmt(subH, 1) + ' mm', { size: 11, fill: css('--cyan'), weight: 700 });
    g += txt(cx, Hh - 26, L('sensor ', '传感器 ') + fmt(s0.w, 1) + ' × ' + fmt(s0.h, 1) + ' mm', { size: 11, fill: css('--gold') });
    var dw = Math.max(2, dofmm * sc);
    g += '<rect x="' + (cx - dw / 2) + '" y="' + (Hh - 16) + '" width="' + dw + '" height="7" fill="' + css('--rose') + '" rx="2"/>';
    g += txt(cx + dw / 2 + 8, Hh - 9, L('depth of field ', '景深 ') + fmt(dofmm, 2) + ' mm', { anchor: 'start', size: 10, fill: css('--rose') });
    svg('macro', g, W, Hh);
    cap('macro', L('The dashed rectangle is your sensor; the solid one is the real-world area it records.',
      '虚线框为传感器，实线框为它实际记录的真实世界面积。'));
  };

  /* -------------------------------------------------------------- wiring */
  function renderAll() {
    var panels = document.querySelectorAll('.panel[data-tool]');
    for (var i = 0; i < panels.length; i++) {
      var id = panels[i].getAttribute('data-tool');
      if (TOOLS[id]) { try { TOOLS[id](); } catch (e) { if (window.console) console.error('tool ' + id, e); } }
    }
  }

  function initTabs() {
    var tabs = document.querySelectorAll('.tab');
    if (!tabs.length) return;
    function show(target) {
      var ps = document.querySelectorAll('.panels .panel');
      for (var i = 0; i < ps.length; i++) ps[i].classList.toggle('active', ps[i].id === target);
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('active', tabs[j].getAttribute('data-target') === target);
    }
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        var t = this.getAttribute('data-target');
        show(t);
        if (history.replaceState) history.replaceState(null, '', '#' + t);
        var el = document.getElementById(t);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    var h = location.hash.replace('#', '');
    show(document.getElementById(h) && h.indexOf('tool-') === 0 ? h : tabs[0].getAttribute('data-target'));
  }

  var timer = null;
  function debounced() { clearTimeout(timer); timer = setTimeout(renderAll, 60); }

  function init() {
    /* language */
    var q = new URLSearchParams(location.search).get('lang');
    var stored = null;
    try { stored = localStorage.getItem('stoplume.lang'); } catch (e) { }
    LANG = (q === 'zh' || q === 'en') ? q : (stored || ((navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'));

    /* theme */
    var th = 'dark';
    try { th = localStorage.getItem('stoplume.theme') || 'dark'; } catch (e) { }
    document.documentElement.setAttribute('data-theme', th);

    var lb = $('lang-btn');
    if (lb) lb.addEventListener('click', function () {
      LANG = LANG === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem('stoplume.lang', LANG); } catch (e) { }
      applyLang(); syncCamUI();
    });
    var tb = $('theme-btn');
    if (tb) tb.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem('stoplume.theme', cur); } catch (e) { }
      renderAll();
    });

    /* camera profile */
    loadCam();
    if ($('cam-sensor')) {
      $('cam-sensor').addEventListener('change', function () {
        CAM.key = this.value;
        if (CAM.key !== 'custom') { CAM.w = SENSORS[CAM.key].w; CAM.h = SENSORS[CAM.key].h; }
        saveCam(); syncCamUI(); renderAll();
      });
      ['cam-w', 'cam-h', 'cam-mp'].forEach(function (id) {
        $(id).addEventListener('input', function () {
          CAM.w = num('cam-w', 36); CAM.h = num('cam-h', 24); CAM.mp = num('cam-mp', 24);
          saveCam(); syncCamUI(); debounced();
        });
      });
    }

    /* default date = today */
    if ($('sun-date') && !$('sun-date').value) {
      var n = new Date();
      $('sun-date').value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
      var off = -n.getTimezoneOffset() / 60;
      if ($('sun-tz')) $('sun-tz').value = off;
      if ($('sun-lat') && !$('sun-lat').dataset.set) { /* keep default NYC coords, tz from browser */ }
    }
    ['sun-place', 'exp-scene'].forEach(function (id) {
      var e = $(id); if (e) e.addEventListener('change', function () { this.dataset.touched = '1'; });
    });

    /* recompute on any input */
    var inputs = document.querySelectorAll('.panel input, .panel select');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', debounced);
      inputs[i].addEventListener('change', debounced);
    }

    initTabs();
    applyLang();
    syncCamUI();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
