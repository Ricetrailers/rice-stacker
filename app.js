/* Rice Stacker app */
(function () {
'use strict';

/* ---------- tiny utils ---------- */
function $(id) { return document.getElementById(id); }
function h(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === false || attrs[k] == null) {}
    else e.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) {
    if (c == null) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}
function svgEl(tag, attrs) {
  var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  return e;
}
function toast(msg, bad) {
  var t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, [msg]);
  $('toasts').appendChild(t);
  setTimeout(function () { t.remove(); }, bad ? 5200 : 3200);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
// In-app dialogs — the browser's prompt()/confirm() are blocked inside the
// artifact sandbox, so anything that used them silently did nothing.
function promptModal(title, initial, cb, placeholder) {
  var inp = h('input', { value: initial || '', placeholder: placeholder || '', style: 'width:100%' });
  var scrim = h('div', { class: 'modal-scrim' });
  function ok() {
    var v = inp.value.trim();
    scrim.remove();
    if (v) cb(v);
  }
  scrim.appendChild(h('div', { class: 'modal small' }, [
    h('div', { class: 'modal-head' }, [
      h('h2', { style: 'font-size:17px' }, [title]),
      h('button', { class: 'iconbtn', onclick: function () { scrim.remove(); } }, ['✕'])
    ]),
    h('div', { class: 'modal-body' }, [inp]),
    h('div', { class: 'modal-foot' }, [
      h('button', { class: 'btn', onclick: function () { scrim.remove(); } }, ['Cancel']),
      h('button', { class: 'btn primary', onclick: ok }, ['OK'])
    ])
  ]));
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') ok();
    if (e.key === 'Escape') scrim.remove();
    e.stopPropagation();
  });
  document.body.appendChild(scrim);
  setTimeout(function () { inp.focus(); inp.select(); }, 0);
}
function confirmModal(msg, cb, opts) {
  opts = opts || {};
  var scrim = h('div', { class: 'modal-scrim' });
  scrim.appendChild(h('div', { class: 'modal small' }, [
    h('div', { class: 'modal-body', style: 'padding-top:20px;font-size:14.5px;line-height:1.5' }, [msg]),
    h('div', { class: 'modal-foot' }, [
      h('button', { class: 'btn', onclick: function () { scrim.remove(); if (opts.onCancel) opts.onCancel(); } }, [opts.cancelLabel || 'Cancel']),
      h('button', {
        class: 'btn primary', style: opts.danger ? 'background:var(--bad);border-color:var(--bad)' : '',
        onclick: function () { scrim.remove(); cb(); }
      }, [opts.okLabel || 'OK'])
    ])
  ]));
  document.body.appendChild(scrim);
}
function ftin(inches) {
  if (!isFinite(inches)) return '–';
  var neg = inches < 0; inches = Math.abs(inches);
  var ft = Math.floor(inches / 12);
  var rem = Math.round(inches - ft * 12);
  if (rem >= 12) { ft++; rem = 0; }
  var s = (ft ? ft + "'" : '') + (rem || !ft ? (ft ? '-' : '') + rem + '"' : '');
  return (neg ? '-' : '') + s;
}
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/* ---------- state ---------- */
var seed = { rev: 0, profiles: [] };   // filled from seed.json at boot
var state = null;           // {v, profiles:[], loads:[]}
var pendingURLs = {};       // path -> objectURL for photos added this session
var dirty = false;
var saving = false;
var saveTimer = null;
var route = { view: 'home', loadId: null };
var pathCache = {};         // profileId -> svg path d

function defaultState() {
  var s = { v: 1, seedRev: seed.rev || 0, profiles: seed.profiles.slice(), loads: [], folders: [], keys: {} };
  migrateGroups(s);
  return s;
}
/* ---------- library groups ---------- */
function guessGroup(p) {
  var n = (p.name || '').toLowerCase();
  if (p.kind === 'truck') return 'Carriers';
  if (n.indexOf('gooseneck') !== -1) return 'Goosenecks';
  if (n.indexOf('deckover') !== -1 || n.indexOf('pierce beam') !== -1 || /\+5 hd/.test(n)) return 'Deckovers';
  if (n.indexOf('heavy fb') !== -1) return 'Heavy FB';
  if (n.indexOf('med fb') !== -1) return 'MED FB';
  if (n.indexOf('tilt') !== -1) return 'Tilts';
  if (n.indexOf('ta utility') !== -1 || n.indexOf('utility') !== -1) return 'Utility';
  if (n.indexOf('stealth') !== -1 || n.indexOf('atv') !== -1) return 'Stealth / ATV';
  if (n.indexOf('dump') !== -1) return 'Dumps';
  if (n.indexOf('work series') !== -1 || n.indexOf('i-beam') !== -1) return 'Work Series';
  if (/\bfb\b/.test(n)) return 'Flatbeds (FB)';
  return '';
}
function migrateGroups(s) {
  var changed = false;
  if (!(s.groupsRev >= 1)) {
    s.profiles.forEach(function (p) { if (p.group == null || p.group === '') p.group = guessGroup(p); });
    changed = true;
  }
  if (!s.folders) { s.folders = []; changed = true; }
  if (!(s.groupsRev >= 2)) { s.groupsRev = 2; changed = true; }
  return changed;
}
// Folders are slash-separated paths ("Deckovers/HD"). A profile's .group is the
// path of the folder it lives in ('' = ungrouped). state.folders keeps paths that
// exist even while empty.
function normPath(p) {
  return String(p || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean).join('/');
}
function folderList() {
  var seen = {};
  (state.folders || []).forEach(function (f) { var n = normPath(f); if (n) seen[n] = 1; });
  state.profiles.forEach(function (p) {
    var n = normPath(p.group);
    while (n) { seen[n] = 1; n = n.indexOf('/') === -1 ? '' : n.slice(0, n.lastIndexOf('/')); }
  });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
}
function childFolders(path) {
  var pre = path ? path + '/' : '';
  var seen = {};
  folderList().forEach(function (f) {
    if (path) {
      if (f.indexOf(pre) !== 0) return;
      seen[f.slice(pre.length).split('/')[0]] = 1;
    } else {
      seen[f.split('/')[0]] = 1;
    }
  });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
}
function profilesIn(path, deep) {
  return state.profiles.filter(function (p) {
    var g = normPath(p.group);
    if (deep) return path === '' ? true : (g === path || g.indexOf(path + '/') === 0);
    return g === path;
  });
}
function addFolder(path) {
  path = normPath(path);
  if (!path) return;
  if (folderList().indexOf(path) === -1) {
    state.folders = state.folders || [];
    state.folders.push(path);
    markDirty();
  }
}
function renameFolder(oldPath, newName) {
  oldPath = normPath(oldPath);
  var parent = oldPath.indexOf('/') === -1 ? '' : oldPath.slice(0, oldPath.lastIndexOf('/'));
  var newPath = normPath(parent ? parent + '/' + newName : newName);
  if (!oldPath || !newPath || oldPath === newPath) return;
  state.folders = (state.folders || []).map(function (f) {
    var n = normPath(f);
    if (n === oldPath) return newPath;
    if (n.indexOf(oldPath + '/') === 0) return newPath + n.slice(oldPath.length);
    return n;
  });
  if (state.folders.indexOf(newPath) === -1) state.folders.push(newPath);
  state.profiles.forEach(function (p) {
    var g = normPath(p.group);
    if (g === oldPath) p.group = newPath;
    else if (g.indexOf(oldPath + '/') === 0) p.group = newPath + g.slice(oldPath.length);
  });
  markDirty();
}
function repathFolder(oldPath, newPath) {
  state.folders = (state.folders || []).map(function (f) {
    var n = normPath(f);
    if (n === oldPath) return newPath;
    if (n.indexOf(oldPath + '/') === 0) return newPath + n.slice(oldPath.length);
    return n;
  });
  if (state.folders.indexOf(newPath) === -1) state.folders.push(newPath);
  state.profiles.forEach(function (p) {
    var g = normPath(p.group);
    if (g === oldPath) p.group = newPath;
    else if (g.indexOf(oldPath + '/') === 0) p.group = newPath + g.slice(oldPath.length);
  });
  markDirty();
}
function moveFolderDlg(path) {
  path = normPath(path);
  var name = path.split('/').pop();
  var sel = h('select', { style: 'width:100%' });
  sel.appendChild(h('option', { value: '' }, ['(top level)']));
  folderList().forEach(function (f) {
    if (f === path || f.indexOf(path + '/') === 0) return;   // can't move into itself
    var parent = path.indexOf('/') === -1 ? '' : path.slice(0, path.lastIndexOf('/'));
    var depth = f.split('/').length - 1;
    var pad = '';
    for (var d = 0; d < depth; d++) pad += ' ';
    var o = h('option', { value: f }, [pad + f.split('/').pop()]);
    o.title = f;
    if (f === parent) o.selected = true;
    sel.appendChild(o);
  });
  var scrim = h('div', { class: 'modal-scrim' });
  function ok() {
    var dest = sel.value;
    var newPath = normPath(dest ? dest + '/' + name : name);
    scrim.remove();
    if (newPath === path) return;
    if (folderList().indexOf(newPath) !== -1) { toast('There’s already a folder called "' + name + '" there', true); return; }
    repathFolder(path, newPath);
    libState.cur = newPath;
    // open the destination chain so the moved folder is visible
    var chain = '';
    newPath.split('/').slice(0, -1).forEach(function (part) {
      chain = chain ? chain + '/' + part : part;
      libState.open[chain] = true;
    });
    renderRoute();
    toast('Moved to ' + (dest || 'top level'));
  }
  scrim.appendChild(h('div', { class: 'modal small' }, [
    h('div', { class: 'modal-head' }, [
      h('h2', { style: 'font-size:17px' }, ['Move "' + name + '" into…']),
      h('button', { class: 'iconbtn', onclick: function () { scrim.remove(); } }, ['✕'])
    ]),
    h('div', { class: 'modal-body' }, [
      sel,
      h('p', { style: 'color:var(--muted);font-size:12.5px;margin:10px 0 0' }, ['Everything inside moves with it — subfolders and models.'])
    ]),
    h('div', { class: 'modal-foot' }, [
      h('button', { class: 'btn', onclick: function () { scrim.remove(); } }, ['Cancel']),
      h('button', { class: 'btn primary', onclick: ok }, ['Move'])
    ])
  ]));
  document.body.appendChild(scrim);
}
function deleteFolder(path) {
  path = normPath(path);
  var parent = path.indexOf('/') === -1 ? '' : path.slice(0, path.lastIndexOf('/'));
  state.folders = (state.folders || []).filter(function (f) {
    var n = normPath(f);
    return n !== path && n.indexOf(path + '/') !== 0;
  });
  state.profiles.forEach(function (p) {
    var g = normPath(p.group);
    if (g === path || g.indexOf(path + '/') === 0) p.group = parent;
  });
  markDirty();
}
function folderPicker(current, onPick, allowNew) {
  var sel = h('select', { class: 'kindsel' });
  sel.appendChild(h('option', { value: '' }, ['(no folder)']));
  folderList().forEach(function (f) {
    var depth = f.split('/').length - 1;
    var pad = '';
    for (var d = 0; d < depth; d++) pad += ' ';
    var o = h('option', { value: f }, [pad + f.split('/').pop()]);
    o.title = f;
    if (f === current) o.selected = true;
    sel.appendChild(o);
  });
  if (allowNew) sel.appendChild(h('option', { value: ' new' }, ['+ New folder…']));
  sel.addEventListener('change', function () {
    var v = sel.value;
    if (v.trim() === 'new') {
      sel.value = current || '';
      promptModal('New folder path (use / for a subfolder)', '', function (name) {
        if (!normPath(name)) return;
        var p2 = normPath(name);
        addFolder(p2);
        onPick(p2);
      }, 'e.g. Deckovers/HD');
      return;
    }
    onPick(v);
  });
  return sel;
}

// Bring new built-in library profiles into an existing saved state (once per seed rev)
function mergeSeed(s) {
  if ((s.seedRev || 1) >= (seed.rev || 1)) return false;
  var have = {};
  s.profiles.forEach(function (p) { have[p.id] = 1; });
  var added = 0;
  seed.profiles.forEach(function (p) {
    if (!have[p.id]) {
      if (p.group == null || p.group === '') p.group = guessGroup(p);
      s.profiles.push(p); added++;
    }
  });
  s.seedRev = seed.rev || 1;
  if (added) toast(added + ' trailer profiles added to your library from the Rice master sheet');
  return true;
}

