/* Rice Stacker — Supabase storage adapter.
   The app keeps working exactly as before; this file owns login, loading,
   per-row diff saves (no whole-file clobbering between users), and photos.
   With no config.js filled in, it falls back to an in-memory mock so the UI
   can be developed and tested offline. */
(function (global) {
  'use strict';

  var cfg = global.RS_CONFIG || {};
  var hasSupabase = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1;
  if (hasSupabase && typeof global.supabase === 'undefined') {
    document.body.textContent='Unable to load the sign-in service. Check your connection and reload.';
    throw new Error('Sign-in service unavailable');
  }

  /* ---------------- mock (offline/dev) ---------------- */
  function mockAdapter() {
    var mem = { profiles: {}, loads: {}, folders: [], settings: {}, photos: {} };
    return {
      mock: true,
      listMembers: function(){return Promise.resolve([{user_id:'demo-admin',email:'dev@local',role:'admin',active:true}]);},
      setMember: function(){return Promise.reject(new Error('Demo only. Team access changes require the live app.'));},
      inviteMember: function(){return Promise.reject(new Error('Demo only. No email was sent.'));},
      createMember: function(){return Promise.reject(new Error('Preview only. No account was created.'));},
      setMemberPassword: function(){return Promise.reject(new Error('Preview only. No password was changed.'));},
      erpLoads: function(){return Promise.resolve(JSON.parse(JSON.stringify(global.RS_MOCK_ERP||[])));},
      erpSync: function(){return Promise.resolve({fresh:true});},
      erpLoad: function(no){var r=(global.RS_MOCK_ERP||[]).filter(function(x){return x.load_no===no;})[0];return Promise.resolve(r?{found:true,row:r}:{found:false});},
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
      uploadPhoto: function (path, blob, contentType) { mem.photos[path] = blob; return Promise.resolve({ path: path }); },
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
    var role = null;
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
      return { id: r.id, loadNo: r.load_no, customer: r.customer, address: r.address || '', date: r.ship_date, notes: r.notes,
               status: r.status || 'prep', prepped: !!r.prepped, type: r.ltype || 'stack', custPickup: !!r.cust_pickup,
               prepDate: r.prep_date || '', prepTime: r.prep_time || '', stackDate: r.stack_date || '', stackTime: r.stack_time || '', truckCo: r.truck_co || '', truckDate: r.truck_date || '', truckTime: r.truck_time || '',
               partsLocation:r.parts_location || '', stackMeta: r.stack_meta || {}, ship: r.ship || {}, placements: r.placements || [], photos: r.photos || [], tires: r.tires || [], items: r.items || [], docs: r.docs || [],
               created: Number(r.created) || 0, updated: Number(r.updated) || 0, version: r.version || 0 };
    }
    function loadToRow(l) {
      return { id: l.id, load_no: l.loadNo || '', customer: l.customer || '', address: l.address || '', ship_date: l.date || '',
               status: l.status || 'prep', prepped: !!l.prepped, ltype: l.type || 'stack', cust_pickup: !!l.custPickup,
               prep_date: l.prepDate || '', prep_time: l.prepTime || '', stack_date: l.stackDate || '', stack_time: l.stackTime || '', truck_co: l.truckCo || '', truck_date: l.truckDate || '', truck_time: l.truckTime || '',
               parts_location:l.partsLocation || '', stack_meta: l.stackMeta || {}, ship: l.ship || {}, notes: l.notes || '', placements: l.placements || [], photos: l.photos || [], tires: l.tires || [], items: l.items || [], docs: l.docs || [],
               created: l.created || 0, updated: l.updated || 0, version: (l.version || 0) + 1,
               updated_at: new Date().toISOString() };
    }

    function teamRequest(body){return sb.functions.invoke('rice-team',{body:body}).then(async function(r){
        var detail=r.data;
        if(r.error && r.error.context && typeof r.error.context.json==='function'){
          try{detail=await r.error.context.json();}catch(ignore){}
        }
        var message=detail&&(detail.error||detail.message);
        if(r.error||message){
          message=message||(r.error&&r.error.message)||'Invitation could not be sent.';
          if(/email.*rate.*limit|over_email_send_rate_limit/i.test(message))message='Invitation not sent: the email service has reached its sending limit. Wait about an hour before retrying. The owner needs to configure a production email sender for team invitations.';
          throw new Error(message);
        }
        return r.data;
      });}

    return {
      mock: false,
      /* ERP (Metasystems) load list. rs_erp_loads is filled by the erp-load function; the app only reads it. */
      erpLoads: function(){return sb.from('rs_erp_loads').select('*').then(function(r){if(r.error)throw r.error;return r.data||[];});},
      erpSync: function(force){return sb.functions.invoke('erp-load',{body:{sync:true,force:!!force}}).then(function(r){if(r.error)throw r.error;return r.data||{};});},
      erpLoad: function(no){return sb.functions.invoke('erp-load',{body:{load_no:String(no)}}).then(function(r){if(r.error)throw r.error;return r.data||{};});},
      tourStatus:function(){return sb.rpc('rs_tour_status').then(function(r){if(r.error)throw r.error;return r.data;});},
      completeTour:function(){return sb.rpc('rs_complete_tour').then(function(r){if(r.error)throw r.error;});},
      listMembers: function(){return teamRequest({action:'list'}).then(function(r){return r.members;});},
      setMember: function(id,role,enabled){return sb.rpc('rs_set_member',{target:id,member_role:role,enabled:enabled}).then(function(r){if(r.error)throw r.error;});},
      inviteMember: function(email,role){return teamRequest({action:'invite',email:email,role:role});},
      createMember: function(name,email,role,password,username){return teamRequest({action:'create',name:name,email:email,role:role,password:password,username:username});},
      setMemberPassword: function(id,password){return teamRequest({action:'password',user_id:id,password:password});},
      resetPassword: function(email){if(!email.includes('@')||email.toLowerCase().endsWith('@users.rice-stacker.invalid'))return Promise.reject(new Error('For username accounts, ask your admin to set a new password in Manage team.'));return sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/?setup=1'}).then(function(r){if(r.error)throw r.error;});},
      setPassword: function(password){return sb.auth.updateUser({password:password}).then(function(r){if(r.error)throw r.error;});},
      init: function () {
        return sb.auth.getSession().then(function (res) {
          RS_STORAGE.passwordSetup = /(?:type=recovery|type=invite)/.test(location.hash) || new URLSearchParams(location.search).get('setup')==='1';
          return { user: res.data.session ? res.data.session.user : null };
        });
      },
      signIn: function (email, password) {
        email=String(email||'').trim().toLowerCase();
        if(email.indexOf('@')<0){if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(email))return Promise.reject(new Error('Enter a valid email or username.'));email+='@users.rice-stacker.invalid';}
        return sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
      },
      signOut: function () { return sb.auth.signOut(); },
      loadAll: function () {
        return sb.rpc('rs_role').then(function(r){ if(r.error)throw r.error;if(!r.data)throw new Error('Your account has no active access. Contact an admin.');role=r.data;RS_STORAGE.role=role;return Promise.all([
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
        }); });
      },
      saveDiff: function (diff) {
        var ops = [];
        if (diff.profiles.upsert.length) ops.push(sb.from('rs_profiles').upsert(diff.profiles.upsert.map(profileToRow)));
        if (diff.profiles.remove.length) ops.push(sb.from('rs_profiles').delete().in('id', diff.profiles.remove));
        diff.loads.upsert.forEach(function (l) {
          // Yard accounts save through two narrow doors: the prep fields, then the ship-out record.
          ops.push((role==='yard'?sb.rpc('rs_yard_update',{load_id:l.id,tire_rows:l.tires||[],photo_rows:l.photos||[],parts_location_value:l.partsLocation||'',prep_done:!!l.prepped}).then(function(res){
            if(res.error||!l.ship||!Object.keys(l.ship).length)return res;
            return sb.rpc('rs_yard_ship',{load_id:l.id,ship_record:l.ship,shipped:!!l.ship.shippedAt});
          }):sb.from('rs_loads').upsert(loadToRow(l))).then(function (res) {
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
        Object.keys(diff.settings || {}).filter(function(k){return k!=='roles';}).forEach(function (k) {
          ops.push(sb.from('rs_settings').upsert({ key: k, value: diff.settings[k] }));
        });
        return Promise.all(ops).then(function (results) {
          var err = results.find(function (x) { return x && x.error; });
          if (err) throw err.error;
          return { ok: true };
        });
      },
      uploadPhoto: function (path, blob, contentType) {
        return sb.storage.from(bucket).upload(path, blob, { contentType: contentType || 'image/jpeg', upsert: false })
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
