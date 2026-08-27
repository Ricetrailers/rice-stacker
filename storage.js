/* Rice Stacker — Supabase storage adapter.
   The app keeps working exactly as before; this file owns login, loading,
   per-row diff saves (no whole-file clobbering between users), and photos.
   With no config.js filled in, it falls back to an in-memory mock so the UI
   can be developed and tested offline. */
(function (global) {
  'use strict';

  var cfg = global.RS_CONFIG || {};
  var hasSupabase = typeof global.supabase !== 'undefined' &&
    cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1;

  /* ---------------- mock (offline/dev) ---------------- */
  function mockAdapter() {
    var mem = { profiles: {}, loads: {}, folders: [], settings: {}, photos: {} };
    return {
      mock: true,
      init: function () { return Promise.resolve({ user: { email: 'dev@local' } }); },
      signIn: function () { return Promise.resolve({}); },
      signOut: function () { return Promise.resolve(); },
      loadAll: function () {
        return Promise.resolve({
          profiles: Object.values(mem.profiles),
          loads: Object.values(mem.loads),
          folders: mem.folders.slice(),
          settings: JSON.parse(JSON.stringify(mem.settings))
        });
      },
      saveDiff: function (diff) {
        diff.profiles.upsert.forEach(function (p) { mem.profiles[p.id] = JSON.parse(JSON.stringify(p)); });
        diff.profiles.remove.forEach(function (id) { delete mem.profiles[id]; });
        diff.loads.upsert.forEach(function (l) { mem.loads[l.id] = JSON.parse(JSON.stringify(l)); });
        diff.loads.remove.forEach(function (id) { delete mem.loads[id]; });
        if (diff.folders) mem.folders = diff.folders.slice();
        Object.keys(diff.settings || {}).forEach(function (k) { mem.settings[k] = diff.settings[k]; });
        return Promise.resolve({ ok: true });
      },
      uploadPhoto: function (path, blob) { mem.photos[path] = blob; return Promise.resolve({ path: path }); },
      photoUrl: function (path) {
        if (mem.photos[path]) return Promise.resolve(URL.createObjectURL(mem.photos[path]));
        return Promise.resolve(null);
      },
      deletePhoto: function (path) { delete mem.photos[path]; return Promise.resolve(); }
    };
  }

  /* ---------------- supabase ---------------- */
  function supabaseAdapter() {
    var sb = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    var bucket = cfg.PHOTO_BUCKET || 'load-photos';
    var urlCache = {};   // storage path -> signed url

    function rowToProfile(r) {
      return { id: r.id, name: r.name, kind: r.kind, group: r.grp, width: r.width, height: r.height,
               ox: r.ox, oy: r.oy, polylines: r.polylines, added: Number(r.added) || 0 };
    }
    function profileToRow(p) {
      return { id: p.id, name: p.name, kind: p.kind || 'trailer', grp: p.group || '',
               width: p.width, height: p.height, ox: p.ox || 0, oy: p.oy || 0,
               polylines: p.polylines, added: p.added || 0, updated_at: new Date().toISOString() };
    }
    function rowToLoad(r) {
      return { id: r.id, loadNo: r.load_no, customer: r.customer, date: r.ship_date, notes: r.notes,
               placements: r.placements || [], photos: r.photos || [], tires: r.tires || [],
               created: Number(r.created) || 0, updated: Number(r.updated) || 0, version: r.version || 0 };
    }
    function loadToRow(l) {
      return { id: l.id, load_no: l.loadNo || '', customer: l.customer || '', ship_date: l.date || '',
               notes: l.notes || '', placements: l.placements || [], photos: l.photos || [], tires: l.tires || [],
               created: l.created || 0, updated: l.updated || 0, version: (l.version || 0) + 1,
               updated_at: new Date().toISOString() };
    }

    return {
      mock: false,
      init: function () {
        return sb.auth.getSession().then(function (res) {
          return { user: res.data.session ? res.data.session.user : null };
        });
      },
      signIn: function (email, password) {
        return sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
      },
      signOut: function () { return sb.auth.signOut(); },
      loadAll: function () {
        return Promise.all([
          sb.from('rs_profiles').select('*'),
          sb.from('rs_loads').select('*'),
          sb.from('rs_folders').select('path'),
          sb.from('rs_settings').select('*')
        ]).then(function (r) {
          var err = r.find(function (x) { return x.error; });
          if (err) throw err.error;
          var settings = {};
          (r[3].data || []).forEach(function (row) { settings[row.key] = row.value; });
          return {
            profiles: (r[0].data || []).map(rowToProfile),
            loads: (r[1].data || []).map(rowToLoad),
            folders: (r[2].data || []).map(function (row) { return row.path; }),
            settings: settings
          };
        });
      },
      saveDiff: function (diff) {
        var ops = [];
        if (diff.profiles.upsert.length) ops.push(sb.from('rs_profiles').upsert(diff.profiles.upsert.map(profileToRow)));
        if (diff.profiles.remove.length) ops.push(sb.from('rs_profiles').delete().in('id', diff.profiles.remove));
        diff.loads.upsert.forEach(function (l) {
          ops.push(sb.from('rs_loads').upsert(loadToRow(l)).then(function (res) {
            if (!res.error) l.version = (l.version || 0) + 1;
            return res;
          }));
        });
        if (diff.loads.remove.length) ops.push(sb.from('rs_loads').delete().in('id', diff.loads.remove));
        if (diff.folders) {
          ops.push(sb.from('rs_folders').delete().neq('path', '').then(function () {
            if (!diff.folders.length) return { error: null };
            return sb.from('rs_folders').insert(diff.folders.map(function (p) { return { path: p }; }));
          }));
        }
        Object.keys(diff.settings || {}).forEach(function (k) {
          ops.push(sb.from('rs_settings').upsert({ key: k, value: diff.settings[k] }));
        });
        return Promise.all(ops).then(function (results) {
          var err = results.find(function (x) { return x && x.error; });
          if (err) throw err.error;
          return { ok: true };
        });
      },
      uploadPhoto: function (path, blob) {
        return sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
          .then(function (res) {
            if (res.error) throw res.error;
            return { path: path };
          });
      },
      photoUrl: function (path) {
        if (urlCache[path]) return Promise.resolve(urlCache[path]);
        return sb.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24).then(function (res) {
          if (res.error || !res.data) return null;
          urlCache[path] = res.data.signedUrl;
          return urlCache[path];
        });
      },
      deletePhoto: function (path) {
        delete urlCache[path];
        return sb.storage.from(bucket).remove([path]);
      }
    };
  }

  global.RS_STORAGE = hasSupabase ? supabaseAdapter() : mockAdapter();
})(window);