/* ---------- builtin carrier profiles ---------- */
function makeCarrier(id, name, segs) {
  // segs: deck segments front-to-back, [{len, y}] — y is deck-top height in inches.
  var P = [];
  function circle(cx, cy, r, n) {
    var pts = [];
    for (var a = 0; a <= n; a++) { var t = a / n * Math.PI * 2; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    P.push(pts);
  }
  function wheel(cx) { circle(cx, 20, 20, 28); circle(cx, 20, 12.5, 20); circle(cx, 20, 4, 12); }
  function arcPts(cx, cy, r, a0, a1, n) {
    var pts = [];
    for (var a = 0; a <= n; a++) { var t = a0 + (a1 - a0) * a / n; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    return pts;
  }
  /* ----- conventional tractor ----- */
  // bumper
  P.push([[6, 14], [6, 32], [14, 32], [14, 14], [6, 14]]);
  // hood: grille face, hood top curve to windshield base
  P.push([[14, 32], [14, 60], [17, 63], [36, 67.5], [58, 71], [74, 75]]);
  // windshield, roof, back of cab
  P.push([[74, 75], [88, 102], [95, 106], [136, 106], [136, 40]]);
  // fender arch over steer wheel
  P.push(arcPts(58, 40, 26, Math.PI, 0, 14));
  // hood bottom edge ahead of the arch
  P.push([[14, 44], [33, 44]]);
  // door with window
  P.push([[92, 41], [92, 96], [118, 96], [118, 41]]);
  P.push([[95, 72], [95, 93], [115, 93], [115, 72], [95, 72]]);
  // grab handle + door seam
  P.push([[89, 60], [89, 84]]);
  // mirror
  P.push([[86, 95], [81, 95], [81, 85]]);
  P.push([[79, 85], [83, 85], [83, 73], [79, 73], [79, 85]]);
  // exhaust stack behind cab
  P.push([[139, 40], [139, 111]]);
  P.push([[144, 40], [144, 111]]);
  P.push([[137, 111], [146, 111]]);
  // frame rails
  P.push([[84, 40], [260, 40]]);
  P.push([[84, 34], [260, 34], [260, 40]]);
  // fuel tank (capsule)
  (function () {
    var t = arcPts(102, 28, 8, Math.PI / 2, Math.PI * 1.5, 8)
      .concat(arcPts(130, 28, 8, Math.PI * 1.5, Math.PI * 2.5, 8));
    t.push(t[0]);
    P.push(t);
  })();
  // cab steps
  P.push([[88, 33], [100, 33], [100, 29], [88, 29], [88, 33]]);
  P.push([[90, 25], [98, 25], [98, 21], [90, 21], [90, 25]]);
  // fifth wheel ramp between the drives
  P.push([[190, 40], [198, 47], [242, 47], [250, 40]]);
  // tractor axles: steer + tandem drives
  wheel(58); wheel(198); wheel(242);
  // drive-axle mudflap
  P.push([[264, 34], [264, 12], [270, 12], [270, 34]]);

  /* ----- trailer deck ----- */
  var dx0 = 150;
  var x = dx0;
  var rail = 5; // deck structure depth
  segs.forEach(function (sg, i) {
    var x1 = x + sg.len;
    P.push([[x, sg.y], [x1, sg.y]]);                 // deck top
    P.push([[x, sg.y - rail], [x1, sg.y - rail]]);   // bottom rail
    if (i === 0) P.push([[x, sg.y], [x, sg.y - rail]]);
    for (var hx = x + 24; hx < x1; hx += 24) P.push([[hx, sg.y], [hx - 8, sg.y - rail]]); // deck ticks
    for (var sx = x + 36; sx < x1 - 12; sx += 48) { // stake pockets under the rail
      P.push([[sx, sg.y - rail], [sx, sg.y - rail - 4], [sx + 5, sg.y - rail - 4], [sx + 5, sg.y - rail]]);
    }
    var nxt = segs[i + 1];
    if (nxt) {
      P.push([[x1, sg.y], [x1, nxt.y]]);
      P.push([[x1, sg.y - rail], [x1 + (nxt.y < sg.y ? rail : -rail), nxt.y - rail]]);
      if (nxt.y < sg.y) P.push([[x1, nxt.y - rail], [x1 - 14, nxt.y - rail], [x1, sg.y - rail]]); // gusset on the drop
    } else {
      P.push([[x1, sg.y], [x1, sg.y - rail]]);
    }
    x = x1;
  });
  var dx1 = x;
  // landing gear: two legs, foot pad, diagonal brace
  var lg = dx0 + Math.min(segs[0].len + 16, 118);
  var lgTop = segs[0].y - rail;
  var lowY = segs[segs.length > 1 ? 1 : 0].y - rail;
  P.push([[lg, lgTop], [lg, 24]]);
  P.push([[lg + 10, lgTop], [lg + 10, 24]]);
  P.push([[lg - 3, 24], [lg + 13, 24], [lg + 13, 20], [lg - 3, 20], [lg - 3, 24]]);
  P.push([[lg + 10, 34], [lg + 42, Math.min(lowY, segs[0].y - rail)]]); // brace
  // tandem slider frame + axles
  P.push([[dx1 - 132, 33], [dx1 - 26, 33], [dx1 - 26, 26], [dx1 - 132, 26], [dx1 - 132, 33]]);
  wheel(dx1 - 55); wheel(dx1 - 104);
  // rear underride bar + mudflap
  P.push([[dx1 - 4, segs[segs.length - 1].y - rail], [dx1 - 4, 18]]);
  P.push([[dx1 - 18, 18], [dx1, 18], [dx1, 13], [dx1 - 18, 13], [dx1 - 18, 18]]);
  P.push([[dx1 - 30, 26], [dx1 - 30, 10], [dx1 - 24, 10], [dx1 - 24, 26]]);
  // deck0/deck1: where cargo may sit — auto stack keeps everything inside this span
  return { id: id, name: name, kind: 'truck', width: dx1, height: 111, polylines: P, builtin: true, deck0: dx0, deck1: dx1 };
}
var builtins = [
  // 53' & 48' step (drop) decks: 11' top deck at 60", main deck at 40"
  makeCarrier('b:step53', 'Semi + 53′ drop deck (40" main)', [{ len: 132, y: 60 }, { len: 636 - 132, y: 40 }]),
  makeCarrier('b:step48', 'Semi + 48′ drop deck (40" main)', [{ len: 132, y: 60 }, { len: 576 - 132, y: 40 }]),
  // flat decks at 60"
  makeCarrier('b:semi', 'Semi + 53′ flat deck (60")', [{ len: 636, y: 60 }]),
  makeCarrier('b:flat48', 'Semi + 48′ flat deck (60")', [{ len: 576, y: 60 }]),
  // double drop / RGN: 10' front deck at 60", low well at 24", 9' rear deck at 40"
  makeCarrier('b:rgn53', 'Semi + 53′ double drop (24" well)', [{ len: 120, y: 60 }, { len: 636 - 120 - 108, y: 24 }, { len: 108, y: 40 }])
];
function getProfile(id) {
  for (var i = 0; i < builtins.length; i++) if (builtins[i].id === id) return builtins[i];
  for (var j = 0; j < state.profiles.length; j++) if (state.profiles[j].id === id) return state.profiles[j];
  return null;
}
function profilePath(p) {
  if (p.id && pathCache[p.id]) return pathCache[p.id];
  var d = p.polylines.map(function (pl) {
    return 'M' + pl.map(function (pt) { return pt[0] + ' ' + pt[1]; }).join('L');
  }).join('');
  if (p.id) pathCache[p.id] = d;   // never cache id-less previews (import clusters)
  return d;
}
function thumbSVG(p, maxW, maxH) {
  var pad = 2, ox = p.ox || 0, oy = p.oy || 0;
  var svg = svgEl('svg', { viewBox: (ox - pad) + ' ' + (-(oy + p.height) - pad) + ' ' + (p.width + pad * 2) + ' ' + (p.height + pad * 2) });
  var g = svgEl('g', { transform: 'scale(1,-1)' });
  var path = svgEl('path', { d: profilePath(p), fill: 'none', stroke: 'var(--draw)', 'stroke-width': Math.max(p.width, p.height) / 220, 'stroke-linecap': 'round' });
  g.appendChild(path); svg.appendChild(g);
  if (maxW) { svg.style.maxWidth = maxW + 'px'; }
  if (maxH) { svg.style.maxHeight = maxH + 'px'; }
  return svg;
}

/* ---------- photos (Supabase storage) ---------- */
var photoUrlCache = {};    // storage path -> displayable url (object url or signed url)
function getPhotoURL(ph, cb) {
  if (photoUrlCache[ph.file]) { cb(photoUrlCache[ph.file]); return; }
  RS_STORAGE.photoUrl(ph.file).then(function (u) {
    if (u) photoUrlCache[ph.file] = u;
    cb(u);
  }).catch(function () { cb(null); });
}

/* ---------- persistence ---------- */
var lastSavedAt = null;
var dirtySince = null;
var manualSave = false;
function markDirty() {
  dirty = true;
  if (!dirtySince) dirtySince = Date.now();
  updateSaveChip();
  if (saveTimer) clearTimeout(saveTimer);
  // save quickly after a pause — but never let continuous editing hold a save
  // hostage for more than 15 seconds
  if (Date.now() - dirtySince > 15000) saveNow();
  else saveTimer = setTimeout(saveNow, 2500);
}
function fmtClock(ts) {
  var d = new Date(ts);
  var hh = d.getHours() % 12 || 12;
  var mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm + (d.getHours() < 12 ? ' am' : ' pm');
}
function updateSaveChip() {
  var c = $('saveChip');
  var btn = $('btnSave');
  function set(cls, icon, text) {
    c.className = 'savepill ' + cls;
    c.innerHTML = '';
    c.appendChild(h('span', { class: 'sp-ic' }, [icon]));
    c.appendChild(h('span', null, [text]));
  }
  if (btn) btn.hidden = false;
  if (RS_STORAGE.mock) {
    if (saving || dirty) set('dirty', '●', 'DEV MODE — saving in-memory only');
    else set('quiet', '·', 'DEV MODE (no config.js)');
    if (btn) { btn.disabled = !dirty; btn.textContent = dirty ? 'Save now' : 'Save'; }
    return;
  }
  if (saving) {
    set('busy', '◌', 'Saving…');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  } else if (dirty) {
    set('dirty', '●', 'Unsaved changes');
    if (btn) { btn.disabled = false; btn.textContent = 'Save now'; }
  } else if (lastSavedAt) {
    set('ok', '✓', 'Saved ' + fmtClock(lastSavedAt));
    if (btn) { btn.disabled = true; btn.textContent = '✓ Saved'; }
  } else {
    set('quiet', '·', 'Auto-save on');
    if (btn) { btn.disabled = true; btn.textContent = 'Save'; }
  }
}
var lastSavedSnap = null;   // {profiles: {id: json}, loads: {id: json}, folders: json, settings: {k: json}}
function snapOf(state0) {
  var s = { profiles: {}, loads: {}, folders: JSON.stringify(state0.folders || []), settings: {} };
  state0.profiles.forEach(function (p) { s.profiles[p.id] = JSON.stringify(p); });
  state0.loads.forEach(function (l) { s.loads[l.id] = JSON.stringify(l); });
  ['keys', 'seedRev', 'groupsRev'].forEach(function (k) { s.settings[k] = JSON.stringify(state0[k] === undefined ? null : state0[k]); });
  return s;
}
function computeDiff() {
  var snap = lastSavedSnap || { profiles: {}, loads: {}, folders: '[]', settings: {} };
  var diff = { profiles: { upsert: [], remove: [] }, loads: { upsert: [], remove: [] }, folders: null, settings: {} };
  var seenP = {}, seenL = {};
  state.profiles.forEach(function (p) {
    seenP[p.id] = 1;
    if (snap.profiles[p.id] !== JSON.stringify(p)) diff.profiles.upsert.push(p);
  });
  Object.keys(snap.profiles).forEach(function (id) { if (!seenP[id]) diff.profiles.remove.push(id); });
  state.loads.forEach(function (l) {
    seenL[l.id] = 1;
    if (snap.loads[l.id] !== JSON.stringify(l)) diff.loads.upsert.push(l);
  });
  Object.keys(snap.loads).forEach(function (id) { if (!seenL[id]) diff.loads.remove.push(id); });
  var foldersNow = JSON.stringify(state.folders || []);
  if (foldersNow !== snap.folders) diff.folders = (state.folders || []).slice();
  ['keys', 'seedRev', 'groupsRev'].forEach(function (k) {
    var v = JSON.stringify(state[k] === undefined ? null : state[k]);
    if (v !== snap.settings[k]) diff.settings[k] = state[k] === undefined ? null : state[k];
  });
  return diff;
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty || saving) return;
  state.updatedAt = Date.now();
  saving = true; updateSaveChip();
  var diff = computeDiff();
  RS_STORAGE.saveDiff(diff).then(function () {
    saving = false; dirty = false; dirtySince = null;
    lastSavedAt = Date.now();
    lastSavedSnap = snapOf(state);
    updateSaveChip();
    if (manualSave) { manualSave = false; toast('✓ All changes saved'); }
  }).catch(function (err) {
    manualSave = false;
    saving = false;
    toast('Save failed' + (err && err.message ? ' — ' + err.message : '') + '. Will retry.', true);
    dirty = true;
    setTimeout(saveNow, 5000);
    updateSaveChip();
  });
}
window.addEventListener('beforeunload', function (e) {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', function () {
  if (document.hidden && dirty && !saving) saveNow();
});
window.addEventListener('pagehide', function () {
  if (dirty && !saving) saveNow();
});

/* ---------- boot ---------- */
function showAuthGate(msg) {
  var gate = $('authGate');
  gate.hidden = false;
  document.querySelector('.app').style.display = 'none';
  if (msg) $('authMsg').textContent = msg;
  $('authBtn').onclick = function () {
    $('authMsg').textContent = '';
    $('authBtn').disabled = true;
    RS_STORAGE.signIn($('authEmail').value.trim(), $('authPass').value).then(function () {
      $('authBtn').disabled = false;
      gate.hidden = true;
      document.querySelector('.app').style.display = '';
      startApp();
    }).catch(function (err) {
      $('authBtn').disabled = false;
      $('authMsg').textContent = err && err.message ? err.message : 'Sign-in failed';
    });
  };
  $('authPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('authBtn').click(); });
}
function startApp() {
  Promise.all([
    fetch('seed.json').then(function (r) { return r.ok ? r.json() : { rev: 0, profiles: [] }; }).catch(function () { return { rev: 0, profiles: [] }; }),
    RS_STORAGE.loadAll()
  ]).then(function (res) {
    seed = res[0];
    var data = res[1];
    state = {
      v: 1,
      profiles: data.profiles || [],
      loads: data.loads || [],
      folders: data.folders || [],
      seedRev: data.settings && data.settings.seedRev != null ? data.settings.seedRev : 0,
      groupsRev: data.settings && data.settings.groupsRev != null ? data.settings.groupsRev : 0,
      keys: (data.settings && data.settings.keys) || {}
    };
    lastSavedSnap = snapOf(state);
    var changed = mergeSeed(state);
    if (migrateGroups(state)) changed = true;
    if (changed) markDirty();
    renderRoute();
  }).catch(function (err) {
    toast('Couldn’t load data' + (err && err.message ? ': ' + err.message : '') + ' — check config.js and your connection', true);
    state = defaultState();
    renderRoute();
  });
}
function boot() {
  state = defaultState();
  renderRoute();     // paint immediately; data arrives right behind
  RS_STORAGE.init().then(function (res) {
    if (res.user) startApp();
    else showAuthGate();
  }).catch(function () { showAuthGate('Couldn’t reach the server — check config.js'); });
}

/* ---------- backup export / import ---------- */
function blobToB64(blob) {
  return new Promise(function (res) {
    var fr = new FileReader();
    fr.onload = function () { res(String(fr.result).split(',')[1] || ''); };
    fr.onerror = function () { res(''); };
    fr.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type) {
  try {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'image/jpeg' });
  } catch (e) { return null; }
}
function exportBackup() {
  toast('Preparing backup…');
  var paths = [];
  state.loads.forEach(function (l) { l.photos.forEach(function (ph) { paths.push(ph.file); }); });
  var photoJobs = paths.map(function (p) {
    return new Promise(function (res) {
      getPhotoURL({ file: p }, function (u) {
        if (!u) return res([p, null]);
        fetch(u).then(function (r) { return r.ok ? r.blob() : null; }).then(function (bl) { res([p, bl]); }).catch(function () { res([p, null]); });
      });
    });
  });
  Promise.all(photoJobs).then(function (pairs) {
    return Promise.all(pairs.map(function (pr) {
      if (!pr[1]) return null;
      return blobToB64(pr[1]).then(function (b64) { return [pr[0], b64]; });
    }));
  }).then(function (encoded) {
    var photos = {};
    (encoded || []).forEach(function (e) { if (e && e[1]) photos[e[0]] = e[1]; });
    var payload = JSON.stringify({ app: 'rice-stacker', v: 1, exported: Date.now(), state: state, photos: photos });
    var d = new Date();
    var name = 'rice-stacker-backup-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
    var url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    var aEl = h('a', { href: url, download: name });
    document.body.appendChild(aEl);
    aEl.click();
    aEl.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('Backup downloaded');
  });
}
function importBackup() {
  var inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.addEventListener('change', function () {
    var f = inp.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      var obj;
      try { obj = JSON.parse(fr.result); } catch (e) { toast('That file isn’t a Rice Stacker backup', true); return; }
      // accept both an exported backup and a raw data/state.json
      if (obj && obj.v && obj.profiles && obj.loads && !obj.app) obj = { app: 'rice-stacker', exported: obj.updatedAt || 0, state: obj, photos: {} };
      if (!obj || obj.app !== 'rice-stacker' || !obj.state || !obj.state.v) { toast('That file isn’t a Rice Stacker backup', true); return; }
      confirmModal('Replace the current library and loads with this backup from ' + new Date(obj.exported || 0).toLocaleString() + '?', function () {
      state = obj.state;
      mergeSeed(state); migrateGroups(state);
      var photoPaths = Object.keys(obj.photos || {});
      var uploaded = 0;
      photoPaths.forEach(function (p) {
        var blob = b64ToBlob(obj.photos[p]);
        if (!blob) return;
        photoUrlCache[p] = URL.createObjectURL(blob);
        RS_STORAGE.uploadPhoto(p, blob).then(function () {
          uploaded++;
          if (uploaded === photoPaths.length) toast('All ' + uploaded + ' photos uploaded');
        }).catch(function () { toast('Photo upload failed for ' + p, true); });
      });
      markDirty();
      renderRoute();
      toast('Backup restored — saving it now');
      }, { okLabel: 'Replace' });
    };
    fr.readAsText(f);
  });
  inp.click();
}

/* ---------- routing ---------- */
function go(view, loadId) {
  route = { view: view, loadId: loadId || null, profileId: route.profileId };
  renderRoute();
}
function goDraw(profileId) {
  route = { view: 'draw', loadId: null, profileId: profileId };
  renderRoute();
}
function currentLoad() {
  if (!route.loadId) return null;
  for (var i = 0; i < state.loads.length; i++) if (state.loads[i].id === route.loadId) return state.loads[i];
  return null;
}
/* ---------- tabs: each open workspace keeps its spot ---------- */
var openLoadTabs = [];      // loads being stacked (tabs, in open order)
var openDrawTabs = [];      // trailer drawings being edited (tabs)
var loadUiCache = {};       // loadId -> viewport/selection/measures/undo…
var drawCache = {};         // profileId -> unsaved polys/undo/viewport…
function stashCurrentView() {
  // key off what's actually on screen — the route has already moved on
  if (editor && editor.ld) {
    loadUiCache[editor.ld.id] = {
      viewport: editor.viewport, sel: editor.sel, measures: editor.measures,
      palChecked: editor.palChecked, palOpen: editor.palOpen,
      undo: editor.undo, redo: editor.redo, pivots: editor.pivots
    };
  }
  if (window.__drawStash) {
    window.__drawStash();
    window.__drawStash = null;   // re-registered when the drawing view rebuilds
  }
}
function findProfileById(id) {
  for (var i = 0; i < state.profiles.length; i++) if (state.profiles[i].id === id) return state.profiles[i];
  return null;
}
var lastTabSig = '';
function renderTabs() {
  var c = $('crumb');
  // build a signature first — rebuilding identical tabs mid-click would eat the click
  var sig = [route.view, route.loadId, route.profileId];
  openLoadTabs.forEach(function (id) {
    var ld = null;
    for (var i = 0; i < state.loads.length; i++) if (state.loads[i].id === id) ld = state.loads[i];
    sig.push('L' + id + ':' + (ld ? ld.loadNo : 'gone'));
  });
  openDrawTabs.forEach(function (id) {
    var p = findProfileById(id);
    var dc = drawCache[id];
    sig.push('D' + id + ':' + (p ? p.name : 'gone') + ':' + (dc && dc.dirty ? 1 : 0));
  });
  var sigStr = sig.join('|');
  if (sigStr === lastTabSig && c.className === 'tabstrip') return;
  lastTabSig = sigStr;
  c.className = 'tabstrip';
  c.innerHTML = '';
  function tab(label, active, onClick, onClose, dirtyDot) {
    var t = h('button', { class: 'apptab' + (active ? ' active' : ''), onclick: onClick }, [
      dirtyDot ? h('span', { class: 'tdot' }, ['●']) : null,
      h('span', { class: 'tlabel' }, [label])
    ]);
    if (onClose) t.appendChild(h('span', { class: 'tclose', title: 'Close', onclick: function (e) { e.stopPropagation(); onClose(); } }, ['✕']));
    c.appendChild(t);
  }
  tab('Loads', route.view === 'home', function () { go('home'); });
  tab('Library', route.view === 'library', function () { go('library'); });
  openLoadTabs = openLoadTabs.filter(function (id) {
    return state.loads.some(function (l) { return l.id === id; });
  });
  openLoadTabs.forEach(function (id) {
    var ld = null;
    for (var i = 0; i < state.loads.length; i++) if (state.loads[i].id === id) ld = state.loads[i];
    var active = route.view === 'editor' && route.loadId === id;
    tab('🚛 ' + (ld.loadNo ? '#' + ld.loadNo : 'Load'), active, function () { go('editor', id); }, function () {
      openLoadTabs = openLoadTabs.filter(function (x) { return x !== id; });
      if (active) go('home'); else renderTabs();
    });
  });
  openDrawTabs = openDrawTabs.filter(function (id) { return !!findProfileById(id); });
  openDrawTabs.forEach(function (id) {
    var p = findProfileById(id);
    var dc = drawCache[id];
    var active = route.view === 'draw' && route.profileId === id;
    tab('✎ ' + p.name, active, function () { goDraw(id); }, function () {
      function reallyClose() {
        delete drawCache[id];
        openDrawTabs = openDrawTabs.filter(function (x) { return x !== id; });
        if (active) go('library'); else renderTabs();
      }
      if (dc && dc.dirty) confirmModal('Discard unsaved drawing changes to "' + p.name + '"?', reallyClose, { okLabel: 'Discard', danger: true });
      else reallyClose();
    }, dc && dc.dirty);
  });
}
function renderRoute() {
  stashCurrentView();
  if (window.__drawCleanup) window.__drawCleanup();
  document.querySelectorAll('.palpreview').forEach(function (el) { el.remove(); });
  var v = $('view');
  v.innerHTML = '';
  $('btnPrint').hidden = route.view !== 'editor';
  $('btnSave').hidden = false;
  editor = null;
  if (route.view === 'home') { renderHome(v); }
  else if (route.view === 'library') { renderLibrary(v); }
  else if (route.view === 'draw') {
    var prof0 = findProfileById(route.profileId);
    if (!prof0) { openDrawTabs = openDrawTabs.filter(function (x) { return x !== route.profileId; }); go('library'); return; }
    if (openDrawTabs.indexOf(prof0.id) === -1) openDrawTabs.push(prof0.id);
    renderDrawEditor(v, prof0);
  }
  else if (route.view === 'editor') {
    var ld = currentLoad();
    if (!ld) { openLoadTabs = openLoadTabs.filter(function (x) { return x !== route.loadId; }); go('home'); return; }
    if (openLoadTabs.indexOf(ld.id) === -1) openLoadTabs.push(ld.id);
    renderEditor(v, ld);
  }
  renderTabs();
  updateSaveChip();
}

/* ---------- home view ---------- */
function nextLoadNo() {
  var mx = 0;
  state.loads.forEach(function (l) { var n = parseInt(l.loadNo, 10); if (isFinite(n) && n > mx) mx = n; });
  return mx ? String(mx + 1) : '';
}
function newLoad() {
  var ld = { id: uid(), loadNo: nextLoadNo(), customer: '', date: todayStr(), notes: '', placements: [], photos: [], created: Date.now(), updated: Date.now() };
  state.loads.unshift(ld);
  markDirty();
  go('editor', ld.id);
}
function duplicateLoad(src) {
  var copy = JSON.parse(JSON.stringify(src));
  copy.id = uid(); copy.loadNo = nextLoadNo(); copy.date = todayStr();
  copy.photos = []; copy.created = Date.now(); copy.updated = Date.now();
  copy.placements.forEach(function (p) { p.id = uid(); });
  state.loads.unshift(copy);
  markDirty();
  go('editor', copy.id);
}
function renderHome(root) {
  var loads = state.loads.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  var listKids;
  if (!loads.length) {
    listKids = [h('div', { class: 'empty' }, [h('b', null, ['No loads yet']), 'Start a new load and stack it from your trailer library.'])];
  } else {
    listKids = loads.map(function (ld) {
      var trailerCount = ld.placements.filter(function (p) { var pr = getProfile(p.profileId); return !pr || pr.kind !== 'truck'; }).length;
      return h('div', { class: 'loadrow', onclick: function () { go('editor', ld.id); } }, [
        h('div', { class: 'lno' }, [ld.loadNo ? '#' + ld.loadNo : '(no #)', h('small', null, [ld.date || ''])]),
        h('div', { class: 'lcust' }, [ld.customer || h('span', { style: 'color:var(--muted);font-weight:400' }, ['No customer']), ld.notes ? h('small', null, [ld.notes.slice(0, 90)]) : null]),
        h('div', { class: 'lmeta' }, [trailerCount + ' trl', ld.photos.length ? h('span', { class: 'pill' }, [ld.photos.length + ' photo' + (ld.photos.length > 1 ? 's' : '')]) : null]),
        h('div', { class: 'rowbtns' }, [
          h('button', { class: 'iconbtn', title: 'Duplicate load', onclick: function (e) { e.stopPropagation(); duplicateLoad(ld); } }, ['⧉']),
          h('button', { class: 'iconbtn danger', title: 'Delete load', onclick: function (e) {
            e.stopPropagation();
            confirmModal('Delete load ' + (ld.loadNo ? '#' + ld.loadNo : '') + '? Its photos are removed too.', function () {
              ld.photos.forEach(function (ph) { removePhotoFile(ph); });
              state.loads = state.loads.filter(function (x) { return x.id !== ld.id; });
              markDirty(); renderRoute();
            }, { okLabel: 'Delete', danger: true });
          } }, ['✕'])
        ])
      ]);
    });
  }
  var libChips = state.profiles.slice(0, 14).map(function (p) { return h('span', { class: 'chip' }, [p.name]); });
  if (state.profiles.length > 14) libChips.push(h('span', { class: 'chip' }, ['+' + (state.profiles.length - 14) + ' more']));
  root.appendChild(h('div', { class: 'home' }, [
    h('div', { class: 'home-inner' }, [
      h('h1', null, ['Loads']),
      h('p', { class: 'sub' }, ['Stack a load, save it, and keep photos of how it left the yard.']),
      h('div', { class: 'home-grid' }, [
        h('div', { class: 'card' }, [
          h('div', { class: 'card-head' }, [
            h('h2', null, ['Saved loads']),
            h('button', { class: 'btn primary small', onclick: newLoad }, ['+ New load'])
          ])
        ].concat(listKids)),
        h('div', { class: 'card' }, [
          h('div', { class: 'card-head' }, [h('h2', null, ['Trailer library'])]),
          h('div', { class: 'libmini' }, state.profiles.length ? libChips : [h('span', { style: 'color:var(--muted);font-size:13px' }, ['No profiles yet — import a DXF to get started.'])]),
          h('div', { class: 'card-foot' }, [
            h('button', { class: 'btn small', onclick: startImport }, ['Import DXF…']),
            h('button', { class: 'btn small ghost', onclick: function () { go('library'); } }, ['Manage library'])
          ])
        ]),
        h('div', { class: 'card' }, [
          h('div', { class: 'card-head' }, [h('h2', null, ['Backup'])]),
          h('div', { style: 'padding:12px 16px;color:var(--muted);font-size:13px;line-height:1.5' }, [
            'Everything auto-saves, and this device keeps its own backup copy. Export a file now and then for a copy you fully control — especially before app updates.'
          ]),
          h('div', { class: 'card-foot' }, [
            h('button', { class: 'btn small', onclick: exportBackup }, ['Export backup file']),
            h('button', { class: 'btn small ghost', onclick: importBackup }, ['Restore from file…'])
          ])
        ])
      ])
    ])
  ]));
}

/* ---------- library view ---------- */
var libState = { q: '', selected: {}, cur: '', open: {} };  // cur: current folder path
function renderLibrary(root) {
  var q = libState.q.toLowerCase();
  function selectedCount() { return Object.keys(libState.selected).filter(function (k) { return libState.selected[k]; }).length; }

  function profCard(p) {
    var thumbWrap = h('div', { class: 'thumb' });
    thumbWrap.appendChild(thumbSVG(p));
    var cb = h('input', { type: 'checkbox', class: 'pickbox', title: 'Select for bulk move' });
    cb.checked = !!libState.selected[p.id];
    cb.addEventListener('change', function () {
      libState.selected[p.id] = cb.checked;
      renderRoute();
    });
    var card = h('div', { class: 'profcard' + (libState.selected[p.id] ? ' picked' : '') }, [
      cb,
      thumbWrap,
      h('div', { class: 'pbody' }, [
        (function () {
          var inp = h('input', { class: 'pname', value: p.name, title: 'Rename' });
          inp.addEventListener('change', function () { p.name = inp.value.trim() || p.name; markDirty(); });
          return inp;
        })(),
        h('div', { class: 'pmeta' }, [
          h('span', null, [ftin(p.width)]),
          folderPicker(normPath(p.group), function (g) { p.group = g; markDirty(); renderRoute(); }, true),
          (function () {
            var sel = h('select', { class: 'kindsel' });
            ['trailer', 'truck'].forEach(function (k) {
              var o = h('option', { value: k }, [k === 'truck' ? 'Carrier' : 'Trailer']);
              if (p.kind === k) o.selected = true;
              sel.appendChild(o);
            });
            sel.addEventListener('change', function () { p.kind = sel.value; markDirty(); });
            return sel;
          })(),
          h('button', { class: 'iconbtn', title: 'Edit drawing', onclick: function () { goDraw(p.id); } }, ['✎']),
          h('button', { class: 'iconbtn danger', title: 'Delete profile', onclick: function () {
            var used = state.loads.some(function (l) { return l.placements.some(function (pl) { return pl.profileId === p.id; }); });
            confirmModal(used ? '"' + p.name + '" is used on saved loads — those placements will be removed too. Delete anyway?' : 'Delete "' + p.name + '"?', function () {
              state.loads.forEach(function (l) { l.placements = l.placements.filter(function (pl) { return pl.profileId !== p.id; }); });
              state.profiles = state.profiles.filter(function (x) { return x.id !== p.id; });
              delete pathCache[p.id];
              hmCache = {};
              delete libState.selected[p.id];
              markDirty(); renderRoute();
            }, { okLabel: 'Delete', danger: true });
          } }, ['✕'])
        ])
      ])
    ]);
    return card;
  }

  // ----- folder tree sidebar -----
  if (folderList().indexOf(libState.cur) === -1 && libState.cur !== '') libState.cur = '';
  function treeNode(path, name, depth) {
    var kids = childFolders(path);
    var isOpen = libState.open[path] !== false; // default open
    var count = profilesIn(path, true).length;
    var row = h('div', {
      class: 'treerow' + (libState.cur === path ? ' cur' : ''),
      style: 'padding-left:' + (10 + depth * 16) + 'px',
      onclick: function () { libState.cur = path; renderRoute(); }
    }, [
      kids.length ? h('span', { class: 'caret', onclick: function (e) { e.stopPropagation(); libState.open[path] = !isOpen; renderRoute(); } }, [isOpen ? '▾' : '▸']) : h('span', { class: 'caret dim' }, ['·']),
      h('span', { class: 'tname' }, [name]),
      h('span', { class: 'tcount' }, [String(count)])
    ]);
    var out = [row];
    if (isOpen) kids.forEach(function (k) {
      out = out.concat(treeNode(path ? path + '/' + k : k, k, depth + 1));
    });
    return out;
  }
  var treeRows = [
    h('div', { class: 'treerow' + (libState.cur === '' ? ' cur' : ''), style: 'padding-left:10px', onclick: function () { libState.cur = ''; renderRoute(); } }, [
      h('span', { class: 'caret dim' }, ['◈']),
      h('span', { class: 'tname' }, ['All models']),
      h('span', { class: 'tcount' }, [String(state.profiles.length)])
    ])
  ];
  childFolders('').forEach(function (k) { treeRows = treeRows.concat(treeNode(k, k, 0)); });
  var sidebar = h('div', { class: 'libtree' }, [
    h('div', { class: 'libtree-head' }, [
      h('h3', null, ['Folders']),
      h('button', { class: 'btn small ghost', title: 'New folder inside the selected one', onclick: function () {
        promptModal(libState.cur ? 'New subfolder inside "' + libState.cur + '"' : 'New folder name', '', function (name) {
          if (!normPath(name)) return;
          var p = libState.cur ? libState.cur + '/' + normPath(name) : normPath(name);
          addFolder(p);
          libState.open[libState.cur] = true;
          libState.cur = p;
          renderRoute();
        });
      } }, ['+ New'])
    ])
  ].concat(treeRows));

  // ----- content -----
  var items, heading, folderOps = null;
  if (q) {
    items = state.profiles.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1 || normPath(p.group).toLowerCase().indexOf(q) !== -1; });
    heading = 'Search — ' + items.length + ' match' + (items.length === 1 ? '' : 'es');
  } else if (libState.cur === '') {
    items = state.profiles.slice();
    heading = 'All models';
  } else {
    items = profilesIn(libState.cur, false);
    heading = libState.cur.split('/').pop();
    folderOps = h('div', { style: 'display:flex;gap:6px' }, [
      h('button', { class: 'btn small ghost', onclick: function () {
        promptModal('Rename folder', libState.cur.split('/').pop(), function (name) {
          if (!normPath(name)) return;
          var parent = libState.cur.indexOf('/') === -1 ? '' : libState.cur.slice(0, libState.cur.lastIndexOf('/'));
          renameFolder(libState.cur, name);
          libState.cur = normPath(parent ? parent + '/' + name : name);
          renderRoute();
        });
      } }, ['Rename']),
      h('button', { class: 'btn small ghost', onclick: function () { moveFolderDlg(libState.cur); } }, ['Move…']),
      h('button', { class: 'btn small ghost', style: 'color:var(--bad)', onclick: function () {
        confirmModal('Remove folder "' + libState.cur + '"? Models inside move up a level — nothing is deleted.', function () {
          var parent = libState.cur.indexOf('/') === -1 ? '' : libState.cur.slice(0, libState.cur.lastIndexOf('/'));
          deleteFolder(libState.cur);
          libState.cur = parent;
          renderRoute();
        }, { okLabel: 'Remove folder', danger: true });
      } }, ['Remove folder'])
    ]);
  }
  items.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
  var allPicked = items.length && items.every(function (p) { return libState.selected[p.id]; });

  var subTiles = [];
  if (!q) {
    childFolders(libState.cur).forEach(function (k) {
      var p2 = libState.cur ? libState.cur + '/' + k : k;
      subTiles.push(h('button', { class: 'foldertile', onclick: function () { libState.cur = p2; renderRoute(); } }, [
        h('span', { class: 'ficon' }, ['▣']),
        h('span', null, [k]),
        h('span', { class: 'tcount' }, [String(profilesIn(p2, true).length)])
      ]));
    });
  }

  var nSel = selectedCount();
  var bulkBar = null;
  if (nSel) {
    var moveSel = folderPicker('', function () {}, true);
    bulkBar = h('div', { class: 'bulkbar' }, [
      h('b', null, [nSel + ' selected']),
      h('span', null, ['Move to folder:']),
      moveSel,
      h('button', { class: 'btn primary small', onclick: function () {
        var g = moveSel.value === 'new' ? '' : moveSel.value;
        state.profiles.forEach(function (p) { if (libState.selected[p.id]) p.group = g; });
        libState.selected = {};
        markDirty(); renderRoute();
        toast(g ? 'Moved to "' + g + '"' : 'Moved out of folders');
      } }, ['Move']),
      h('button', { class: 'btn small ghost', onclick: function () { libState.selected = {}; renderRoute(); } }, ['Clear'])
    ]);
  }

  var searchInp = h('input', { placeholder: 'Search all models…', value: libState.q, style: 'width:210px' });
  searchInp.addEventListener('input', function () { libState.q = searchInp.value; renderRoute(); var si = document.getElementById('libSearch'); if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); } });
  searchInp.id = 'libSearch';

  root.appendChild(h('div', { class: 'libwrap libsplit' }, [
    sidebar,
    h('div', { class: 'libcontent' }, [
      h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px' }, [
        h('div', null, [
          h('h1', { style: 'font:600 26px/1.1 "Barlow Condensed",sans-serif;letter-spacing:.02em;text-transform:uppercase;margin:0' }, [heading]),
          libState.cur && !q ? h('p', { style: 'color:var(--muted);margin:2px 0 0;font-size:12.5px' }, [libState.cur]) : null
        ]),
        h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          folderOps,
          searchInp,
          h('button', { class: 'btn small', onclick: startImport }, ['Import DXF…']),
          h('button', { class: 'btn small', onclick: function () { go('home'); } }, ['Back to loads'])
        ])
      ]),
      subTiles.length ? h('div', { class: 'foldertiles' }, subTiles) : null,
      items.length ? h('div', { style: 'display:flex;align-items:center;gap:10px;margin:14px 0 8px' }, [
        h('span', { style: 'color:var(--muted);font-size:12.5px' }, [items.length + ' model' + (items.length === 1 ? '' : 's') + (libState.cur && !q ? ' in this folder' : '')]),
        h('button', { class: 'btn small ghost', onclick: function () {
          items.forEach(function (p) { libState.selected[p.id] = !allPicked; });
          renderRoute();
        } }, [allPicked ? 'Unselect all' : 'Select all'])
      ]) : null,
      items.length ? h('div', { class: 'libgrid' }, items.map(profCard))
        : h('div', { class: 'empty', style: 'margin-top:30px' }, [h('b', null, [q ? 'No matches' : 'Nothing here yet']), q ? 'Try a different search.' : 'Move models in with the checkboxes, or import a DXF.'])
    ])
  ]));
  if (bulkBar) root.appendChild(bulkBar);
}

/* ---------- DXF import ---------- */
function startImport() {
  $('dxfFile').value = '';
  $('dxfFile').onchange = function () {
    var f = $('dxfFile').files[0];
    if (f) importDXFFile(f);
  };
  $('dxfFile').click();
}
function importDXFFile(file) {
  var scrim = h('div', { class: 'modal-scrim' });
  var status = h('div', { style: 'padding:40px;text-align:center;color:var(--muted)' }, ['Reading ' + file.name + '…']);
  var modal = h('div', { class: 'modal small' }, [status]);
  scrim.appendChild(modal); document.body.appendChild(scrim);
  var reader = new FileReader();
  reader.onload = function () {
    var text = reader.result;
    setTimeout(function () {
      var raw, chained;
      try {
        status.textContent = 'Tracing geometry…';
        raw = DXF.parseDXFRaw(text);
        if (!raw.length) throw new Error('No drawable geometry found in this file.');
        chained = DXFCluster.chainPolylines(raw);
      } catch (err) {
        scrim.remove();
        toast('Couldn’t read that DXF: ' + (err.message || 'unrecognized format'), true);
        return;
      }
      // unit guess: if the whole drawing is huge, it's probably mm
      var ext = bboxOf(chained);
      var isMM = (ext.maxX - ext.minX) > 3000;
      scrim.remove();
      showClusterModal(file.name, chained, isMM);
    }, 30);
  };
  reader.onerror = function () { scrim.remove(); toast('Couldn’t read that file.', true); };
  reader.readAsText(file, 'iso-8859-1');
}
function bboxOf(polys) {
  var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
  polys.forEach(function (p) { p.forEach(function (pt) {
    if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
    if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
  }); });
  return { minX: mnx, minY: mny, maxX: mxx, maxY: mxy };
}
function showClusterModal(fileName, chained, isMM) {
  var gap = 4, mm = isMM;
  var baseName = fileName.replace(/\.dxf$/i, '').trim();
  var clusters = [];   // [{polys, prof, name, on}]
  var grid = h('div', { class: 'clustergrid' });
  var countEl = h('span', { class: 'n' });
  var scrim = h('div', { class: 'modal-scrim' });

  function recluster() {
    var scale = mm ? 1 / 25.4 : 1;
    var polys = scale === 1 ? chained : chained.map(function (p) { return p.map(function (pt) { return [pt[0] * scale, pt[1] * scale]; }); });
    var groups = DXFCluster.clusterPolylines(polys, gap);
    // sort: biggest width first
    var items = groups.map(function (g2) {
      var prof = DXF.finishProfile(g2, { tolerance: 0.03, minFeature: 0.45 });
      return prof;
    }).filter(function (pr) { return pr.polylines.length && pr.width > 6; });
    items.sort(function (a, b) { return b.width - a.width; });
    clusters = items.map(function (prof, i) {
      return {
        prof: prof,
        name: items.length === 1 ? baseName : baseName + ' ' + (i + 1),
        on: items.length === 1 ? true : (prof.width >= 60 && prof.height >= 10 && prof.height <= 200)
      };
    });
    renderGrid();
  }
  function renderGrid() {
    grid.innerHTML = '';
    countEl.textContent = clusters.length + ' piece' + (clusters.length === 1 ? '' : 's') + ' found';
    clusters.forEach(function (c) {
      var card = h('div', { class: 'clustercard' + (c.on ? ' on' : '') });
      var thumb = h('div', { class: 'thumb', title: 'Click to include / exclude' });
      thumb.appendChild(thumbSVG(c.prof));
      var cb = h('input', { type: 'checkbox' });
      cb.checked = c.on;
      function setOn(v) { c.on = v; cb.checked = v; card.className = 'clustercard' + (v ? ' on' : ''); }
      thumb.addEventListener('click', function () { setOn(!c.on); });
      cb.addEventListener('change', function () { setOn(cb.checked); });
      var nameInp = h('input', { class: 'cname', value: c.name });
      nameInp.addEventListener('input', function () { c.name = nameInp.value; });
      card.appendChild(thumb);
      card.appendChild(h('div', { class: 'cbody' }, [cb, nameInp, h('span', { class: 'csize' }, [ftin(c.prof.width)])]));
      grid.appendChild(card);
    });
  }

  var gapInp = h('input', { type: 'range', min: 2, max: 16, step: 1, value: gap });
  gapInp.addEventListener('change', function () { gap = +gapInp.value; recluster(); });
  var mmSel = h('select', null);
  [['in', 'inches'], ['mm', 'millimeters']].forEach(function (o) {
    var op = h('option', { value: o[0] }, [o[1]]);
    if ((o[0] === 'mm') === mm) op.selected = true;
    mmSel.appendChild(op);
  });
  mmSel.addEventListener('change', function () { mm = mmSel.value === 'mm'; recluster(); });

  var modal = h('div', { class: 'modal' }, [
    h('div', { class: 'modal-head' }, [
      h('h2', null, ['Import — ' + fileName]),
      h('button', { class: 'iconbtn', onclick: function () { scrim.remove(); } }, ['✕'])
    ]),
    h('div', { class: 'modal-body' }, [
      h('div', { class: 'importctl' }, [
        countEl,
        h('span', { style: 'color:var(--muted)' }, ['·']),
        h('label', null, ['Split distance ']), gapInp,
        h('label', null, ['Drawing units ']), mmSel,
        h('span', { style: 'flex:1' }),
        h('button', { class: 'btn small ghost', onclick: function () { clusters.forEach(function (c) { c.on = true; }); renderGrid(); } }, ['Select all']),
        h('button', { class: 'btn small ghost', onclick: function () { clusters.forEach(function (c) { c.on = false; }); renderGrid(); } }, ['None'])
      ]),
      grid
    ]),
    h('div', { class: 'modal-foot' }, [
      h('span', { class: 'left' }, ['Uncheck notes and text blocks — keep only the trailers you stack. Names can be edited later.']),
      h('button', { class: 'btn', onclick: function () { scrim.remove(); } }, ['Cancel']),
      h('button', { class: 'btn primary', onclick: function () {
        var picked = clusters.filter(function (c) { return c.on; });
        if (!picked.length) { toast('Nothing selected to import'); return; }
        picked.forEach(function (c) {
          state.profiles.push({
            id: uid(), name: (c.name || 'Profile').trim() || 'Profile',
            kind: c.prof.width > 500 ? 'truck' : 'trailer',
            width: c.prof.width, height: c.prof.height,
            polylines: c.prof.polylines, added: Date.now()
          });
        });
        markDirty();
        scrim.remove();
        toast('Imported ' + picked.length + ' profile' + (picked.length > 1 ? 's' : ''));
        if (route.view !== 'editor') go('library'); else renderRoute();
      } }, ['Import selected'])
    ])
  ]);
  scrim.appendChild(modal);
  document.body.appendChild(scrim);
  recluster();
}

/* ---------- photos ---------- */
function removePhotoFile(ph) {
  RS_STORAGE.deletePhoto(ph.file).catch(function () {});
  if (photoUrlCache[ph.file]) delete photoUrlCache[ph.file];
}
function addPhotos(ld, fileList, done) {
  var files = Array.prototype.slice.call(fileList);
  var remaining = files.length;
  if (!remaining) return;
  files.forEach(function (f) {
    var img = new Image();
    var url = URL.createObjectURL(f);
    img.onload = function () {
      var maxDim = 1600;
      var sc = Math.min(1, maxDim / Math.max(img.width, img.height));
      var cw = Math.round(img.width * sc), chh = Math.round(img.height * sc);
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = chh;
      cv.getContext('2d').drawImage(img, 0, 0, cw, chh);
      URL.revokeObjectURL(url);
      cv.toBlob(function (blob) {
        if (!blob) { if (--remaining === 0 && done) done(); return; }
        var id = uid();
        var path = 'photos/' + id + '.jpg';
        photoUrlCache[path] = URL.createObjectURL(blob);   // instant preview
        RS_STORAGE.uploadPhoto(path, blob).then(function () {
          ld.photos.push({ id: id, file: path, ts: Date.now() });
          ld.updated = Date.now();
          markDirty();
          if (--remaining === 0 && done) done();
        }).catch(function (err) {
          delete photoUrlCache[path];
          toast('Photo upload failed' + (err && err.message ? ': ' + err.message : ''), true);
          if (--remaining === 0 && done) done();
        });
      }, 'image/jpeg', 0.72);
    };
    img.onerror = function () { URL.revokeObjectURL(url); if (--remaining === 0 && done) done(); };
    img.src = url;
  });
}
function openLightbox(src) {
  var lb = h('div', { class: 'lightbox', onclick: function () { lb.remove(); } });
  lb.appendChild(h('img', { src: src }));
  document.body.appendChild(lb);
}

/* ---------- editor ---------- */
var editor = null; // {ld, svg, world, sel, viewport {s,tx,ty}, undo:[], redo:[]}

/* customizable key bindings (saved with your data; arrows stay the nudge keys) */
var KEY_DEFAULTS = { flip: 'F', roll: 'V', tiltL: '[', tiltR: ']', tiltReset: 'T', dup: 'Ctrl+D', del: 'Delete' };
var KEY_LABELS = { flip: 'Flip', roll: 'Roll over', tiltL: 'Tilt left', tiltR: 'Tilt right', tiltReset: 'Tilt to 0°', dup: 'Duplicate', del: 'Remove' };
function keyBindings() {
  if (!state.keys) state.keys = {};
  var out = {};
  Object.keys(KEY_DEFAULTS).forEach(function (k) { out[k] = state.keys[k] || KEY_DEFAULTS[k]; });
  return out;
}
function keyMatches(binding, e) {
  var parts = String(binding).split('+');
  var needCtrl = parts.length > 1 && parts[0] === 'Ctrl';
  var k = parts[parts.length - 1];
  if (!!(e.ctrlKey || e.metaKey) !== needCtrl) return false;
  if (k === 'Delete') return e.key === 'Delete' || e.key === 'Backspace';
  return e.key.toLowerCase() === k.toLowerCase();
}
function normalizeKeyEvent(e) {
  var k = e.key;
  if (k === ' ') return null;                       // space pans
  if (k.indexOf('Arrow') === 0) return null;        // arrows are reserved for nudge
  if (['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'Enter'].indexOf(k) !== -1) return null;
  if (k === 'Backspace') k = 'Delete';
  if (k.length === 1) k = k.toUpperCase();
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + k;
}

function renderEditor(root, ld) {
  editor = { ld: ld, sel: [], undo: [], redo: [], viewport: null };
  var uiCache = loadUiCache[ld.id];
  if (uiCache) {
    editor.viewport = uiCache.viewport || null;
    editor.sel = uiCache.sel || [];
    editor.measures = uiCache.measures || [];
    editor.palChecked = uiCache.palChecked || {};
    editor.palOpen = uiCache.palOpen || {};
    editor.undo = uiCache.undo || [];
    editor.redo = uiCache.redo || [];
    editor.pivots = uiCache.pivots || {};
  }
  var wrap = h('div', { class: 'editor' });

  /* left palette: folder tree with checkboxes + quantities */
  var search = h('input', { placeholder: 'Search profiles…' });
  var palList = h('div', { class: 'palette' });
  var palFoot = h('div', { class: 'palfoot' });
  if (!editor.palChecked) editor.palChecked = {};   // profileId -> qty
  if (!editor.palOpen) editor.palOpen = {};         // folder path -> bool (default closed)
  function checkedTotal() {
    var n = 0;
    Object.keys(editor.palChecked).forEach(function (k) { n += editor.palChecked[k] || 0; });
    return n;
  }
  // Built once, updated in place — rebuilding here would kill a click that
  // lands on the button right as a qty field blurs.
  var palAddBtn = h('button', {
    class: 'btn primary small', style: 'flex:1;justify-content:center',
    onclick: function () { addCheckedToLoad(false); }
  }, ['Add to load']);
  var palClearBtn = h('button', { class: 'btn small ghost', title: 'Clear checks', onclick: function () { editor.palChecked = {}; renderPalette(); } }, ['✕']);
  palFoot.appendChild(palAddBtn);
  palFoot.appendChild(palClearBtn);
  function renderPalFoot() {
    var n = checkedTotal();
    palAddBtn.textContent = n ? 'Add ' + n + ' to load' : 'Add to load';
    palClearBtn.style.display = n ? '' : 'none';
  }
  function addCheckedToLoad(stackAfter) {
    var n = checkedTotal();
    if (!n) { toast('Check some trailers first'); return; }
    snapshot();
    var i = 0, newIds = [];
    Object.keys(editor.palChecked).forEach(function (pid) {
      var prof = getProfile(pid);
      var qty = editor.palChecked[pid] || 0;
      for (var k2 = 0; k2 < qty; k2++) {
        var np = {
          id: uid(), profileId: pid,
          cx: 100 + (i % 8) * 30, cy: (prof ? prof.height / 2 : 20) + 200 + Math.floor(i / 8) * 40 + (i % 8) * 6,
          rot: 0, fh: false, fv: false
        };
        editor.ld.placements.push(np);
        newIds.push(np.id);
        i++;
      }
    });
    editor.sel = newIds;
    editor.palChecked = {};
    afterMutate();
    renderPalette();
    toast('Added ' + n + ' — hit ⚡ Auto stack to stack them');
  }
  /* hover preview: shows the actual drawing so the right model goes on */
  var preview = h('div', { class: 'palpreview' });
  preview.style.display = 'none';
  document.body.appendChild(preview);
  editor._preview = preview;
  function showPreview(p, row) {
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;
    preview.innerHTML = '';
    var th = h('div', { class: 'pv-thumb' });
    th.appendChild(thumbSVG(p));
    preview.appendChild(th);
    preview.appendChild(h('div', { class: 'pv-meta' }, [
      h('b', null, [p.name]),
      h('span', null, [ftin(p.width) + ' long · ' + ftin(p.height) + ' tall'])
    ]));
    var r = row.getBoundingClientRect();
    preview.style.display = 'block';
    preview.style.left = (r.right + 10) + 'px';
    var ph = preview.offsetHeight || 230;
    preview.style.top = Math.max(8, Math.min(r.top - 20, window.innerHeight - ph - 12)) + 'px';
  }
  function hidePreview() { preview.style.display = 'none'; }
  function attachPreview(row, p) {
    row.addEventListener('mouseenter', function () { showPreview(p, row); });
    row.addEventListener('mouseleave', hidePreview);
  }
  function palRow(p, depth) {
    var qty = editor.palChecked[p.id] || 0;
    var cb = h('input', { type: 'checkbox' });
    cb.checked = qty > 0;
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () {
      if (cb.checked) editor.palChecked[p.id] = editor.palChecked[p.id] || 1;
      else delete editor.palChecked[p.id];
      renderPalette();
    });
    var row = h('div', { class: 'palrow' + (qty ? ' on' : ''), style: 'padding-left:' + (10 + depth * 14) + 'px', title: p.name + ' — ' + ftin(p.width) });
    row.appendChild(cb);
    var lbl = h('span', { class: 'prname' }, [p.name]);
    lbl.addEventListener('click', function () { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
    row.appendChild(lbl);
    if (qty) {
      var qinp = h('input', { type: 'number', class: 'qty', min: 1, max: 99, value: qty, title: 'Quantity' });
      qinp.addEventListener('click', function (e) { e.stopPropagation(); });
      qinp.addEventListener('change', function () {
        var v = Math.max(1, Math.min(99, parseInt(qinp.value, 10) || 1));
        editor.palChecked[p.id] = v;
        renderPalFoot();
      });
      row.appendChild(qinp);
    } else {
      row.appendChild(h('span', { class: 'prlen' }, [ftin(p.width)]));
    }
    attachPreview(row, p);
    return row;
  }
  function renderPalette() {
    var q = search.value.trim().toLowerCase();
    palList.innerHTML = '';
    // carriers on top — click to swap
    var trucks = builtins.concat(state.profiles).filter(function (p) { return p.kind === 'truck' && (!q || p.name.toLowerCase().indexOf(q) !== -1); });
    if (trucks.length) {
      palList.appendChild(h('h3', null, ['Trucks & carriers']));
      trucks.forEach(function (p) {
        var trow = h('button', { class: 'palrow truck', title: 'Set as the rig for this load', onclick: function () { addPlacement(p); } }, [
          h('span', { class: 'caret dim' }, ['▸']),
          h('span', { class: 'prname' }, [p.name]),
          h('span', { class: 'prlen' }, [ftin(p.width)])
        ]);
        attachPreview(trow, p);
        palList.appendChild(trow);
      });
    }
    palList.appendChild(h('h3', null, ['Trailers']));
    var anyRows = false;
    function renderFolder(path, depth) {
      var kids = childFolders(path).filter(function (k) {
        var p2 = path ? path + '/' + k : k;
        return profilesIn(p2, true).some(function (p) { return p.kind !== 'truck'; });
      });
      var direct = profilesIn(path, false).filter(function (p) { return p.kind !== 'truck'; });
      if (q) {
        // search: flat matching rows, folders auto-expanded
        direct.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; })
          .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); })
          .forEach(function (p) { palList.appendChild(palRow(p, depth)); anyRows = true; });
        kids.forEach(function (k) { renderFolder(path ? path + '/' + k : k, depth); });
        return;
      }
      kids.forEach(function (k) {
        var p2 = path ? path + '/' + k : k;
        var open = !!editor.palOpen[p2];
        var count = profilesIn(p2, true).filter(function (p) { return p.kind !== 'truck'; }).length;
        var frow = h('div', { class: 'palrow folder', style: 'padding-left:' + (10 + depth * 14) + 'px', onclick: function () { editor.palOpen[p2] = !open; renderPalette(); } }, [
          h('span', { class: 'caret' }, [open ? '▾' : '▸']),
          h('span', { class: 'prname', style: 'font-weight:600' }, [k]),
          h('span', { class: 'prlen' }, [String(count)])
        ]);
        palList.appendChild(frow);
        anyRows = true;
        if (open) renderFolder(p2, depth + 1);
      });
      direct.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); })
        .forEach(function (p) { palList.appendChild(palRow(p, depth)); anyRows = true; });
    }
    renderFolder('', 0);
    if (!anyRows && !trucks.length) palList.appendChild(h('div', { style: 'padding:10px 14px;color:var(--muted);font-size:13px' }, ['No matches.']));
    renderPalFoot();
  }
  search.addEventListener('input', renderPalette);
  var left = h('div', { class: 'panel' }, [
    h('h3', null, ['Library']),
    h('div', { class: 'palette-search' }, [search]),
    palList,
    palFoot,
    h('div', { class: 'palhint' }, [
      h('button', { class: 'btn small ghost', onclick: startImport, style: 'width:100%;justify-content:center' }, ['+ Import DXF'])
    ])
  ]);

  /* canvas */
  var svg = svgEl('svg', { class: 'sheet' });
  var canvasWrap = h('div', { class: 'canvas-wrap' });
  canvasWrap.appendChild(svg);

  var toolbar = h('div', { class: 'toolbar' }, [
    tb('↶ Undo', function () { undo(); }, 'undoBtn'),
    tb('↷ Redo', function () { redo(); }, 'redoBtn'),
    h('div', { class: 'sep' }),
    tb('↔ Flip', function () { withSel(function (pl) { pl.fh = !pl.fh; }); }, null, 'Mirror left/right (F)'),
    tb('↕ Roll over', function () { withSel(function (pl) { pl.fv = !pl.fv; }); }, null, 'Flip upside down (V)'),
    tb('⟲ 5°', function () { withSel(function (pl) { pl.rot = (pl.rot || 0) + 5; }); }, null, 'Tilt (])'),
    tb('⟳ 5°', function () { withSel(function (pl) { pl.rot = (pl.rot || 0) - 5; }); }, null, 'Tilt ([)'),
    tb('0°', function () { withSel(function (pl) { pl.rot = 0; }); }, null, 'Reset tilt (R)'),
    h('div', { class: 'sep' }),
    tb('⧉ Duplicate', function () { duplicateSel(); }, null, 'Duplicate (Ctrl+D)'),
    tb('✕ Remove', function () { deleteSel(); }, null, 'Remove (Delete)'),
    h('div', { class: 'sep' }),
    tb('⚡ Auto stack', function () { autoStack(); }, null, 'Automatically nest all trailers onto the rig'),
    tb('📏 Measure', function () { toggleMeasureMode(); }, 'measureBtn', 'Measure between trailers or from the ground — click the number to set it and the trailer moves'),
    tb('⛶ Fit', function () { fitView(); }, null, 'Zoom to fit')
  ]);
  editor.canvasWrap = canvasWrap;
  if (!editor.measures) editor.measures = [];
  editor.measureMode = false;
  editor.mDraft = null;
  function tb(label, fn, id, title) {
    var b = h('button', { class: 'tbtn', onclick: fn, title: title || label });
    if (id) b.id = id;
    b.textContent = label;
    return b;
  }
  canvasWrap.appendChild(toolbar);

  var statusbar = h('div', { class: 'statusbar', id: 'statusbar' });
  canvasWrap.appendChild(statusbar);

  /* right inspector */
  function field(label, key, type, full) {
    var inp = type === 'textarea' ? h('textarea', { rows: 2 }) : h('input', { type: type || 'text' });
    inp.value = ld[key] || '';
    inp.addEventListener('change', function () {
      ld[key] = inp.value; ld.updated = Date.now(); markDirty();
      renderTabs();   // load # may have changed — refresh the tab label
    });
    return h('div', { class: full ? 'full' : '' }, [h('label', null, [label]), inp]);
  }
  var selPanel = h('div', { class: 'selpanel', id: 'selPanel' });
  var stackList = h('div', { class: 'stacklist', id: 'stackList' });
  var photoGrid = h('div', { class: 'photogrid', id: 'photoGrid' });
  var right = h('div', { class: 'panel right' }, [
    h('div', { class: 'insp-section' }, [
      h('h3', null, ['Load info']),
      h('div', { class: 'formgrid' }, [
        field('Load #', 'loadNo'), field('Ship date', 'date', 'date'),
        field('Customer / destination', 'customer', 'text', true),
        field('Notes for the yard', 'notes', 'textarea', true)
      ])
    ]),
    h('div', { class: 'insp-section' }, [h('h3', null, ['Selected']), selPanel]),
    h('div', { class: 'insp-section' }, [h('h3', null, ['On this load']), stackList]),
    h('div', { class: 'insp-section' }, [
      h('h3', null, ['Photos of the stack']),
      photoGrid,
      h('div', { class: 'photoadd' }, [
        h('button', { class: 'btn small', style: 'width:100%;justify-content:center', onclick: function () {
          $('photoFile').value = '';
          $('photoFile').onchange = function () {
            addPhotos(ld, $('photoFile').files, function () { renderPhotos(); renderStackList(); });
          };
          $('photoFile').click();
        } }, ['+ Add photos'])
      ])
    ]),
    h('div', { class: 'insp-section' }, [
      h('h3', null, ['Keyboard']),
      h('div', { class: 'keymap', id: 'keyMap' })
    ])
  ]);

  wrap.appendChild(left);
  wrap.appendChild(canvasWrap);
  wrap.appendChild(right);
  root.appendChild(wrap);

  /* print block */
  var printBlock = h('div', { class: 'printonly', id: 'printBlock' });
  canvasWrap.appendChild(printBlock);

  renderPalette();
  var hadViewport = !!editor.viewport;
  initCanvas(svg, canvasWrap);
  renderPlacements();
  renderSelPanel();
  renderStackList();
  renderPhotos();
  renderKeyMap();
  if (hadViewport) applyViewport(); else fitView();
  syncUndoBtns();
}

function renderKeyMap() {
  var km = $('keyMap');
  if (!km || !editor) return;
  km.innerHTML = '';
  var binds = keyBindings();
  Object.keys(KEY_DEFAULTS).forEach(function (cmd) {
    var chip = h('button', { class: 'kbd-chip', title: 'Click, then press the key you want for ' + KEY_LABELS[cmd] }, [binds[cmd]]);
    chip.addEventListener('click', function () {
      chip.textContent = 'press a key…';
      chip.classList.add('listening');
      function capture(e) {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', capture, true);
        if (e.key === 'Escape') { renderKeyMap(); return; }
        var nk = normalizeKeyEvent(e);
        if (!nk) { renderKeyMap(); return; }
        var current = keyBindings();
        var taken = Object.keys(current).filter(function (c) { return c !== cmd && current[c] === nk; });
        if (taken.length) { toast('"' + nk + '" is already ' + KEY_LABELS[taken[0]], true); renderKeyMap(); return; }
        state.keys = state.keys || {};
        state.keys[cmd] = nk;
        markDirty();
        renderKeyMap();
        toast(KEY_LABELS[cmd] + ' is now ' + nk);
      }
      document.addEventListener('keydown', capture, true);
    });
    km.appendChild(h('div', { class: 'keyrow' }, [chip, h('span', null, [KEY_LABELS[cmd]])]));
  });
  km.appendChild(h('div', { class: 'keyrow fixed' }, [h('kbd', null, ['arrows']), h('span', null, ['nudge (finer as you zoom) · Shift = 12"'])]));
  km.appendChild(h('button', { class: 'btn small ghost', style: 'margin-top:6px', onclick: function () {
    state.keys = {}; markDirty(); renderKeyMap(); toast('Keys reset to defaults');
  } }, ['Reset to defaults']));
}

/* ---- editor helpers ---- */
function snapshot() {
  if (!editor) return;
  editor.undo.push(JSON.stringify(editor.ld.placements));
  if (editor.undo.length > 80) editor.undo.shift();
  editor.redo = [];
  syncUndoBtns();
}
function undo() {
  if (!editor || !editor.undo.length) return;
  editor.redo.push(JSON.stringify(editor.ld.placements));
  editor.ld.placements = JSON.parse(editor.undo.pop());
  editor.sel = [];
  afterMutate(true);
}
function redo() {
  if (!editor || !editor.redo.length) return;
  editor.undo.push(JSON.stringify(editor.ld.placements));
  editor.ld.placements = JSON.parse(editor.redo.pop());
  editor.sel = [];
  afterMutate(true);
}
function syncUndoBtns() {
  var u = $('undoBtn'), r = $('redoBtn');
  if (u) u.disabled = !editor.undo.length;
  if (r) r.disabled = !editor.redo.length;
}
function afterMutate(skipSnapshot) {
  editor.ld.updated = Date.now();
  markDirty();
  renderPlacements();
  renderSelPanel();
  renderStackList();
  syncUndoBtns();
}
function selIds() { return (editor && editor.sel) || []; }
function isSel(id) { return selIds().indexOf(id) !== -1; }
function selPlacements() {
  var ids = selIds();
  if (!editor || !ids.length) return [];
  return editor.ld.placements.filter(function (p) { return ids.indexOf(p.id) !== -1; });
}
function selPlacement() {
  var a = selPlacements();
  return a.length === 1 ? a[0] : null;
}
function withSel(fn) {
  var list = selPlacements();
  if (!list.length) return;
  snapshot();
  list.forEach(fn);
  afterMutate();
}
function addPlacement(profile) {
  if (!editor) return;
  snapshot();
  if (profile.kind === 'truck') {
    // One rig per sheet: picking a carrier swaps it out instead of stacking a second one.
    var existing = editor.ld.placements.filter(function (p) {
      var pr = getProfile(p.profileId);
      return pr && pr.kind === 'truck';
    });
    if (existing.length) {
      var keep = existing[0];
      if (keep.profileId !== profile.id) toast('Swapped carrier to ' + profile.name);
      keep.profileId = profile.id;
      keep.cy = profile.height / 2; // back on the ground
      keep.rot = 0; keep.fv = false;
      // drop any extra rigs
      var extraIds = existing.slice(1).map(function (p) { return p.id; });
      if (extraIds.length) editor.ld.placements = editor.ld.placements.filter(function (p) { return extraIds.indexOf(p.id) === -1; });
      editor.sel = [keep.id];
      afterMutate();
      return;
    }
    var tp = { id: uid(), profileId: profile.id, cx: profile.width / 2, cy: profile.height / 2, rot: 0, fh: false, fv: false };
    editor.ld.placements.push(tp);
    editor.sel = [tp.id];
    afterMutate();
    fitView();
    return;
  }
  var vp = editor.viewport;
  var cx = vp ? (editor.svgW / 2 - vp.tx) / vp.s : profile.width / 2;
  var cascade = (editor.ld.placements.length % 6) * 18; // so repeated adds don't hide each other
  var snappedX = Math.round(cx / 12) * 12 + cascade;
  var pl = { id: uid(), profileId: profile.id, cx: snappedX, cy: profile.height / 2 + 62 + cascade, rot: 0, fh: false, fv: false };
  editor.ld.placements.push(pl);
  editor.sel = [pl.id];
  afterMutate();
}
function duplicateSel() {
  var list = selPlacements();
  if (!list.length) return;
  snapshot();
  var newIds = [];
  list.forEach(function (pl) {
    var copy = JSON.parse(JSON.stringify(pl));
    copy.id = uid(); copy.cx += 24; copy.cy += 24;
    editor.ld.placements.push(copy);
    newIds.push(copy.id);
  });
  editor.sel = newIds;
  afterMutate();
}
function deleteSel() {
  var list = selPlacements();
  if (!list.length) return;
  snapshot();
  var ids = list.map(function (p) { return p.id; });
  editor.ld.placements = editor.ld.placements.filter(function (p) { return ids.indexOf(p.id) === -1; });
  editor.sel = [];
  afterMutate();
}
function placementMatrix(pl, prof) {
  // world transform string for the placement group (y-up world coords)
  var cx0 = (prof.ox || 0) + prof.width / 2, cy0 = (prof.oy || 0) + prof.height / 2;
  return 'translate(' + pl.cx + ',' + pl.cy + ') rotate(' + (pl.rot || 0) + ') scale(' + (pl.fh ? -1 : 1) + ',' + (pl.fv ? -1 : 1) + ') translate(' + (-cx0) + ',' + (-cy0) + ')';
}
function placementBBox(pl) {
  var prof = getProfile(pl.profileId);
  if (!prof) return null;
  var w = prof.width, hh = prof.height;
  var a = (pl.rot || 0) * Math.PI / 180;
  var ca = Math.cos(a), sa = Math.sin(a);
  var pts = [[-w / 2, -hh / 2], [w / 2, -hh / 2], [w / 2, hh / 2], [-w / 2, hh / 2]];
  var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
  pts.forEach(function (p) {
    var x = p[0] * ca - p[1] * sa + pl.cx;
    var y = p[0] * sa + p[1] * ca + pl.cy;
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
  });
  return { minX: mnx, minY: mny, maxX: mxx, maxY: mxy };
}

/* ---- canvas ---- */
function initCanvas(svg, wrapEl) {
  editor.svg = svg;
  var defsG = svgEl('g', { id: 'gridLayer' });
  var worldG = svgEl('g', { id: 'worldLayer' });
  var overlayG = svgEl('g', { id: 'overlayLayer' });
  svg.appendChild(defsG); svg.appendChild(worldG); svg.appendChild(overlayG);
  editor.worldG = worldG; editor.gridG = defsG; editor.overlayG = overlayG;

  function resize() {
    var r = wrapEl.getBoundingClientRect();
    editor.svgW = r.width; editor.svgH = r.height;
    svg.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
    applyViewport();
  }
  window.addEventListener('resize', resize);
  editor._cleanupResize = function () { window.removeEventListener('resize', resize); };
  resize();
  if (!editor.viewport) editor.viewport = { s: 1, tx: 60, ty: editor.svgH - 80 };

  /* pointer interactions */
  var pointers = {};
  var dragState = null; // {mode:'pan'|'place'|'pinch', ...}
  function worldFromEventLoad(e) {
    var r = svg.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - editor.viewport.tx) / editor.viewport.s,
      y: (editor.viewport.ty - (e.clientY - r.top)) / editor.viewport.s
    };
  }
  editor.beginRotate = function (e, mode) {
    var pl = selPlacements()[0];
    if (!pl) return;
    svg.setPointerCapture(e.pointerId);
    if (mode === 'pivot') {
      dragState = { mode: 'pivot', pl: pl };
      return;
    }
    var P = pivotWorld(pl);
    var r = svg.getBoundingClientRect();
    var wx = (e.clientX - r.left - editor.viewport.tx) / editor.viewport.s;
    var wy = (editor.viewport.ty - (e.clientY - r.top)) / editor.viewport.s;
    dragState = {
      mode: 'rotate', pl: pl,
      P: P, rot0: pl.rot || 0, cx0: pl.cx, cy0: pl.cy,
      a0: Math.atan2(wy - P.y, wx - P.x), moved: false
    };
  };
  svg.addEventListener('dblclick', function (e) {
    // double-click sets the rotation pivot on the selected trailer
    var pl = selPlacements()[0];
    if (!pl) return;
    var prof = getProfile(pl.profileId);
    if (!prof || prof.kind === 'truck') return;
    e.preventDefault();
    var r = svg.getBoundingClientRect();
    var wx = (e.clientX - r.left - editor.viewport.tx) / editor.viewport.s;
    var wy = (editor.viewport.ty - (e.clientY - r.top)) / editor.viewport.s;
    setPivotFromWorld(pl, wx, wy);
    renderOverlay();
  });
  svg.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('.rotui')) return; // rotate UI handles its own pointer
    svg.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
      dragState = { mode: 'pinch', d0: Math.hypot(p2.x - p1.x, p2.y - p1.y), s0: editor.viewport.s, cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, tx0: editor.viewport.tx, ty0: editor.viewport.ty };
      return;
    }
    if (editor.measureMode) {
      if (e.target.closest && e.target.closest('.mlabel')) return;
      var wq = worldFromEventLoad(e);
      var spq = snapLoad(wq, e.altKey);
      if (!editor.mDraft) editor.mDraft = spq;
      else {
        var Am = resolveMeasurePoint(editor.mDraft, spq) || editor.mDraft;
        var Bm = resolveMeasurePoint(spq, editor.mDraft) || spq;
        editor.measures.push({ a: editor.mDraft, b: spq, mode: (e.altKey || spq.free) ? 'p' : autoMeasureMode(Am, Bm) });
        editor.mDraft = null;
      }
      renderOverlay();
      return;
    }
    var target = e.target.closest ? e.target.closest('.placement') : null;
    if (target) {
      var pid = target.getAttribute('data-id');
      var tpl = null;
      for (var ti = 0; ti < editor.ld.placements.length; ti++) if (editor.ld.placements[ti].id === pid) tpl = editor.ld.placements[ti];
      var tprof = tpl && getProfile(tpl.profileId);
      var isTruck = tprof && tprof.kind === 'truck';
      if (isTruck && e.shiftKey) return; // the rig never joins a group
      if (e.shiftKey) {
        // build up a group: shift+click adds or removes
        var ix = editor.sel.indexOf(pid);
        if (ix === -1) editor.sel = editor.sel.concat([pid]);
        else editor.sel = editor.sel.filter(function (id) { return id !== pid; });
        renderPlacements(); renderSelPanel();
        return;
      }
      if (!isSel(pid)) editor.sel = [pid];
      renderPlacements(); renderSelPanel();
      dragState = {
        mode: 'place',
        items: selPlacements().map(function (p) { return { pl: p, cx0: p.cx, cy0: p.cy }; }),
        startX: e.clientX, startY: e.clientY, moved: false
      };
    } else if (e.shiftKey && e.pointerType !== 'touch') {
      var rr = svg.getBoundingClientRect();
      dragState = { mode: 'marquee', x0: e.clientX - rr.left, y0: e.clientY - rr.top, x1: e.clientX - rr.left, y1: e.clientY - rr.top };
    } else {
      dragState = { mode: 'pan', startX: e.clientX, startY: e.clientY, tx0: editor.viewport.tx, ty0: editor.viewport.ty, moved: false };
    }
  });
  svg.addEventListener('pointermove', function (e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (editor.measureMode && !dragState) {
      editor.mCursor = snapLoad(worldFromEventLoad(e), e.altKey);
      renderOverlay();
      return;
    }
    if (!dragState) return;
    if (dragState.mode === 'pinch') {
      var ids = Object.keys(pointers);
      if (ids.length < 2) return;
      var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
      var d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      var factor = d / (dragState.d0 || 1);
      var ns = Math.min(400, Math.max(0.01, dragState.s0 * factor));
      var wx = (dragState.cx - dragState.tx0) / dragState.s0;
      var wy = (dragState.ty0 - dragState.cy) / dragState.s0;
      var ncx = (p1.x + p2.x) / 2, ncy = (p1.y + p2.y) / 2;
      editor.viewport.s = ns;
      editor.viewport.tx = ncx - wx * ns;
      editor.viewport.ty = ncy + wy * ns;
      applyViewport();
      return;
    }
    if (dragState.mode === 'pan') {
      var dx = e.clientX - dragState.startX, dy = e.clientY - dragState.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;
      editor.viewport.tx = dragState.tx0 + dx;
      editor.viewport.ty = dragState.ty0 + dy;
      applyViewport();
    } else if (dragState.mode === 'rotate') {
      var vpr = editor.viewport;
      var rect0 = svg.getBoundingClientRect();
      var wxr = (e.clientX - rect0.left - vpr.tx) / vpr.s;
      var wyr = (vpr.ty - (e.clientY - rect0.top)) / vpr.s;
      var P0 = dragState.P;
      var a1 = Math.atan2(wyr - P0.y, wxr - P0.x);
      var deltaDeg = (a1 - dragState.a0) * 180 / Math.PI;
      while (deltaDeg > 180) deltaDeg -= 360;
      while (deltaDeg < -180) deltaDeg += 360;
      var snapDeg = e.shiftKey ? 5 : 0.5;   // fine by default, Shift for coarse
      var newRot = Math.round((dragState.rot0 + deltaDeg) / snapDeg) * snapDeg;
      newRot = Math.round(newRot * 10) / 10;
      if (newRot !== dragState.pl.rot) {
        if (!dragState.moved) { dragState.moved = true; snapshot(); }
        var rad = (newRot - dragState.rot0) * Math.PI / 180;
        dragState.pl.rot = newRot;
        dragState.pl.cx = Math.round((P0.x + (dragState.cx0 - P0.x) * Math.cos(rad) - (dragState.cy0 - P0.y) * Math.sin(rad)) * 100) / 100;
        dragState.pl.cy = Math.round((P0.y + (dragState.cx0 - P0.x) * Math.sin(rad) + (dragState.cy0 - P0.y) * Math.cos(rad)) * 100) / 100;
        updatePlacementTransform(dragState.pl);
        renderOverlay();
        renderStatus();
        renderSelPanel(true);
      }
    } else if (dragState.mode === 'pivot') {
      var vpq = editor.viewport;
      var rectq = svg.getBoundingClientRect();
      var wxq = (e.clientX - rectq.left - vpq.tx) / vpq.s;
      var wyq = (vpq.ty - (e.clientY - rectq.top)) / vpq.s;
      var psnap = Math.min(Math.max(nudgeStep(vpq.s), 0.25), 1);
      setPivotFromWorld(dragState.pl, Math.round(wxq / psnap) * psnap, Math.round(wyq / psnap) * psnap);
      renderOverlay();
    } else if (dragState.mode === 'marquee') {
      var rr2 = svg.getBoundingClientRect();
      dragState.x1 = e.clientX - rr2.left;
      dragState.y1 = e.clientY - rr2.top;
      drawLoadMarquee(dragState);
    } else if (dragState.mode === 'place') {
      var s = editor.viewport.s;
      var dx2 = (e.clientX - dragState.startX) / s;
      var dy2 = -(e.clientY - dragState.startY) / s;
      if (!dragState.moved && (Math.abs(dx2) > 0.5 || Math.abs(dy2) > 0.5)) { dragState.moved = true; snapshot(); }
      if (!dragState.moved) return;
      var snap = Math.min(Math.max(nudgeStep(s), 0.25), 1);  // finer drag snap as you zoom in
      dragState.items.forEach(function (it) {
        it.pl.cx = Math.round((it.cx0 + dx2) / snap) * snap;
        it.pl.cy = Math.round((it.cy0 + dy2) / snap) * snap;
        updatePlacementTransform(it.pl);
      });
      renderStatus();
      renderSelPanel(true);
      renderOverlay();   // keep the rotate pivot riding along with the trailer
    }
  });
  function endPointer(e) {
    delete pointers[e.pointerId];
    if (dragState && (dragState.mode === 'place' || dragState.mode === 'rotate') && dragState.moved) afterMutateNoSnapshot();
    if (dragState && dragState.mode === 'marquee') {
      var vp2 = editor.viewport;
      var wx0 = (Math.min(dragState.x0, dragState.x1) - vp2.tx) / vp2.s;
      var wx1 = (Math.max(dragState.x0, dragState.x1) - vp2.tx) / vp2.s;
      var wy1 = (vp2.ty - Math.min(dragState.y0, dragState.y1)) / vp2.s;
      var wy0 = (vp2.ty - Math.max(dragState.y0, dragState.y1)) / vp2.s;
      var picked = editor.sel.slice();
      editor.ld.placements.forEach(function (pl) {
        var prof2 = getProfile(pl.profileId);
        if (prof2 && prof2.kind === 'truck') return; // box-select never grabs the rig
        var b = placementBBox(pl);
        if (!b) return;
        if (b.minX <= wx1 && b.maxX >= wx0 && b.minY <= wy1 && b.maxY >= wy0 && picked.indexOf(pl.id) === -1) picked.push(pl.id);
      });
      editor.sel = picked;
      renderPlacements(); renderSelPanel(); renderOverlay();
    }
    if (dragState && dragState.mode === 'pan' && !dragState.moved) {
      editor.sel = []; renderPlacements(); renderSelPanel();
    }
    dragState = null;
  }
  function drawLoadMarquee(mq) {
    renderOverlay();
    var x = Math.min(mq.x0, mq.x1), y = Math.min(mq.y0, mq.y1);
    editor.overlayG.appendChild(svgEl('rect', {
      x: x, y: y, width: Math.abs(mq.x1 - mq.x0), height: Math.abs(mq.y1 - mq.y0),
      fill: 'var(--sel)', 'fill-opacity': 0.08, stroke: 'var(--sel)', 'stroke-width': 1, 'stroke-dasharray': '5 4'
    }));
  }
  function afterMutateNoSnapshot() {
    editor.ld.updated = Date.now();
    markDirty();
    renderStackList();
    renderStatus();
    renderOverlay();
    syncUndoBtns();
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var vp = editor.viewport;
    var factor = Math.pow(1.0015, -e.deltaY);
    var ns = Math.min(400, Math.max(0.01, vp.s * factor));
    var rect = svg.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var wx = (px - vp.tx) / vp.s, wy = (vp.ty - py) / vp.s;
    vp.s = ns;
    vp.tx = px - wx * ns;
    vp.ty = py + wy * ns;
    applyViewport();
  }, { passive: false });

  /* keyboard */
  function keyHandler(e) {
    if (!editor) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;
    if (k === 'Alt') { e.preventDefault(); return; }
    if (k === 'Escape' && editor.measureMode) { toggleMeasureMode(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
    if (!selPlacements().length) return;
    var step = e.shiftKey ? 12 : Math.min(Math.max(nudgeStep(editor.viewport.s), 0.25), 12);
    if (k === 'ArrowLeft') { e.preventDefault(); withSel(function (p) { p.cx -= step; }); return; }
    if (k === 'ArrowRight') { e.preventDefault(); withSel(function (p) { p.cx += step; }); return; }
    if (k === 'ArrowUp') { e.preventDefault(); withSel(function (p) { p.cy += step; }); return; }
    if (k === 'ArrowDown') { e.preventDefault(); withSel(function (p) { p.cy -= step; }); return; }
    var binds = keyBindings();
    if (keyMatches(binds.flip, e)) { e.preventDefault(); withSel(function (p) { p.fh = !p.fh; }); }
    else if (keyMatches(binds.roll, e)) { e.preventDefault(); withSel(function (p) { p.fv = !p.fv; }); }
    else if (keyMatches(binds.tiltR, e)) { e.preventDefault(); withSel(function (p) { p.rot = (p.rot || 0) + 5; }); }
    else if (keyMatches(binds.tiltL, e)) { e.preventDefault(); withSel(function (p) { p.rot = (p.rot || 0) - 5; }); }
    else if (keyMatches(binds.tiltReset, e)) { e.preventDefault(); withSel(function (p) { p.rot = 0; }); }
    else if (keyMatches(binds.dup, e)) { e.preventDefault(); duplicateSel(); }
    else if (keyMatches(binds.del, e)) { e.preventDefault(); deleteSel(); }
  }
  document.addEventListener('keydown', keyHandler);
  editor._cleanupKeys = function () { document.removeEventListener('keydown', keyHandler); };
}
function applyViewport() {
  if (!editor || !editor.worldG || !editor.viewport) return;
  var vp = editor.viewport;
  editor.worldG.setAttribute('transform', 'translate(' + vp.tx + ',' + vp.ty + ') scale(' + vp.s + ',' + (-vp.s) + ')');
  renderGrid();
  renderOverlay();
  renderStatus();
}
function fitView() {
  if (!editor) return;
  var pls = editor.ld.placements;
  var mnx = -20, mny = -10, mxx = 800, mxy = 180;
  if (pls.length) {
    mnx = 1e30; mny = 1e30; mxx = -1e30; mxy = -1e30;
    pls.forEach(function (pl) {
      var b = placementBBox(pl);
      if (!b) return;
      if (b.minX < mnx) mnx = b.minX; if (b.minY < mny) mny = b.minY;
      if (b.maxX > mxx) mxx = b.maxX; if (b.maxY > mxy) mxy = b.maxY;
    });
    mny = Math.min(mny, -5); // include ground
    mxy = Math.max(mxy, 170); // include legal line
  }
  var pad = 40;
  var s = Math.min((editor.svgW - pad * 2) / (mxx - mnx || 1), (editor.svgH - pad * 2 - 40) / (mxy - mny || 1));
  s = Math.min(400, Math.max(0.01, s));
  editor.viewport = {
    s: s,
    tx: (editor.svgW - (mxx - mnx) * s) / 2 - mnx * s,
    ty: editor.svgH - ((editor.svgH - (mxy - mny) * s) / 2) + mny * s - 18
  };
  applyViewport();
}
function visibleWorldRect() {
  var vp = editor.viewport;
  return {
    minX: (0 - vp.tx) / vp.s, maxX: (editor.svgW - vp.tx) / vp.s,
    minY: (vp.ty - editor.svgH) / vp.s, maxY: (vp.ty - 0) / vp.s
  };
}
function renderGrid() {
  var g = editor.gridG;
  g.innerHTML = '';
  var vp = editor.viewport;
  var r = visibleWorldRect();
  var spacing = 12;
  if (vp.s >= 30) spacing = 1;
  if (vp.s >= 150) spacing = 0.25;
  if (spacing * vp.s < 7) spacing = 60;
  if (spacing * vp.s < 7) spacing = 240;
  var minor = '', major = '';
  var x0 = Math.floor(r.minX / spacing) * spacing;
  for (var x = x0; x <= r.maxX; x += spacing) {
    var px = vp.tx + x * vp.s;
    var isMajor = Math.abs(x % 120) < 0.01;
    (isMajor ? (major += 'M' + px + ' 0V' + editor.svgH) : (minor += 'M' + px + ' 0V' + editor.svgH));
  }
  var y0 = Math.floor(r.minY / spacing) * spacing;
  for (var y = y0; y <= r.maxY; y += spacing) {
    var py = vp.ty - y * vp.s;
    var isMajorY = Math.abs(y % 120) < 0.01;
    (isMajorY ? (major += 'M0 ' + py + 'H' + editor.svgW) : (minor += 'M0 ' + py + 'H' + editor.svgW));
  }
  g.appendChild(svgEl('path', { d: minor, stroke: 'var(--grid)', 'stroke-width': 1, fill: 'none' }));
  g.appendChild(svgEl('path', { d: major, stroke: 'var(--gridmajor)', 'stroke-width': 1, fill: 'none' }));
}
/* ---- load-builder measurements ---- */
function toggleMeasureMode() {
  if (!editor) return;
  editor.measureMode = !editor.measureMode;
  editor.mDraft = null;
  var b = $('measureBtn');
  if (b) b.className = 'tbtn' + (editor.measureMode ? ' active' : '');
  if (editor.svg) editor.svg.style.cursor = editor.measureMode ? 'crosshair' : '';
  renderOverlay();
  if (editor.measureMode) toast('Measure: click two points — snaps to trailers, deck and ground. Hold Alt for free point-to-point. Esc exits.');
}
function placementLocalFromWorld(pl, wx, wy) {
  var prof = getProfile(pl.profileId);
  var cx0 = (prof.ox || 0) + prof.width / 2, cy0 = (prof.oy || 0) + prof.height / 2;
  var a = (pl.rot || 0) * Math.PI / 180;
  var dx = wx - pl.cx, dy = wy - pl.cy;
  var rx = dx * Math.cos(-a) - dy * Math.sin(-a);
  var ry = dx * Math.sin(-a) + dy * Math.cos(-a);
  return { x: rx * (pl.fh ? -1 : 1) + cx0, y: ry * (pl.fv ? -1 : 1) + cy0 };
}
function placementWorldFromLocal(pl, lx, ly) {
  var prof = getProfile(pl.profileId);
  var cx0 = (prof.ox || 0) + prof.width / 2, cy0 = (prof.oy || 0) + prof.height / 2;
  var a = (pl.rot || 0) * Math.PI / 180;
  var px = (lx - cx0) * (pl.fh ? -1 : 1), py = (ly - cy0) * (pl.fv ? -1 : 1);
  return {
    x: pl.cx + px * Math.cos(a) - py * Math.sin(a),
    y: pl.cy + px * Math.sin(a) + py * Math.cos(a)
  };
}
function snapLoad(w, free) {
  if (free) return { x: Math.round(w.x * 16) / 16, y: Math.round(w.y * 16) / 16, free: true };
  var tol = 8 / editor.viewport.s;
  var best = null, bestD = tol * tol;
  if (Math.abs(w.y) < tol) { best = { x: w.x, y: 0, ground: true }; bestD = w.y * w.y; }
  editor.ld.placements.forEach(function (pl) {
    var prof = getProfile(pl.profileId);
    if (!prof) return;
    var loc = placementLocalFromWorld(pl, w.x, w.y);
    // quick reject: outside profile bbox by more than tol
    if (loc.x < (prof.ox || 0) - tol || loc.x > (prof.ox || 0) + prof.width + tol ||
        loc.y < (prof.oy || 0) - tol || loc.y > (prof.oy || 0) + prof.height + tol) return;
    prof.polylines.forEach(function (p) {
      for (var s = 0; s + 1 < p.length; s++) {
        var ax = p[s][0], ay = p[s][1], bx = p[s + 1][0], by = p[s + 1][1];
        var vx = bx - ax, vy = by - ay;
        var len2 = vx * vx + vy * vy;
        var t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((loc.x - ax) * vx + (loc.y - ay) * vy) / len2));
        var cx2 = ax + vx * t, cy2 = ay + vy * t;
        var dd = (cx2 - loc.x) * (cx2 - loc.x) + (cy2 - loc.y) * (cy2 - loc.y);
        if (dd < bestD) {
          bestD = dd;
          var wpt = placementWorldFromLocal(pl, cx2, cy2);
          best = { x: wpt.x, y: wpt.y, plId: pl.id, lx: cx2, ly: cy2 };
        }
      }
    });
  });
  if (best) return best;
  return { x: Math.round(w.x * 2) / 2, y: Math.round(w.y * 2) / 2 };
}
function resolveMeasurePoint(pt, other) {
  if (pt.ground) {
    var ox = other && !other.ground ? resolveMeasurePoint(other, null) : null;
    return { x: ox ? ox.x : pt.x, y: 0 };
  }
  if (pt.plId) {
    var pl = null;
    for (var i = 0; i < editor.ld.placements.length; i++) if (editor.ld.placements[i].id === pt.plId) pl = editor.ld.placements[i];
    if (!pl || !getProfile(pl.profileId)) return null;
    return placementWorldFromLocal(pl, pt.lx, pt.ly);
  }
  return { x: pt.x, y: pt.y };
}
function renderLoadMeasures(g) {
  if (!editor.measures) return;
  var vp = editor.viewport;
  function sx(x) { return vp.tx + x * vp.s; }
  function sy(y) { return vp.ty - y * vp.s; }
  editor.measures = editor.measures.filter(function (m) {
    return resolveMeasurePoint(m.a, m.b) && resolveMeasurePoint(m.b, m.a);
  });
  editor.measures.forEach(function (m, idx) {
    var A = resolveMeasurePoint(m.a, m.b), B = resolveMeasurePoint(m.b, m.a);
    var mode = m.mode || autoMeasureMode(A, B);
    var du = measureDU(A, B, mode);
    drawDim(g, sx(A.x), sy(A.y), sx(B.x), sy(B.y), fmtIn(du.d), function () {
      measurePopover(editor.canvasWrap, (sx(A.x) + sx(B.x)) / 2, (sy(A.y) + sy(B.y)) / 2, du.d, function (nv) {
        applyLoadMeasure(m, nv);
      }, function () {
        editor.measures.splice(idx, 1);
        renderOverlay();
      }, {
        mode: mode,
        setMode: function (nm) {
          m.mode = nm;
          renderOverlay();
          return measureDU(A, B, nm).d;
        }
      });
    }, false, mode);
  });
  if (editor.mDraft && editor.mCursor) {
    var Aw = resolveMeasurePoint(editor.mDraft, editor.mCursor);
    var dmm = autoMeasureMode(Aw, editor.mCursor);
    drawDim(g, sx(Aw.x), sy(Aw.y), sx(editor.mCursor.x), sy(editor.mCursor.y),
      fmtIn(measureDU(Aw, editor.mCursor, dmm).d), null, true, dmm);
  }
  if (editor.measureMode && editor.mCursor) {
    g.appendChild(svgEl('circle', { cx: sx(editor.mCursor.x), cy: sy(editor.mCursor.y), r: 5, fill: 'none', stroke: 'var(--meas, #2a7de1)', 'stroke-width': 1.6 }));
  }
}
function applyLoadMeasure(m, newD) {
  var A = resolveMeasurePoint(m.a, m.b), B = resolveMeasurePoint(m.b, m.a);
  if (!A || !B) return;
  var mode = m.mode || autoMeasureMode(A, B);
  var du = measureDU(A, B, mode);
  var d = du.d;
  if (mode === 'p' && d < 1e-6) return;
  function movable(pt) {
    if (!pt.plId) return null;
    for (var i = 0; i < editor.ld.placements.length; i++) {
      if (editor.ld.placements[i].id === pt.plId) {
        var prof = getProfile(editor.ld.placements[i].profileId);
        return prof && prof.kind !== 'truck' ? editor.ld.placements[i] : null;
      }
    }
    return null;
  }
  var delta = newD - d;
  var target = movable(m.a), sign = 1;
  if (!target) { target = movable(m.b); sign = -1; }
  if (!target) { toast('Neither end is on a trailer that can move', true); return; }
  var ux = du.ux, uy = du.uy;
  snapshot();
  target.cx = Math.round((target.cx + ux * delta * sign) * 1600) / 1600;
  target.cy = Math.round((target.cy + uy * delta * sign) * 1600) / 1600;
  afterMutate();
  toast('Set to ' + fmtIn(newD));
}
function pivotLocal(pl) {
  return (editor.pivots && editor.pivots[pl.id]) || { x: 0, y: 0 };
}
function pivotWorld(pl) {
  var p = pivotLocal(pl);
  var a = (pl.rot || 0) * Math.PI / 180;
  var sx = pl.fh ? -1 : 1, sy = pl.fv ? -1 : 1;
  var lx = p.x * sx, ly = p.y * sy;
  return {
    x: pl.cx + lx * Math.cos(a) - ly * Math.sin(a),
    y: pl.cy + lx * Math.sin(a) + ly * Math.cos(a)
  };
}
function setPivotFromWorld(pl, wx, wy) {
  var a = (pl.rot || 0) * Math.PI / 180;
  var dx = wx - pl.cx, dy = wy - pl.cy;
  var rx = dx * Math.cos(-a) - dy * Math.sin(-a);
  var ry = dx * Math.sin(-a) + dy * Math.cos(-a);
  var sx = pl.fh ? -1 : 1, sy = pl.fv ? -1 : 1;
  editor.pivots = editor.pivots || {};
  editor.pivots[pl.id] = { x: rx * sx, y: ry * sy };
}
function renderRotateUI(g) {
  var list = selPlacements();
  if (list.length !== 1) return;
  var pl = list[0];
  var prof = getProfile(pl.profileId);
  if (!prof || prof.kind === 'truck') return;
  var vp = editor.viewport;
  var Pw = pivotWorld(pl);
  var px = vp.tx + Pw.x * vp.s, py = vp.ty - Pw.y * vp.s;
  if (px < -100 || px > editor.svgW + 100 || py < -100 || py > editor.svgH + 100) return;
  // grip sits 80px out from the pivot, along the trailer's current tilt
  var a = ((pl.rot || 0) + 90) * Math.PI / 180;
  var gx = px + Math.cos(a) * 80, gy = py - Math.sin(a) * 80;
  g.appendChild(svgEl('line', { x1: px, y1: py, x2: gx, y2: gy, stroke: 'var(--sel)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.8 }));
  // pivot crosshair — drag it, or double-click the sheet, to set where it swings from
  var pivotG = svgEl('g', { class: 'rotui rot-pivot' });
  pivotG.appendChild(svgEl('circle', { cx: px, cy: py, r: 11, fill: 'transparent', stroke: 'transparent' }));
  pivotG.appendChild(svgEl('circle', { cx: px, cy: py, r: 4.5, fill: 'none', stroke: 'var(--sel)', 'stroke-width': 1.6 }));
  pivotG.appendChild(svgEl('line', { x1: px - 9, y1: py, x2: px + 9, y2: py, stroke: 'var(--sel)', 'stroke-width': 1.2 }));
  pivotG.appendChild(svgEl('line', { x1: px, y1: py - 9, x2: px, y2: py + 9, stroke: 'var(--sel)', 'stroke-width': 1.2 }));
  pivotG.addEventListener('pointerdown', function (e) { e.stopPropagation(); if (editor.beginRotate) editor.beginRotate(e, 'pivot'); });
  g.appendChild(pivotG);
  // the grab wheel
  var gripG = svgEl('g', { class: 'rotui rot-grip' });
  gripG.appendChild(svgEl('circle', { cx: gx, cy: gy, r: 10, fill: 'var(--panel)', stroke: 'var(--sel)', 'stroke-width': 1.6 }));
  var gt = svgEl('text', { x: gx, y: gy + 4, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--sel)' });
  gt.textContent = '⟳';
  gripG.appendChild(gt);
  gripG.addEventListener('pointerdown', function (e) { e.stopPropagation(); if (editor.beginRotate) editor.beginRotate(e, 'rotate'); });
  g.appendChild(gripG);
  // live angle readout
  var lbl = svgEl('text', { x: gx + 14, y: gy - 8, 'font-size': 11.5, fill: 'var(--sel)', 'font-family': 'IBM Plex Mono,monospace' });
  lbl.textContent = (pl.rot || 0).toFixed(1) + '°';
  g.appendChild(lbl);
}
function renderOverlay() {
  var g = editor.overlayG;
  g.innerHTML = '';
  var vp = editor.viewport;
  var r = visibleWorldRect();
  // ground line at y=0
  var gy = vp.ty;
  if (gy >= -20 && gy <= editor.svgH + 20) {
    g.appendChild(svgEl('line', { x1: 0, y1: gy, x2: editor.svgW, y2: gy, stroke: 'var(--draw-dim)', 'stroke-width': 1.5 }));
    // hatch below ground
    var hat = '';
    for (var px = -10; px < editor.svgW + 10; px += 14) hat += 'M' + px + ' ' + gy + 'l-8 10';
    g.appendChild(svgEl('path', { d: hat, stroke: 'var(--draw-dim)', 'stroke-width': 1, fill: 'none', opacity: 0.55 }));
  }
  // legal height 13'6" = 162"
  var ly = vp.ty - 162 * vp.s;
  if (ly >= -20 && ly <= editor.svgH + 20) {
    g.appendChild(svgEl('line', { x1: 0, y1: ly, x2: editor.svgW, y2: ly, stroke: 'var(--bad)', 'stroke-width': 1, 'stroke-dasharray': '7 5', opacity: 0.7 }));
    var t = svgEl('text', { x: editor.svgW - 8, y: ly - 5, 'text-anchor': 'end', fill: 'var(--bad)', 'font-size': 11, 'font-family': 'IBM Plex Mono,monospace', opacity: 0.9 });
    t.textContent = "13'-6\" legal height";
    g.appendChild(t);
  }
  if (!editor.measureMode) renderRotateUI(g);
  renderLoadMeasures(g);
}
function renderPlacements() {
  if (!editor || !editor.worldG) return;
  var g = editor.worldG;
  g.innerHTML = '';
  editor.ld.placements.forEach(function (pl) {
    var prof = getProfile(pl.profileId);
    if (!prof) return;
    var pg = svgEl('g', { class: 'placement' + (isSel(pl.id) ? ' selected' : ''), 'data-id': pl.id, transform: placementMatrix(pl, prof) });
    var d = profilePath(prof);
    pg.appendChild(svgEl('path', { class: 'hit', d: d }));
    pg.appendChild(svgEl('path', { class: 'viz', d: d }));
    if (isSel(pl.id)) {
      pg.appendChild(svgEl('rect', { class: 'selbox', x: (prof.ox || 0) - 2, y: (prof.oy || 0) - 2, width: prof.width + 4, height: prof.height + 4 }));
    }
    g.appendChild(pg);
  });
  renderStatus();
  if (editor.overlayG && editor.viewport) renderOverlay();
}
function updatePlacementTransform(pl) {
  var prof = getProfile(pl.profileId);
  var node = editor.worldG.querySelector('[data-id="' + pl.id + '"]');
  if (node && prof) node.setAttribute('transform', placementMatrix(pl, prof));
}
function loadExtents(ld) {
  var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30, any = false;
  ld.placements.forEach(function (pl) {
    var b = placementBBox(pl);
    if (!b) return;
    any = true;
    if (b.minX < mnx) mnx = b.minX; if (b.minY < mny) mny = b.minY;
    if (b.maxX > mxx) mxx = b.maxX; if (b.maxY > mxy) mxy = b.maxY;
  });
  return any ? { minX: mnx, minY: mny, maxX: mxx, maxY: mxy } : null;
}
function renderStatus() {
  var sb = $('statusbar');
  if (!sb || !editor) return;
  var ext = loadExtents(editor.ld);
  var len = ext ? ext.maxX - ext.minX : 0;
  var hgt = ext ? ext.maxY : 0;   // height above ground line
  var over = hgt > 162.001;
  sb.innerHTML = '';
  sb.appendChild(h('span', null, ['LENGTH ', h('b', null, [ext ? ftin(len) : '–'])]));
  sb.appendChild(h('span', { class: over ? 'over' : '' }, ['TOP OF LOAD ', h('b', { class: over ? 'over' : '' }, [ext ? ftin(hgt) : '–']), over ? ' OVER 13′-6″' : '']));
  sb.appendChild(h('span', null, [editor.ld.placements.length + ' PLACED']));
  if (selIds().length > 1) sb.appendChild(h('span', null, [h('b', null, [String(selIds().length)]), ' SELECTED']));
  sb.appendChild(h('span', { class: 'spacer' }));
  var vp = editor.viewport;
  var zc = h('span', { class: 'zoomctl' }, [
    h('button', { onclick: function () { zoomBy(1 / 1.25); }, title: 'Zoom out' }, ['−']),
    h('span', null, [Math.round(vp.s * 100) / 100 + 'px/in']),
    h('button', { onclick: function () { zoomBy(1.25); }, title: 'Zoom in' }, ['+'])
  ]);
  sb.appendChild(zc);
}
function zoomBy(f) {
  var vp = editor.viewport;
  var px = editor.svgW / 2, py = editor.svgH / 2;
  var wx = (px - vp.tx) / vp.s, wy = (vp.ty - py) / vp.s;
  vp.s = Math.min(400, Math.max(0.01, vp.s * f));
  vp.tx = px - wx * vp.s;
  vp.ty = py + wy * vp.s;
  applyViewport();
}

/* ---- inspector rendering ---- */
function renderSelPanel(light) {
  var sp = $('selPanel');
  if (!sp || !editor) return;
  var list = selPlacements();
  if (list.length > 1) {
    if (light) return;
    sp.innerHTML = '';
    sp.appendChild(h('div', { class: 'selname' }, [list.length + ' trailers selected']));
    sp.appendChild(h('div', { style: 'color:var(--muted);font-size:12.5px;margin-bottom:8px' }, ['Arrows move the whole group (Shift = 12"). Drag any one of them to move all.']));
    sp.appendChild(h('div', { class: 'selbtns' }, [
      h('button', { class: 'btn small', onclick: function () { withSel(function (p) { p.fh = !p.fh; }); } }, ['↔ Flip all']),
      h('button', { class: 'btn small', onclick: function () { withSel(function (p) { p.fv = !p.fv; }); } }, ['↕ Roll all']),
      h('button', { class: 'btn small', onclick: duplicateSel }, ['Duplicate']),
      h('button', { class: 'btn small', onclick: deleteSel, style: 'color:var(--bad)' }, ['Remove all'])
    ]));
    return;
  }
  var pl = list[0] || null;
  if (!pl) {
    sp.innerHTML = '';
    sp.appendChild(h('div', { style: 'color:var(--muted);font-size:13px;padding:2px 0 6px' }, ['Click a trailer to select it — Shift+click or Shift+drag a box to grab several.']));
    return;
  }
  var prof = getProfile(pl.profileId);
  if (light) {
    var xInp = sp.querySelector('[data-k="cx"]'), yInp = sp.querySelector('[data-k="cy"]');
    var rInp = sp.querySelector('[data-k="rot"]');
    if (xInp) xInp.value = pl.cx;
    if (yInp) yInp.value = pl.cy;
    if (rInp) rInp.value = pl.rot || 0;
    return;
  }
  sp.innerHTML = '';
  sp.appendChild(h('div', { class: 'selname' }, [prof ? prof.name : '?']));
  function numInput(key, label) {
    var inp = h('input', { type: 'number', step: 1, 'data-k': key });
    inp.value = pl[key];
    inp.addEventListener('change', function () { withSel(function (p) { p[key] = parseFloat(inp.value) || 0; }); });
    return [h('span', null, [label]), inp];
  }
  var row = h('div', { class: 'numrow' });
  numInput('cx', 'X in').concat(numInput('cy', 'Y in')).forEach(function (n) { row.appendChild(n); });
  sp.appendChild(row);
  var row2 = h('div', { class: 'numrow' });
  var rotInp = h('input', { type: 'number', step: 1, 'data-k': 'rot' });
  rotInp.value = pl.rot || 0;
  rotInp.addEventListener('change', function () { withSel(function (p) { p.rot = parseFloat(rotInp.value) || 0; }); });
  row2.appendChild(h('span', null, ['TILT °']));
  row2.appendChild(rotInp);
  var b = placementBBox(pl);
  row2.appendChild(h('span', null, ['TOP']));
  row2.appendChild(h('input', { value: b ? ftin(b.maxY) : '', disabled: true }));
  sp.appendChild(row2);
  sp.appendChild(h('div', { class: 'selbtns' }, [
    h('button', { class: 'btn small', onclick: function () { withSel(function (p) { p.fh = !p.fh; }); } }, ['↔ Flip']),
    h('button', { class: 'btn small', onclick: function () { withSel(function (p) { p.fv = !p.fv; }); } }, ['↕ Roll over']),
    h('button', { class: 'btn small', onclick: duplicateSel }, ['Duplicate']),
    h('button', { class: 'btn small', onclick: deleteSel, style: 'color:var(--bad)' }, ['Remove'])
  ]));
}
function renderStackList() {
  var sl = $('stackList');
  if (!sl || !editor) return;
  sl.innerHTML = '';
  var counts = {};
  editor.ld.placements.forEach(function (pl) {
    var prof = getProfile(pl.profileId);
    var name = prof ? prof.name : 'Unknown';
    counts[name] = (counts[name] || 0) + 1;
  });
  var keys = Object.keys(counts);
  if (!keys.length) { sl.appendChild(h('div', { class: 'srow' }, ['Nothing placed yet'])); return; }
  keys.forEach(function (k) {
    sl.appendChild(h('div', { class: 'srow' }, [h('span', null, [k]), h('b', null, ['× ' + counts[k]])]));
  });
}
function renderPhotos() {
  var pg = $('photoGrid');
  if (!pg || !editor) return;
  pg.innerHTML = '';
  editor.ld.photos.forEach(function (ph) {
    var cell = h('div', { class: 'photocell', onclick: function () { getPhotoURL(ph, function (u) { if (u) openLightbox(u); }); } });
    var img = h('img', { alt: 'Load photo', loading: 'lazy' });
    getPhotoURL(ph, function (u) { if (u) img.src = u; });
    cell.appendChild(img);
    cell.appendChild(h('button', { class: 'del', title: 'Delete photo', onclick: function (e) {
      e.stopPropagation();
      confirmModal('Delete this photo?', function () {
        removePhotoFile(ph);
        editor.ld.photos = editor.ld.photos.filter(function (x) { return x.id !== ph.id; });
        editor.ld.updated = Date.now();
        markDirty(); renderPhotos();
      }, { okLabel: 'Delete', danger: true });
    } }, ['✕']));
    pg.appendChild(cell);
  });
  if (!editor.ld.photos.length) {
    pg.appendChild(h('div', { style: 'grid-column:1/-1;color:var(--muted);font-size:12.5px;padding:2px 0' }, ['Add photos after the load is stacked to keep the record.']));
  }
}

/* ---------- auto stack ---------- */
var hmCache = {};
function heightMap(prof, fh) {
  // Per-1" bin bottom (B) and top (T) profiles in coords relative to the profile center.
  var key = prof.id + '|' + (fh ? 1 : 0);
  if (hmCache[key]) return hmCache[key];
  var w = prof.width, hh = prof.height;
  var cx0 = (prof.ox || 0) + w / 2, cy0 = (prof.oy || 0) + hh / 2;
  var n = Math.max(1, Math.ceil(w)) + 1;
  var B = new Float64Array(n), T = new Float64Array(n);
  for (var i = 0; i < n; i++) { B[i] = 1e9; T[i] = -1e9; }
  var sx = fh ? -1 : 1;
  prof.polylines.forEach(function (p) {
    for (var s = 0; s + 1 < p.length; s++) {
      var x1 = (p[s][0] - cx0) * sx, y1 = p[s][1] - cy0;
      var x2 = (p[s + 1][0] - cx0) * sx, y2 = p[s + 1][1] - cy0;
      if (x2 < x1) { var tx = x1; x1 = x2; x2 = tx; var ty = y1; y1 = y2; y2 = ty; }
      var b1 = Math.max(0, Math.floor(x1 + w / 2)), b2 = Math.min(n - 1, Math.ceil(x2 + w / 2));
      for (var b = b1; b <= b2; b++) {
        var bx = b - w / 2;
        var y;
        if (x2 - x1 < 1e-9) y = null;
        else {
          var t = (bx - x1) / (x2 - x1);
          t = Math.max(0, Math.min(1, t));
          y = y1 + (y2 - y1) * t;
        }
        if (y === null) { // vertical segment: spans both ys
          if (Math.min(y1, y2) < B[b]) B[b] = Math.min(y1, y2);
          if (Math.max(y1, y2) > T[b]) T[b] = Math.max(y1, y2);
        } else {
          if (y < B[b]) B[b] = y;
          if (y > T[b]) T[b] = y;
        }
      }
    }
  });
  var out = { B: B, T: T, n: n, w: w };
  hmCache[key] = out;
  return out;
}
function autoStack() {
  if (!editor) return;
  var trailers = [], carrier = null;
  editor.ld.placements.forEach(function (pl) {
    var prof = getProfile(pl.profileId);
    if (!prof) return;
    if (prof.kind === 'truck' && !carrier) carrier = { pl: pl, prof: prof };
    else if (prof.kind !== 'truck') trailers.push({ pl: pl, prof: prof });
  });
  if (!trailers.length) { toast('Nothing to stack — add some trailers first'); return; }
  snapshot();
  var OFF = 300, BINS = 2400;   // world x from -300 to 2100
  var S = new Float64Array(BINS); // ground = 0
  var spanMin = 0, spanMax = 800;
  if (carrier) {
    var chm = heightMap(carrier.prof, carrier.pl.fh);
    for (var b = 0; b < chm.n; b++) {
      if (chm.T[b] < -1e8) continue;
      var wb = Math.round(carrier.pl.cx + (b - chm.w / 2)) + OFF;
      if (wb >= 0 && wb < BINS) S[wb] = Math.max(S[wb], carrier.pl.cy + chm.T[b]);
    }
    // cargo may only sit on the deck — never over the tractor, never past the tail
    var cp = carrier.prof;
    var ccx = (cp.ox || 0) + cp.width / 2;
    var csx = carrier.pl.fh ? -1 : 1;
    var d0 = cp.deck0 != null ? cp.deck0 : (cp.ox || 0);
    var d1 = cp.deck1 != null ? cp.deck1 : (cp.ox || 0) + cp.width;
    var w0 = carrier.pl.cx + (d0 - ccx) * csx;
    var w1 = carrier.pl.cx + (d1 - ccx) * csx;
    spanMin = Math.min(w0, w1);
    spanMax = Math.max(w0, w1);
  }
  var clearance = 0.375;   // nest tight — as low as the linework allows
  var HCAP = 162, COLGAP = 4;
  var tooLong = [], overCap = false;

  function tryPlace(t, lo0, hi0, prefFh, step) {
    var best = null;
    [false, true].forEach(function (fh) {
      var hm = heightMap(t.prof, fh);
      var half = hm.w / 2;
      var lo = lo0 + half, hi = hi0 - half;
      if (lo > hi) { lo = hi = (lo0 + hi0) / 2; }
      var Tmax = -1e9;
      for (var b3 = 0; b3 < hm.n; b3++) if (hm.T[b3] > -1e8 && hm.T[b3] > Tmax) Tmax = hm.T[b3];
      for (var cx = lo; cx <= hi + 0.001; cx += step) {
        var need = -1e9, support = 0;
        for (var b2 = 0; b2 < hm.n; b2++) {
          if (hm.B[b2] > 1e8) continue;
          var wb2 = Math.round(cx + (b2 - half)) + OFF;
          if (wb2 < 0 || wb2 >= BINS) continue;
          var g = S[wb2] - hm.B[b2];
          if (g > need) need = g;
          support++;
        }
        if (!support) continue;
        var cy = need + clearance;
        var top = cy + Tmax;
        var score = top - (fh === prefFh ? 0.05 : 0); // slight pull toward alternating layers
        if (!best || score < best.score - 0.01 || (Math.abs(score - best.score) <= 0.01 && cx < best.cx)) {
          best = { cx: cx, cy: cy, fh: fh, top: top, score: score, hm: hm, half: half };
        }
      }
    });
    return best;
  }
  function commit(t, best) {
    t.pl.cx = Math.round(best.cx);
    t.pl.cy = Math.round(best.cy * 2) / 2;
    t.pl.fh = best.fh;
    t.pl.fv = false;
    t.pl.rot = 0;
    for (var b4 = 0; b4 < best.hm.n; b4++) {
      if (best.hm.T[b4] < -1e8) continue;
      var wb4 = Math.round(t.pl.cx + (b4 - best.half)) + OFF;
      if (wb4 >= 0 && wb4 < BINS) S[wb4] = Math.max(S[wb4], t.pl.cy + best.hm.T[b4]);
    }
  }

  // widest first, identical models grouped — bigger on the bottom, small ones top off a stack
  trailers.sort(function (a, b) { return (b.prof.width - a.prof.width) || a.prof.name.localeCompare(b.prof.name); });
  var remaining = trailers.slice();

  // anything longer than the deck itself: center it flat, flag it
  remaining = remaining.filter(function (t) {
    if (t.prof.width <= (spanMax - spanMin) + 0.01) return true;
    if (tooLong.indexOf(t.prof.name) === -1) tooLong.push(t.prof.name);
    var b = tryPlace(t, spanMin, spanMax, true, 4);
    if (b) commit(t, b);
    return false;
  });

  // build tight columns front-to-back: pile a stack as high as legal, then move over
  var x = spanMin;
  while (remaining.length && x < spanMax - 24) {
    var colW = Math.min(remaining[0].prof.width, spanMax - x);
    var winHi = Math.min(x + colW + 2, spanMax);
    var placedAny = false, colRight = x + 12, lastFh = true;
    var i = 0;
    while (i < remaining.length) {
      var t = remaining[i];
      if (t.prof.width > (winHi - x) + 0.01) { i++; continue; }
      var best = tryPlace(t, x, winHi, !lastFh, 2);
      if (!best || best.top > HCAP + 0.001) { i++; continue; } // maybe a shorter model still fits under the cap
      commit(t, best);
      colRight = Math.max(colRight, best.cx + t.prof.width / 2);
      lastFh = best.fh;
      remaining.splice(i, 1);
      placedAny = true;
    }
    if (!placedAny) break;
    x = colRight + COLGAP;
  }

  // whatever is left can't fit under 13'-6" on this deck — place it lowest-possible and say so
  if (remaining.length) {
    overCap = true;
    remaining.forEach(function (t) {
      var b = tryPlace(t, spanMin, spanMax, true, 4);
      if (b) commit(t, b);
    });
  }

  afterMutate();
  fitView();
  var n = trailers.length;
  if (tooLong.length) toast(tooLong.join(', ') + (tooLong.length > 1 ? ' are' : ' is') + ' longer than the deck — centered, but hanging over', true);
  else if (overCap) toast('Stacked, but not everything fits under 13\'-6" on this deck — the load is over height', true);
  else toast('Stacked ' + n + ' trailer' + (n > 1 ? 's' : '') + ' — inside the deck, under 13\'-6"');
}

/* ---------- print ---------- */
function doPrint() {
  if (!editor) return;
  fitView();
  var ld = editor.ld;
  var counts = {};
  ld.placements.forEach(function (pl) {
    var prof = getProfile(pl.profileId);
    if (prof && prof.kind === 'truck') return;
    var name = prof ? prof.name : 'Unknown';
    counts[name] = (counts[name] || 0) + 1;
  });
  var stackStr = Object.keys(counts).map(function (k) { return counts[k] + ' × ' + k; }).join(' · ') || '—';
  var ext = loadExtents(ld);
  var pb = $('printBlock');
  pb.innerHTML =
    '<table class="ptitle"><tr>' +
    '<td style="width:22%"><span class="lbl">Load</span><span class="big">' + esc(ld.loadNo ? '#' + ld.loadNo : '—') + '</span></td>' +
    '<td style="width:30%"><span class="lbl">Customer / destination</span>' + esc(ld.customer || '—') + '</td>' +
    '<td style="width:16%"><span class="lbl">Ship date</span>' + esc(ld.date || '—') + '</td>' +
    '<td><span class="lbl">Overall</span>' + (ext ? esc(ftin(ext.maxX - ext.minX)) + ' long · ' + esc(ftin(ext.maxY)) + ' top of load' : '—') + '</td>' +
    '<td style="width:18%"><span class="lbl">Sheet</span>Rice Trailers · Rice Stacker</td>' +
    '</tr><tr>' +
    '<td colspan="3"><span class="lbl">Stack</span>' + esc(stackStr) + '</td>' +
    '<td colspan="2"><span class="lbl">Notes</span>' + esc(ld.notes || '—') + '</td>' +
    '</tr></table>';
  var wasSel = editor.sel;
  editor.sel = [];
  renderPlacements();
  setTimeout(function () {
    window.print();
    editor.sel = wasSel;
    renderPlacements();
  }, 120);
}

/* ---------- profile drawing editor ---------- */
var drawClipboard = null;   // copied linework — survives switching models, so parts move between drawings
// Zoom-aware nudge: the finer you're zoomed in, the finer the step (~4 screen px per tap).
function nudgeStep(pxPerInch) {
  var raw = 4 / pxPerInch;
  var steps = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 6, 12, 24];
  for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) return steps[i];
  return 48;
}
function fmtStep(s) {
  if (s === 1 / 16) return '1/16"';
  if (s === 1 / 8) return '1/8"';
  if (s === 1 / 4) return '1/4"';
  if (s === 1 / 2) return '1/2"';
  return s + '"';
}
function fmtIn(d) {
  var v = Math.round(d * 100) / 100;
  return (v % 1 === 0 ? v.toFixed(0) : v) + '"';
}
// accepts 96 · 96.5 · 96 1/2 · 8' · 8'6 · 8' 6.5
function parseLen(s) {
  s = String(s).trim().replace(/"/g, '');
  var m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?)?$/);
  if (m) return (+m[1]) * 12 + (+m[2] || 0) + (m[3] ? (+m[3]) / (+m[4]) : 0);
  m = s.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?$/);
  if (m) return (+m[1]) + (m[2] ? (+m[2]) / (+m[3]) : 0);
  return NaN;
}
// distance + direction between two points, honoring the dimension mode
function measureDU(A, B, mode) {
  if (mode === 'x') {
    var dx0 = Math.abs(A.x - B.x);
    return { d: dx0, ux: A.x >= B.x ? 1 : -1, uy: 0 };
  }
  if (mode === 'y') {
    var dy0 = Math.abs(A.y - B.y);
    return { d: dy0, ux: 0, uy: A.y >= B.y ? 1 : -1 };
  }
  var dx = A.x - B.x, dy = A.y - B.y;
  var d = Math.hypot(dx, dy);
  if (d < 1e-9) return { d: 0, ux: 1, uy: 0 };
  return { d: d, ux: dx / d, uy: dy / d };
}
// near-horizontal → X dimension, near-vertical → Y, otherwise point-to-point
function autoMeasureMode(A, B) {
  var adx = Math.abs(A.x - B.x), ady = Math.abs(A.y - B.y);
  var t = Math.tan(10 * Math.PI / 180);
  if (ady <= adx * t) return 'x';
  if (adx <= ady * t) return 'y';
  return 'p';
}
// small floating input for editing a measurement in place
function measurePopover(hostEl, x, y, val, onApply, onDelete, modeCtl) {
  var old = document.querySelector('.measure-pop');
  if (old) old.remove();
  var inp = h('input', { value: Math.round(val * 100) / 100 });
  var modeBtns = null;
  if (modeCtl) {
    var defs = [['x', '↔', 'Horizontal (X) only'], ['y', '↕', 'Vertical (Y) only'], ['p', '⤡', 'Point to point']];
    modeBtns = h('div', { class: 'mp-modes' }, defs.map(function (df) {
      var b = h('button', { class: 'mp-mode' + (modeCtl.mode === df[0] ? ' on' : ''), title: df[2] }, [df[1]]);
      b.addEventListener('click', function () {
        var nv = modeCtl.setMode(df[0]);
        inp.value = Math.round(nv * 100) / 100;
        modeBtns.querySelectorAll('.mp-mode').forEach(function (x2) { x2.classList.remove('on'); });
        b.classList.add('on');
        inp.focus(); inp.select();
      });
      return b;
    }));
  }
  var pop = h('div', { class: 'measure-pop' }, [
    modeBtns,
    inp,
    h('button', { class: 'mp-ok', title: 'Set measurement', onclick: apply }, ['✓']),
    h('button', { class: 'mp-del', title: 'Delete measurement', onclick: function () { close(); onDelete(); } }, ['✕'])
  ]);
  function apply() {
    var v = parseLen(inp.value);
    if (!isFinite(v) || v < 0) { toast('Enter a length like 96, 96.5 or 8\'6', true); return; }
    close();
    onApply(v);
  }
  function close() {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) { if (!pop.contains(e.target)) close(); }
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') apply();
    if (e.key === 'Escape') close();
    e.stopPropagation();
  });
  pop.style.left = Math.max(6, Math.min(x - 60, hostEl.clientWidth - 160)) + 'px';
  pop.style.top = Math.max(6, y - 44) + 'px';
  hostEl.appendChild(pop);
  setTimeout(function () { document.addEventListener('pointerdown', outside, true); inp.focus(); inp.select(); }, 0);
}
// dimension drawing shared by both editors (screen coords)
// mode: 'p' = direct point-to-point, 'x' = horizontal with extension lines, 'y' = vertical
function drawDim(g, x1, y1, x2, y2, label, onLabelDown, faint, mode) {
  var col = 'var(--meas, #2a7de1)';
  var op = faint ? 0.6 : 0.95;
  function seg(a, b, c, d, dash) {
    g.appendChild(svgEl('line', { x1: a, y1: b, x2: c, y2: d, stroke: col, 'stroke-width': 1.2, 'stroke-dasharray': dash || (faint ? '4 4' : ''), opacity: op }));
  }
  var mx, my;
  if (mode === 'x') {
    var dimY = Math.max(y1, y2) + 26;
    seg(x1, y1 + 3, x1, dimY + 4, '3 3');   // extension lines
    seg(x2, y2 + 3, x2, dimY + 4, '3 3');
    seg(x1, dimY, x2, dimY);                // dimension line
    [[x1, dimY], [x2, dimY]].forEach(function (p) { g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 2.6, fill: col })); });
    mx = (x1 + x2) / 2; my = dimY;
  } else if (mode === 'y') {
    var dimX = Math.max(x1, x2) + 26;
    seg(x1 + 3, y1, dimX + 4, y1, '3 3');
    seg(x2 + 3, y2, dimX + 4, y2, '3 3');
    seg(dimX, y1, dimX, y2);
    [[dimX, y1], [dimX, y2]].forEach(function (p) { g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 2.6, fill: col })); });
    mx = dimX + 6; my = (y1 + y2) / 2 + 12;
  } else {
    seg(x1, y1, x2, y2);
    [[x1, y1], [x2, y2]].forEach(function (p) { g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3, fill: col })); });
    mx = (x1 + x2) / 2; my = (y1 + y2) / 2;
  }
  var lg = svgEl('g', { class: 'mlabel', style: 'cursor:pointer' });
  var tw = Math.max(34, label.length * 7.5 + 12);
  lg.appendChild(svgEl('rect', { x: mx - tw / 2, y: my - 21, width: tw, height: 18, rx: 9, fill: 'var(--panel)', stroke: col, 'stroke-width': 1.2 }));
  var t = svgEl('text', { x: mx, y: my - 8, 'text-anchor': 'middle', 'font-size': 11.5, 'font-family': 'IBM Plex Mono,monospace', fill: col, style: 'pointer-events:none' });
  t.textContent = label;
  lg.appendChild(t);
  if (onLabelDown) lg.addEventListener('pointerdown', function (e) { e.stopPropagation(); onLabelDown(e); });
  g.appendChild(lg);
}
function renderDrawEditor(root, profile) {
  var dCache = drawCache[profile.id];
  var polys = dCache ? dCache.polys : JSON.parse(JSON.stringify(profile.polylines));
  var undoStack = dCache ? dCache.undo : [], redoStack = dCache ? dCache.redo : [];
  var drawDirty = dCache ? !!dCache.dirty : false;
  var closedOut = false;
  var tool = 'select';
  var selSet = dCache && dCache.selSet ? dCache.selSet : {};   // idx -> true (multi-select)
  var draft = null;      // in-progress points for line/curve; {pts:[...]} or arc/circle stages
  var vp = null;
  var svgW = 0, svgH = 0;
  var spaceHeld = false;
  function selCount() { return Object.keys(selSet).length; }
  function clearSel() { selSet = {}; selPivot = null; }

  var svg = svgEl('svg', { class: 'sheet' });
  var gridG = svgEl('g'), geoG = svgEl('g'), prevG = svgEl('g'), markG = svgEl('g'), selG = svgEl('g');
  svg.appendChild(gridG); svg.appendChild(geoG); svg.appendChild(prevG); svg.appendChild(markG); svg.appendChild(selG);
  var selPivot = dCache ? dCache.selPivot : null;
  var rotDrag = null;       // {origs, P, a0, applied, moved}
  var snapOn = true;        // 🧲 toggle; hold Alt for a momentary free cursor
  var wrapEl = h('div', { class: 'canvas-wrap', style: 'grid-column:1/-1' });
  wrapEl.appendChild(svg);

  function tbtn(id, label, title) {
    var b = h('button', { class: 'tbtn' + (tool === id ? ' active' : ''), title: title, onclick: function () { setTool(id); } }, [label]);
    b.setAttribute('data-tool', id);
    return b;
  }
  var toolbar = h('div', { class: 'toolbar' }, [
    tbtn('select', '⬚ Select', 'Click a line, Shift+click to add, or drag a box around several. Arrows nudge the selection; hold Space to pan'),
    tbtn('line', '╱ Line', 'Click points to chain lines; double-click or Esc to stop'),
    tbtn('curve', '∿ Curve', 'Click points for a smooth curve; double-click or Esc to finish'),
    tbtn('arc', '◠ Arc', 'Click start, end, then a point the arc passes through'),
    tbtn('circle', '◯ Circle', 'Click center, then a point on the circle'),
    tbtn('measure', '📏 Measure', 'Click two points (snaps to lines; hold Alt for free point-to-point). Click the number to type an exact distance — the measured lines move to match'),
    h('button', { class: 'tbtn active', id: 'dSnap', onclick: function () {
      snapOn = !snapOn;
      this.className = 'tbtn' + (snapOn ? ' active' : '');
      toast(snapOn ? 'Snap on' : 'Snap off — free cursor (Alt does this too, held)');
    }, title: 'Snap to lines and straighten near-level lines. Hold Alt to override it just while held' }, ['🧲 Snap']),
    h('div', { class: 'sep' }),
    h('button', { class: 'tbtn', onclick: insertModelDlg, title: 'Bring another model’s linework onto this canvas to grab parts from' }, ['⤓ Insert model']),
    h('button', { class: 'tbtn', id: 'dCopy', onclick: copySel, title: 'Copy selected lines (Ctrl+C)' }, ['⎘ Copy']),
    h('button', { class: 'tbtn', id: 'dPaste', onclick: pasteClip, title: 'Paste copied lines (Ctrl+V) — works across models too' }, ['⎗ Paste']),
    h('button', { class: 'tbtn', id: 'dFlipH', onclick: function () { flipSel(true); }, title: 'Mirror selected lines left/right (F)' }, ['↔ Flip']),
    h('button', { class: 'tbtn', id: 'dFlipV', onclick: function () { flipSel(false); }, title: 'Mirror selected lines up/down (V)' }, ['↕ Flip V']),
    h('div', { class: 'sep' }),
    h('button', { class: 'tbtn', id: 'dDelete', onclick: deleteSelPoly, title: 'Delete selected lines (Del)' }, ['✕ Delete']),
    h('button', { class: 'tbtn', id: 'dUndo', onclick: dUndo, title: 'Undo (Ctrl+Z)' }, ['↶ Undo']),
    h('button', { class: 'tbtn', id: 'dRedo', onclick: dRedo, title: 'Redo' }, ['↷ Redo']),
    h('div', { class: 'sep' }),
    h('button', { class: 'tbtn', onclick: fitDraw, title: 'Zoom to fit' }, ['⛶ Fit']),
    h('div', { class: 'sep' }),
    h('button', { class: 'tbtn', onclick: cancelEdit }, ['Cancel']),
    h('button', { class: 'tbtn', onclick: saveAsNew, title: 'Keep the base model and save these edits as a new profile' }, ['⧉ Save as copy']),
    h('button', { class: 'tbtn', style: 'background:var(--accent);color:var(--accent-ink)', onclick: saveEdit }, ['✓ Save drawing'])
  ]);
  wrapEl.appendChild(toolbar);
  var statusbar = h('div', { class: 'statusbar' });
  wrapEl.appendChild(statusbar);
  root.appendChild(h('div', { class: 'editor', style: 'grid-template-columns:1fr' }, [wrapEl]));

  function setTool(id) {
    tool = id; draft = null; clearSel();
    toolbar.querySelectorAll('[data-tool]').forEach(function (b) {
      b.className = 'tbtn' + (b.getAttribute('data-tool') === tool ? ' active' : '');
    });
    renderGeo(); renderPreview(null);
    renderStatusD();
  }
  // near-axis lines lock straight; Shift forces it even over a geometry snap
  function orthoAdjust(pt, last, snappedToGeo, force, free) {
    var dx = pt[0] - last[0], dy = pt[1] - last[1];
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var t = Math.tan(8 * Math.PI / 180);
    if (force) {
      return adx >= ady ? [pt[0], last[1]] : [last[0], pt[1]];
    }
    if (free || snappedToGeo) return pt;
    if (ady <= adx * t) return [pt[0], last[1]];
    if (adx <= ady * t) return [last[0], pt[1]];
    return pt;
  }
  function snapPoint(wx, wy, free) {
    if (free || !snapOn) {
      // free cursor: exact spot, just tidied to 1/16"
      return { x: Math.round(wx * 16) / 16, y: Math.round(wy * 16) / 16, snapped: false, poly: null, free: true };
    }
    // endpoints first, then anywhere along a line, then the grid
    var tol = 8 / vp.s;
    var best = null, bestD = tol * tol, bestPoly = null;
    for (var i = 0; i < polys.length; i++) {
      var p = polys[i];
      [p[0], p[p.length - 1]].forEach(function (pt) {
        var d = (pt[0] - wx) * (pt[0] - wx) + (pt[1] - wy) * (pt[1] - wy);
        if (d < bestD) { bestD = d; best = [pt[0], pt[1]]; bestPoly = i; }
      });
    }
    if (draft && draft.pts && draft.pts.length) {
      var f = draft.pts[0];
      var d0 = (f[0] - wx) * (f[0] - wx) + (f[1] - wy) * (f[1] - wy);
      if (d0 < bestD) { bestD = d0; best = [f[0], f[1]]; bestPoly = null; }
    }
    if (best) return { x: best[0], y: best[1], snapped: true, poly: bestPoly };
    // nearest point ON a line
    var lineD = (tol * 0.9) * (tol * 0.9);
    for (var j = 0; j < polys.length; j++) {
      var q = polys[j];
      for (var s = 0; s + 1 < q.length; s++) {
        var ax = q[s][0], ay = q[s][1], bx = q[s + 1][0], by = q[s + 1][1];
        var vx = bx - ax, vy = by - ay;
        var len2 = vx * vx + vy * vy;
        if (len2 < 1e-12) continue;
        var t = ((wx - ax) * vx + (wy - ay) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        var cx2 = ax + vx * t, cy2 = ay + vy * t;
        var dd = (cx2 - wx) * (cx2 - wx) + (cy2 - wy) * (cy2 - wy);
        if (dd < lineD) { lineD = dd; best = [cx2, cy2]; bestPoly = j; }
      }
    }
    if (best) return { x: best[0], y: best[1], snapped: true, poly: bestPoly };
    var gs = Math.min(nudgeStep(vp.s), 1);  // grid snap tightens as you zoom in
    return { x: Math.round(wx / gs) * gs, y: Math.round(wy / gs) * gs, snapped: false, poly: null };
  }
  /* --- measurements --- */
  var measures = dCache && dCache.measures ? dCache.measures : [];  // [{ax,ay,bx,by,aPoly}]
  var mDraft = null;      // {ax,ay,aPoly}
  var measG = svgEl('g');
  svg.appendChild(measG);
  function renderMeasures(cursor) {
    measG.innerHTML = '';
    function sx(x) { return vp.tx + x * vp.s; }
    function sy(y) { return vp.ty - y * vp.s; }
    measures.forEach(function (m, idx) {
      var A = { x: m.ax, y: m.ay }, B = { x: m.bx, y: m.by };
      var mode = m.mode || autoMeasureMode(A, B);
      var du = measureDU(A, B, mode);
      drawDim(measG, sx(m.ax), sy(m.ay), sx(m.bx), sy(m.by), fmtIn(du.d), function (e) {
        measurePopover(wrapEl, (sx(m.ax) + sx(m.bx)) / 2, (sy(m.ay) + sy(m.by)) / 2, du.d, function (nv) {
          applyMeasureD(m, nv);
        }, function () {
          measures.splice(idx, 1);
          renderMeasures();
        }, {
          mode: mode,
          setMode: function (nm) {
            m.mode = nm;
            renderMeasures();
            return measureDU(A, B, nm).d;
          }
        });
      }, false, mode);
    });
    if (mDraft && cursor) {
      var Ad = { x: mDraft.ax, y: mDraft.ay }, Bd = { x: cursor.x, y: cursor.y };
      var dm = autoMeasureMode(Ad, Bd);
      drawDim(measG, sx(mDraft.ax), sy(mDraft.ay), sx(cursor.x), sy(cursor.y),
        fmtIn(measureDU(Ad, Bd, dm).d), null, true, dm);
    }
  }
  function applyMeasureD(m, newD) {
    var A = { x: m.ax, y: m.ay }, B = { x: m.bx, y: m.by };
    var mode = m.mode || autoMeasureMode(A, B);
    var du = measureDU(A, B, mode);
    var d = du.d, ux = du.ux, uy = du.uy;
    if (mode === 'p' && d < 1e-6) return;
    var delta = newD - d;
    var targets;
    if (m.aPoly != null && selSet[m.aPoly]) targets = Object.keys(selSet).map(Number);
    else if (m.aPoly != null) targets = [m.aPoly];
    else { toast('The first point isn’t on a line — nothing to move', true); return; }
    targets = targets.filter(function (i) { return polys[i]; });
    if (!targets.length) return;
    pushUndo();
    targets.forEach(function (i) {
      polys[i] = polys[i].map(function (pt) {
        return [Math.round((pt[0] + ux * delta) * 1600) / 1600, Math.round((pt[1] + uy * delta) * 1600) / 1600];
      });
    });
    m.ax += ux * delta; m.ay += uy * delta;
    renderGeo(); syncBtns(); renderStatusD();
    toast('Moved to ' + fmtIn(newD));
  }
  function worldFromEvent(e) {
    var r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - vp.tx) / vp.s, y: (vp.ty - (e.clientY - r.top)) / vp.s };
  }
  function pushUndo() {
    undoStack.push(JSON.stringify(polys));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    drawDirty = true;
    renderTabs();
    syncBtns();
  }
  function dUndo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(polys));
    polys = JSON.parse(undoStack.pop());
    clearSel(); draft = null;
    renderGeo(); renderPreview(null); syncBtns();
  }
  function dRedo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(polys));
    polys = JSON.parse(redoStack.pop());
    clearSel(); draft = null;
    renderGeo(); renderPreview(null); syncBtns();
  }
  function syncBtns() {
    var u = toolbar.querySelector('#dUndo'), r = toolbar.querySelector('#dRedo'), d = toolbar.querySelector('#dDelete');
    var c = toolbar.querySelector('#dCopy'), v = toolbar.querySelector('#dPaste');
    var fh = toolbar.querySelector('#dFlipH'), fv = toolbar.querySelector('#dFlipV');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
    if (d) d.disabled = !selCount();
    if (c) c.disabled = !selCount();
    if (v) v.disabled = !drawClipboard;
    if (fh) fh.disabled = !selCount();
    if (fv) fv.disabled = !selCount();
  }
  function selBBox(list) {
    var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
    list.forEach(function (p) { p.forEach(function (pt) {
      if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
      if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
    }); });
    return mnx > mxx ? null : { minX: mnx, minY: mny, maxX: mxx, maxY: mxy };
  }
  function copySel() {
    if (!selCount()) return;
    drawClipboard = {
      polys: Object.keys(selSet).map(function (i) { return JSON.parse(JSON.stringify(polys[+i])); }),
      pastes: 0
    };
    syncBtns(); renderStatusD();
    toast('Copied ' + drawClipboard.polys.length + ' line' + (drawClipboard.polys.length > 1 ? 's' : ''));
  }
  function pasteClip() {
    if (!drawClipboard || !drawClipboard.polys.length) return;
    pushUndo();
    var bb = selBBox(drawClipboard.polys);
    // land the paste at the middle of the current view, staggering repeats
    var vcx = (svgW / 2 - vp.tx) / vp.s, vcy = (vp.ty - svgH / 2) / vp.s;
    var dx = Math.round(vcx - (bb.minX + bb.maxX) / 2) + drawClipboard.pastes * 12;
    var dy = Math.round(vcy - (bb.minY + bb.maxY) / 2) - drawClipboard.pastes * 12;
    drawClipboard.pastes++;
    clearSel();
    drawClipboard.polys.forEach(function (p) {
      polys.push(p.map(function (pt) { return [Math.round((pt[0] + dx) * 1600) / 1600, Math.round((pt[1] + dy) * 1600) / 1600]; }));
      selSet[polys.length - 1] = true;
    });
    renderGeo(); syncBtns(); renderStatusD();
  }
  function insertModelDlg() {
    var scrim = h('div', { class: 'modal-scrim' });
    var listEl = h('div', { style: 'display:flex;flex-direction:column;gap:2px' });
    var searchI = h('input', { placeholder: 'Search models…', style: 'width:100%;margin-bottom:10px' });
    function renderList() {
      var q2 = searchI.value.trim().toLowerCase();
      listEl.innerHTML = '';
      builtins.concat(state.profiles).filter(function (p) {
        return p.id !== profile.id && (!q2 || p.name.toLowerCase().indexOf(q2) !== -1);
      }).slice(0, 60).forEach(function (p) {
        var th = h('div', { class: 'pthumb', style: 'width:110px;height:36px' });
        th.appendChild(thumbSVG(p));
        listEl.appendChild(h('button', { class: 'palitem', onclick: function () {
          scrim.remove();
          insertModel(p);
        } }, [
          th,
          h('div', { class: 'plabel' }, [h('b', null, [p.name]), h('span', null, [ftin(p.width)])])
        ]));
      });
      if (!listEl.children.length) listEl.appendChild(h('div', { style: 'color:var(--muted);padding:8px' }, ['No matches.']));
    }
    searchI.addEventListener('input', renderList);
    scrim.appendChild(h('div', { class: 'modal small' }, [
      h('div', { class: 'modal-head' }, [
        h('h2', null, ['Insert model']),
        h('button', { class: 'iconbtn', onclick: function () { scrim.remove(); } }, ['✕'])
      ]),
      h('div', { class: 'modal-body' }, [
        h('p', { style: 'margin:0 0 10px;color:var(--muted);font-size:13px' }, ['Its linework lands next to your drawing, already selected — grab the parts you want, then delete the rest.']),
        searchI, listEl
      ])
    ]));
    document.body.appendChild(scrim);
    renderList();
    searchI.focus();
  }
  function insertModel(src) {
    pushUndo();
    var cur = selBBox(polys);
    var ins = JSON.parse(JSON.stringify(src.polylines));
    var ib = selBBox(ins);
    var dx = 0, dy = 0;
    if (cur && ib) {
      dx = Math.round(cur.maxX + 30 - ib.minX);
      dy = Math.round(cur.minY - ib.minY);
    }
    clearSel();
    ins.forEach(function (p) {
      polys.push(p.map(function (pt) { return [Math.round((pt[0] + dx) * 1600) / 1600, Math.round((pt[1] + dy) * 1600) / 1600]; }));
      selSet[polys.length - 1] = true;
    });
    renderGeo(); syncBtns(); renderStatusD();
    fitDraw();
    toast('"' + src.name + '" inserted and selected — box-select the part you want, Ctrl+C, then delete the rest');
  }
  function deleteSelPoly() {
    if (!selCount()) return;
    pushUndo();
    polys = polys.filter(function (_, i) { return !selSet[i]; });
    clearSel();
    selPivot = null;
    renderGeo(); syncBtns(); renderStatusD();
  }
  function selBBoxSel() {
    var list = Object.keys(selSet).map(function (i) { return polys[+i]; });
    if (!list.length) return null;
    return selBBox(list);
  }
  function flipSel(horiz) {
    if (!selCount()) return;
    var bb = selBBoxSel();
    var cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    pushUndo();
    Object.keys(selSet).forEach(function (i) {
      polys[+i] = polys[+i].map(function (pt) {
        return horiz ? [Math.round((2 * cx - pt[0]) * 1600) / 1600, pt[1]]
                     : [pt[0], Math.round((2 * cy - pt[1]) * 1600) / 1600];
      });
    });
    renderGeo(); syncBtns();
  }
  function selPivotPoint() {
    if (selPivot) return selPivot;
    var bb = selBBoxSel();
    return bb ? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } : null;
  }
  function renderSelUI() {
    selG.innerHTML = '';
    if (tool !== 'select' || !selCount() || moving || marquee) return;
    var P = selPivotPoint();
    if (!P) return;
    var px = vp.tx + P.x * vp.s, py = vp.ty - P.y * vp.s;
    if (px < -60 || px > svgW + 60 || py < -60 || py > svgH + 60) return;
    var ang = rotDrag ? rotDrag.applied : 0;
    var a = (ang + 90) * Math.PI / 180;
    var gx = px + Math.cos(a) * 74, gy = py - Math.sin(a) * 74;
    selG.appendChild(svgEl('line', { x1: px, y1: py, x2: gx, y2: gy, stroke: 'var(--sel)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.8 }));
    var pivotG = svgEl('g', { class: 'drotui', style: 'cursor:move' });
    pivotG.appendChild(svgEl('circle', { cx: px, cy: py, r: 11, fill: 'transparent', stroke: 'transparent' }));
    pivotG.appendChild(svgEl('circle', { cx: px, cy: py, r: 4.5, fill: 'none', stroke: 'var(--sel)', 'stroke-width': 1.6 }));
    pivotG.appendChild(svgEl('line', { x1: px - 9, y1: py, x2: px + 9, y2: py, stroke: 'var(--sel)', 'stroke-width': 1.2 }));
    pivotG.appendChild(svgEl('line', { x1: px, y1: py - 9, x2: px, y2: py + 9, stroke: 'var(--sel)', 'stroke-width': 1.2 }));
    pivotG.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      svg.setPointerCapture(e.pointerId);
      rotDrag = { mode: 'pivot' };
    });
    selG.appendChild(pivotG);
    var gripG = svgEl('g', { class: 'drotui', style: 'cursor:grab' });
    gripG.appendChild(svgEl('circle', { cx: gx, cy: gy, r: 10, fill: 'var(--panel)', stroke: 'var(--sel)', 'stroke-width': 1.6 }));
    var gt = svgEl('text', { x: gx, y: gy + 4, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--sel)', style: 'pointer-events:none' });
    gt.textContent = '⟳';
    gripG.appendChild(gt);
    gripG.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      svg.setPointerCapture(e.pointerId);
      var w = worldFromEvent(e);
      var P2 = selPivotPoint();
      var origs = {};
      Object.keys(selSet).forEach(function (i) { origs[i] = JSON.parse(JSON.stringify(polys[+i])); });
      rotDrag = { mode: 'rotate', origs: origs, snap: JSON.stringify(polys), P: P2, a0: Math.atan2(w.y - P2.y, w.x - P2.x), applied: 0, moved: false };
    });
    selG.appendChild(gripG);
    if (rotDrag && rotDrag.mode === 'rotate') {
      var lbl = svgEl('text', { x: gx + 14, y: gy - 8, 'font-size': 11.5, fill: 'var(--sel)', 'font-family': 'IBM Plex Mono,monospace', style: 'pointer-events:none' });
      lbl.textContent = (rotDrag.applied > 0 ? '+' : '') + rotDrag.applied.toFixed(1) + '°';
      selG.appendChild(lbl);
    }
  }
  function moveSelection(dx, dy) {
    if (!selCount()) return;
    Object.keys(selSet).forEach(function (i) {
      polys[+i] = polys[+i].map(function (pt) { return [Math.round((pt[0] + dx) * 1600) / 1600, Math.round((pt[1] + dy) * 1600) / 1600]; });
    });
    renderGeo();
  }

  /* geometry helpers */
  function catmullRom(pts, seg) {
    if (pts.length < 3) return pts.slice();
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      for (var t = 0; t < seg; t++) {
        var u = t / seg, u2 = u * u, u3 = u2 * u;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)
        ]);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  function arcThrough(a, b, c) {
    // circle through 3 points; returns sampled arc from a to b passing through c
    var d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-9) return [a, c, b]; // collinear → line
    var ux = ((a[0] * a[0] + a[1] * a[1]) * (b[1] - c[1]) + (b[0] * b[0] + b[1] * b[1]) * (c[1] - a[1]) + (c[0] * c[0] + c[1] * c[1]) * (a[1] - b[1])) / d;
    var uy = ((a[0] * a[0] + a[1] * a[1]) * (c[0] - b[0]) + (b[0] * b[0] + b[1] * b[1]) * (a[0] - c[0]) + (c[0] * c[0] + c[1] * c[1]) * (b[0] - a[0])) / d;
    var r = Math.hypot(a[0] - ux, a[1] - uy);
    var a0 = Math.atan2(a[1] - uy, a[0] - ux);
    var a1 = Math.atan2(b[1] - uy, b[0] - ux);
    var am = Math.atan2(c[1] - uy, c[0] - ux);
    // pick sweep direction that passes through c
    function norm(t) { while (t < 0) t += Math.PI * 2; return t % (Math.PI * 2); }
    var ccwSweep = norm(a1 - a0), midCCW = norm(am - a0);
    var ccw = midCCW <= ccwSweep;
    var sweep = ccw ? ccwSweep : ccwSweep - Math.PI * 2;
    var n = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var t = a0 + sweep * i / n;
      pts.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]);
    }
    return pts;
  }
  function circlePts(c, edge) {
    var r = Math.hypot(edge[0] - c[0], edge[1] - c[1]);
    if (r < 0.05) return null;
    var n = Math.max(16, Math.ceil(r));
    var pts = [];
    for (var i = 0; i <= Math.min(n, 64); i++) {
      var t = i / Math.min(n, 64) * Math.PI * 2;
      pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
    }
    return pts;
  }
  function commitPoly(pts) {
    if (!pts || pts.length < 2) return;
    pushUndo();
    polys.push(pts.map(function (p) { return [Math.round(p[0] * 1600) / 1600, Math.round(p[1] * 1600) / 1600]; }));
    renderGeo();
  }

  /* rendering */
  function applyVP() {
    geoG.setAttribute('transform', 'translate(' + vp.tx + ',' + vp.ty + ') scale(' + vp.s + ',' + (-vp.s) + ')');
    prevG.setAttribute('transform', geoG.getAttribute('transform'));
    renderGridD();
    renderMeasures();
    renderStatusD();
  }
  function renderGridD() {
    gridG.innerHTML = '';
    var minor = '', major = '';
    var spacing = 6;
    if (vp.s >= 30) spacing = 1;
    if (vp.s >= 150) spacing = 0.25;
    if (spacing * vp.s < 6) spacing = 12;
    if (spacing * vp.s < 6) spacing = 60;
    var r = { minX: (0 - vp.tx) / vp.s, maxX: (svgW - vp.tx) / vp.s, minY: (vp.ty - svgH) / vp.s, maxY: vp.ty / vp.s };
    for (var x = Math.floor(r.minX / spacing) * spacing; x <= r.maxX; x += spacing) {
      var px = vp.tx + x * vp.s;
      (Math.abs(x % 60) < 0.01 ? (major += 'M' + px + ' 0V' + svgH) : (minor += 'M' + px + ' 0V' + svgH));
    }
    for (var y = Math.floor(r.minY / spacing) * spacing; y <= r.maxY; y += spacing) {
      var py = vp.ty - y * vp.s;
      (Math.abs(y % 60) < 0.01 ? (major += 'M0 ' + py + 'H' + svgW) : (minor += 'M0 ' + py + 'H' + svgW));
    }
    gridG.appendChild(svgEl('path', { d: minor, stroke: 'var(--grid)', 'stroke-width': 1, fill: 'none' }));
    gridG.appendChild(svgEl('path', { d: major, stroke: 'var(--gridmajor)', 'stroke-width': 1, fill: 'none' }));
  }
  function renderGeo() {
    geoG.innerHTML = '';
    polys.forEach(function (p, i) {
      var d = 'M' + p.map(function (pt) { return pt[0] + ' ' + pt[1]; }).join('L');
      geoG.appendChild(svgEl('path', { d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 6 / vp.s, 'data-i': i }));
      geoG.appendChild(svgEl('path', { d: d, fill: 'none', stroke: selSet[i] ? 'var(--sel)' : 'var(--draw)', 'stroke-width': selSet[i] ? 2 : 1.4, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    });
    renderSelUI();
    renderMeasures();
  }
  function renderPreview(pts, marker) {
    prevG.innerHTML = ''; markG.innerHTML = '';
    if (pts && pts.length >= 2) {
      prevG.appendChild(svgEl('path', {
        d: 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L'),
        fill: 'none', stroke: 'var(--sel)', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '6 4', 'pointer-events': 'none'
      }));
    }
    if (draft && draft.pts) {
      draft.pts.forEach(function (p) {
        markG.appendChild(svgEl('circle', { cx: vp.tx + p[0] * vp.s, cy: vp.ty - p[1] * vp.s, r: 3, fill: 'var(--sel)' }));
      });
    }
    if (marker) {
      markG.appendChild(svgEl('circle', { cx: vp.tx + marker.x * vp.s, cy: vp.ty - marker.y * vp.s, r: marker.snapped ? 5 : 3, fill: 'none', stroke: 'var(--sel)', 'stroke-width': 1.5 }));
    }
  }
  var hintByTool = {
    select: 'Click or drag a box to select · Shift adds · arrows nudge (Shift = 12") · drag a selected line to move · Space+drag pans',
    line: 'Click to place points — chains as you go. Double-click or Esc to stop.',
    curve: 'Click points along the shape. Double-click or Esc to finish the curve.',
    arc: 'Click start, then end, then a point the arc bulges through.',
    circle: 'Click the center, then a point on the edge.',
    measure: 'Click two points — snaps to lines. Click a measurement to type the exact distance; the lines move to match.'
  };
  var lastCursor = null;
  function renderStatusD() {
    statusbar.innerHTML = '';
    statusbar.appendChild(h('span', null, [lastCursor ? 'X ' + lastCursor.x.toFixed(1) + '"  Y ' + lastCursor.y.toFixed(1) + '"' : '']));
    statusbar.appendChild(h('span', null, [hintByTool[tool] || '']));
    statusbar.appendChild(h('span', { class: 'spacer' }));
    statusbar.appendChild(h('span', { title: 'Arrow-key nudge at this zoom (Shift = 12×). Zoom in for finer moves.' }, ['NUDGE ', h('b', null, [fmtStep(nudgeStep(vp.s))])]));
    if (selCount()) statusbar.appendChild(h('span', null, [h('b', null, [String(selCount())]), ' SELECTED']));
    statusbar.appendChild(h('span', null, [polys.length + ' LINES']));
  }
  function fitDraw() {
    var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
    polys.forEach(function (p) { p.forEach(function (pt) {
      if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
      if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
    }); });
    if (mnx > mxx) { mnx = 0; mny = 0; mxx = 100; mxy = 50; }
    var pad = 60;
    var s = Math.min((svgW - pad * 2) / (mxx - mnx || 1), (svgH - pad * 2) / (mxy - mny || 1));
    s = Math.min(400, Math.max(0.01, s));
    vp = { s: s, tx: (svgW - (mxx - mnx) * s) / 2 - mnx * s, ty: svgH - ((svgH - (mxy - mny) * s) / 2) + mny * s };
    applyVP(); renderGeo(); renderPreview(null);
  }

  /* interactions */
  var panning = null;
  var marquee = null;   // {x0,y0,x1,y1} screen coords
  var moving = null;    // {startW, snap: json-at-start, moved}
  function drawMarquee() {
    markG.innerHTML = '';
    if (!marquee) return;
    var x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    var w2 = Math.abs(marquee.x1 - marquee.x0), h2 = Math.abs(marquee.y1 - marquee.y0);
    markG.appendChild(svgEl('rect', { x: x, y: y, width: w2, height: h2, fill: 'var(--sel)', 'fill-opacity': 0.08, stroke: 'var(--sel)', 'stroke-width': 1, 'stroke-dasharray': '5 4' }));
  }
  function applyMarquee(add) {
    if (!marquee) return;
    // convert screen rect to world rect
    var wx0 = (Math.min(marquee.x0, marquee.x1) - vp.tx) / vp.s;
    var wx1 = (Math.max(marquee.x0, marquee.x1) - vp.tx) / vp.s;
    var wy1 = (vp.ty - Math.min(marquee.y0, marquee.y1)) / vp.s;
    var wy0 = (vp.ty - Math.max(marquee.y0, marquee.y1)) / vp.s;
    if (!add) clearSel();
    polys.forEach(function (p, i) {
      for (var k = 0; k < p.length; k++) {
        if (p[k][0] >= wx0 && p[k][0] <= wx1 && p[k][1] >= wy0 && p[k][1] <= wy1) { selSet[i] = true; return; }
      }
    });
    renderGeo(); syncBtns(); renderStatusD();
  }
  svg.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('.drotui')) return; // rotate UI handles its own pointer
    svg.setPointerCapture(e.pointerId);
    var w = worldFromEvent(e);
    if (spaceHeld || e.button === 1) {
      panning = { sx: e.clientX, sy: e.clientY, tx0: vp.tx, ty0: vp.ty };
      return;
    }
    if (tool === 'select') {
      var hit = e.target.getAttribute && e.target.getAttribute('data-i');
      if (hit != null) {
        var idx = +hit;
        if (e.shiftKey) {
          if (selSet[idx]) delete selSet[idx]; else selSet[idx] = true;
        } else if (!selSet[idx]) {
          clearSel(); selSet[idx] = true;
        }
        renderGeo(); syncBtns(); renderStatusD();
        if (selSet[idx] && !e.shiftKey) {
          moving = { startW: w, snap: JSON.stringify(polys), origs: {}, moved: false };
          Object.keys(selSet).forEach(function (i) { moving.origs[i] = JSON.parse(JSON.stringify(polys[+i])); });
        }
      } else {
        if (e.pointerType === 'touch') {
          panning = { sx: e.clientX, sy: e.clientY, tx0: vp.tx, ty0: vp.ty };
        } else {
          var r = svg.getBoundingClientRect();
          marquee = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, add: e.shiftKey };
          drawMarquee();
        }
      }
      return;
    }
    var sp = snapPoint(w.x, w.y, e.altKey);
    var pt = [sp.x, sp.y];
    if (tool === 'measure') {
      if (!mDraft) mDraft = { ax: sp.x, ay: sp.y, aPoly: sp.poly };
      else {
        measures.push({
          ax: mDraft.ax, ay: mDraft.ay, bx: sp.x, by: sp.y, aPoly: mDraft.aPoly,
          mode: (e.altKey || sp.free) ? 'p' : autoMeasureMode({ x: mDraft.ax, y: mDraft.ay }, { x: sp.x, y: sp.y })
        });
        mDraft = null;
      }
      renderMeasures(sp);
      renderStatusD();
      return;
    }
    if (tool === 'line' || tool === 'curve') {
      if (!draft) draft = { pts: [] };
      var pts = draft.pts;
      if (tool === 'line' && pts.length) pt = orthoAdjust(pt, pts[pts.length - 1], sp.snapped, e.shiftKey, e.altKey || !snapOn);
      if (pts.length && Math.abs(pts[pts.length - 1][0] - pt[0]) < 1e-6 && Math.abs(pts[pts.length - 1][1] - pt[1]) < 1e-6) {
        finishDraft(); return; // double-click same spot ends it
      }
      pts.push(pt);
      renderPreview(tool === 'curve' && pts.length >= 3 ? catmullRom(pts, 8) : pts);
    } else if (tool === 'arc') {
      if (!draft) draft = { pts: [] };
      draft.pts.push(pt);
      if (draft.pts.length === 3) {
        commitPoly(arcThrough(draft.pts[0], draft.pts[1], draft.pts[2]));
        draft = null; renderPreview(null);
      }
    } else if (tool === 'circle') {
      if (!draft) { draft = { pts: [pt] }; }
      else {
        var c = circlePts(draft.pts[0], pt);
        if (c) commitPoly(c);
        draft = null; renderPreview(null);
      }
    }
    renderStatusD();
  });
  svg.addEventListener('pointermove', function (e) {
    var w = worldFromEvent(e);
    if (rotDrag) {
      if (rotDrag.mode === 'pivot') {
        var ps = Math.min(nudgeStep(vp.s), 1);
        selPivot = { x: Math.round(w.x / ps) * ps, y: Math.round(w.y / ps) * ps };
        renderSelUI();
        return;
      }
      if (rotDrag.mode === 'rotate') {
        var a1 = Math.atan2(w.y - rotDrag.P.y, w.x - rotDrag.P.x);
        var deltaDeg = (a1 - rotDrag.a0) * 180 / Math.PI;
        while (deltaDeg > 180) deltaDeg -= 360;
        while (deltaDeg < -180) deltaDeg += 360;
        var snapDeg = e.shiftKey ? 5 : 0.5;
        deltaDeg = Math.round(deltaDeg / snapDeg) * snapDeg;
        deltaDeg = Math.round(deltaDeg * 10) / 10;
        if (deltaDeg !== rotDrag.applied) {
          rotDrag.applied = deltaDeg;
          rotDrag.moved = true;
          var rad = deltaDeg * Math.PI / 180;
          var ca = Math.cos(rad), sa = Math.sin(rad);
          Object.keys(rotDrag.origs).forEach(function (i) {
            polys[+i] = rotDrag.origs[i].map(function (pt) {
              var dx = pt[0] - rotDrag.P.x, dy = pt[1] - rotDrag.P.y;
              return [rotDrag.P.x + dx * ca - dy * sa, rotDrag.P.y + dx * sa + dy * ca];
            });
          });
          renderGeo(); renderStatusD();
        }
        return;
      }
    }
    if (panning) {
      vp.tx = panning.tx0 + (e.clientX - panning.sx);
      vp.ty = panning.ty0 + (e.clientY - panning.sy);
      applyVP(); renderGeo(); renderPreview(null);
      return;
    }
    lastCursor = w;
    if (tool === 'measure') {
      var spm = snapPoint(w.x, w.y, e.altKey);
      renderMeasures(spm);
      renderPreview(null, spm);
      renderStatusD();
      return;
    }
    if (marquee) {
      var r2 = svg.getBoundingClientRect();
      marquee.x1 = e.clientX - r2.left; marquee.y1 = e.clientY - r2.top;
      drawMarquee();
      return;
    }
    if (moving) {
      var ms = Math.min(nudgeStep(vp.s), 1);
      var dx = Math.round((w.x - moving.startW.x) / ms) * ms;
      var dy = Math.round((w.y - moving.startW.y) / ms) * ms;
      if (dx || dy) moving.moved = true;
      Object.keys(moving.origs).forEach(function (i) {
        polys[+i] = moving.origs[i].map(function (pt) { return [pt[0] + dx, pt[1] + dy]; });
      });
      renderGeo(); renderStatusD();
      return;
    }
    if (tool === 'select') { renderStatusD(); return; }
    var sp = snapPoint(w.x, w.y, e.altKey);
    var pt = [sp.x, sp.y];
    if (draft && draft.pts.length) {
      if (tool === 'line') {
        pt = orthoAdjust(pt, draft.pts[draft.pts.length - 1], sp.snapped, e.shiftKey, e.altKey || !snapOn);
        renderPreview(draft.pts.concat([pt]), sp);
      }
      else if (tool === 'curve') {
        var all = draft.pts.concat([pt]);
        renderPreview(all.length >= 3 ? catmullRom(all, 8) : all, sp);
      } else if (tool === 'arc') {
        if (draft.pts.length === 1) renderPreview([draft.pts[0], pt], sp);
        else renderPreview(arcThrough(draft.pts[0], draft.pts[1], pt), sp);
      } else if (tool === 'circle') {
        var c = circlePts(draft.pts[0], pt);
        renderPreview(c, sp);
      }
    } else {
      renderPreview(null, sp);
    }
    renderStatusD();
  });
  svg.addEventListener('pointerup', function () {
    panning = null;
    if (rotDrag) {
      if (rotDrag.mode === 'rotate' && rotDrag.moved) {
        undoStack.push(rotDrag.snap);
        if (undoStack.length > 100) undoStack.shift();
        redoStack = [];
        drawDirty = true;
        renderTabs();
        Object.keys(rotDrag.origs).forEach(function (i) {
          polys[+i] = polys[+i].map(function (pt) { return [Math.round(pt[0] * 1600) / 1600, Math.round(pt[1] * 1600) / 1600]; });
        });
        renderGeo(); syncBtns();
      }
      rotDrag = null;
      renderSelUI();
      return;
    }
    if (marquee) {
      var moved = Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) > 4;
      if (moved) applyMarquee(marquee.add);
      else { clearSel(); renderGeo(); syncBtns(); renderStatusD(); }
      marquee = null; markG.innerHTML = '';
      renderSelUI();
    }
    if (moving) {
      if (moving.moved) {
        undoStack.push(moving.snap);
        if (undoStack.length > 100) undoStack.shift();
        redoStack = [];
        drawDirty = true;
        renderTabs();
        // final fine rounding (1/1600" keeps 16th-inch steps exact)
        Object.keys(moving.origs).forEach(function (i) {
          polys[+i] = polys[+i].map(function (pt) { return [Math.round(pt[0] * 1600) / 1600, Math.round(pt[1] * 1600) / 1600]; });
        });
        renderGeo(); syncBtns();
      }
      moving = null;
    }
  });
  svg.addEventListener('dblclick', function (e) {
    e.preventDefault();
    if (draft) { finishDraft(); return; }
    if (tool === 'select' && selCount()) {
      // double-click plants the rotation pivot for the selected lines
      var w2 = worldFromEvent(e);
      selPivot = { x: w2.x, y: w2.y };
      renderSelUI();
      return;
    }
    finishDraft();
  });
  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = svg.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var wx = (px - vp.tx) / vp.s, wy = (vp.ty - py) / vp.s;
    vp.s = Math.min(400, Math.max(0.01, vp.s * Math.pow(1.0015, -e.deltaY)));
    vp.tx = px - wx * vp.s;
    vp.ty = py + wy * vp.s;
    applyVP(); renderGeo(); renderPreview(null);
  }, { passive: false });

  function finishDraft() {
    if (!draft || !draft.pts) { draft = null; renderPreview(null); return; }
    if (tool === 'line' && draft.pts.length >= 2) commitPoly(draft.pts);
    else if (tool === 'curve' && draft.pts.length >= 2) commitPoly(draft.pts.length >= 3 ? catmullRom(draft.pts, 8) : draft.pts);
    draft = null;
    renderPreview(null);
  }
  function keyHandlerD(e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Alt') { e.preventDefault(); return; }
    if (e.key === ' ') { spaceHeld = true; e.preventDefault(); return; }
    if (e.key === 'Escape') { if (mDraft) { mDraft = null; renderMeasures(); } else if (draft) { finishDraft(); } else if (selCount()) { clearSel(); renderGeo(); syncBtns(); renderStatusD(); } else setTool('select'); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? dRedo() : dUndo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); dRedo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); polys.forEach(function (_, i) { selSet[i] = true; }); renderGeo(); syncBtns(); renderStatusD(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySel(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClip(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') { e.preventDefault(); copySel(); deleteSelPoly(); }
    else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && selCount()) { flipSel(true); }
    else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && selCount()) { flipSel(false); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelPoly(); }
    else if (e.key.indexOf('Arrow') === 0 && selCount()) {
      e.preventDefault();
      var step = nudgeStep(vp.s);
      if (e.shiftKey) step = step * 12;
      pushUndo();
      moveSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
                    e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0);
      renderStatusD();
    }
  }
  function keyUpD(e) { if (e.key === ' ') spaceHeld = false; }
  document.addEventListener('keydown', keyHandlerD);
  document.addEventListener('keyup', keyUpD);

  function cleanup() { document.removeEventListener('keydown', keyHandlerD); document.removeEventListener('keyup', keyUpD); window.__drawCleanup = null; }
  window.__drawCleanup = cleanup;
  function closeOut() {
    closedOut = true;
    delete drawCache[profile.id];
    openDrawTabs = openDrawTabs.filter(function (x) { return x !== profile.id; });
    window.__drawStash = null;
  }
  function cancelEdit() {
    if (drawDirty) {
      confirmModal('Discard unsaved drawing changes to "' + profile.name + '"?', function () {
        closeOut(); cleanup(); go('library');
      }, { okLabel: 'Discard', danger: true });
      return;
    }
    closeOut(); cleanup(); go('library');
  }
  function saveAsNew() {
    if (draft) finishDraft();
    if (!polys.length) { toast('Drawing is empty — nothing to save.', true); return; }
    promptModal('Name for the new model', profile.name + ' (mod)', function (name) {
    if (!name.trim()) return;
    var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
    polys.forEach(function (p) { p.forEach(function (pt) {
      if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
      if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
    }); });
    var np = {
      id: uid(), name: name.trim(), kind: profile.kind, group: profile.group || '',
      polylines: JSON.parse(JSON.stringify(polys)),
      ox: Math.round(mnx * 100) / 100, oy: Math.round(mny * 100) / 100,
      width: Math.round((mxx - mnx) * 100) / 100, height: Math.round((mxy - mny) * 100) / 100,
      added: Date.now()
    };
    state.profiles.push(np);
    markDirty();
    saveNow();
    closeOut();
    cleanup();
    toast('Saved as "' + np.name + '" — base model untouched');
    go('library');
    });
  }
  function saveEdit() {
    if (draft) finishDraft();
    if (!polys.length) { toast('Drawing is empty — add some lines or cancel.', true); return; }
    // old center (for keeping placed trailers exactly where they are)
    var oldCx = (profile.ox || 0) + profile.width / 2;
    var oldCy = (profile.oy || 0) + profile.height / 2;
    var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
    polys.forEach(function (p) { p.forEach(function (pt) {
      if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
      if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
    }); });
    profile.polylines = polys;
    profile.ox = Math.round(mnx * 100) / 100;
    profile.oy = Math.round(mny * 100) / 100;
    profile.width = Math.round((mxx - mnx) * 100) / 100;
    profile.height = Math.round((mxy - mny) * 100) / 100;
    var dcx = (profile.ox + profile.width / 2) - oldCx;
    var dcy = (profile.oy + profile.height / 2) - oldCy;
    if (dcx || dcy) {
      state.loads.forEach(function (l) {
        l.placements.forEach(function (pl) {
          if (pl.profileId !== profile.id) return;
          var sx = pl.fh ? -1 : 1, sy = pl.fv ? -1 : 1;
          var a = (pl.rot || 0) * Math.PI / 180;
          var lx = dcx * sx, ly = dcy * sy;
          pl.cx = Math.round((pl.cx + lx * Math.cos(a) - ly * Math.sin(a)) * 100) / 100;
          pl.cy = Math.round((pl.cy + lx * Math.sin(a) + ly * Math.cos(a)) * 100) / 100;
        });
      });
    }
    delete pathCache[profile.id];
    hmCache = {};
    markDirty();
    saveNow();
    closeOut();
    cleanup();
    toast('Drawing saved to "' + profile.name + '"');
    go('library');
  }

  function resizeD() {
    var r = wrapEl.getBoundingClientRect();
    svgW = r.width; svgH = r.height;
    svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
    if (vp) { applyVP(); renderGeo(); }
  }
  window.addEventListener('resize', resizeD);
  window.__drawStash = function () {
    if (closedOut) return;
    drawCache[profile.id] = {
      polys: polys, undo: undoStack, redo: redoStack, dirty: drawDirty,
      vp: vp, selSet: selSet, selPivot: selPivot, measures: measures
    };
  };
  if (dCache && dCache.vp) vp = dCache.vp;
  resizeD();
  if (vp) { applyVP(); renderGeo(); renderPreview(null); } else fitDraw();
  syncBtns();
}

/* ---------- header wiring ---------- */
$('brandHome').addEventListener('click', function () { go('home'); });
$('btnLibrary').addEventListener('click', function () { go('library'); });
$('btnSave').addEventListener('click', function () { manualSave = true; saveNow(); });
if (!RS_STORAGE.mock) {
  var soBtn = h('button', { class: 'btn small ghost', title: 'Sign out', onclick: function () {
    RS_STORAGE.signOut().then(function () { location.reload(); });
  } }, ['Sign out']);
  document.querySelector('header.top').appendChild(soBtn);
}
$('btnPrint').addEventListener('click', doPrint);

boot();
})();
