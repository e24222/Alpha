/* 龍冶系統共用：Firebase 同步（匿名登入 + Firestore）
 *
 * 用法（每個頁面）：
 *   <script src="../shared/fbsync.js"></script>
 *   const h = Fb.map('集合名稱', {
 *     read:  () => ({ key: value, ... }),   // 把頁面目前的資料轉成 {文件ID: 內容}
 *     write: (map) => { ... },              // 雲端有變動時，把 {文件ID: 內容} 還原回頁面變數並存 localStorage（不要在這裡呼叫 push）
 *     onChange: () => { ... },              // write 之後重繪畫面
 *     where: () => [['ts','>=',毫秒]],      // （選用）只即時監聽符合條件的文件，省讀取
 *     extra: (key, value) => ({ ts: 數字 }) // （選用）額外存成可查詢的欄位
 *   });
 *   h.start();       // 頁面載入本機資料後呼叫一次
 *   h.push();        // 本機資料改動後呼叫（防抖 1.2 秒後自動上傳有變的那幾筆）
 *   await h.pushNow();  // 立刻上傳，回傳 true/false
 *
 * 規則：每筆資料一份文件 { data: JSON字串, updatedAt: 毫秒, ...extra }；同一筆以較新者為準；
 * 只上傳有變動的文件；第一次同步以雲端為準（與舊 Gist 行為一致）。
 */
(function () {
  'use strict';

  var CONFIG = {
    apiKey: 'AIzaSyA_Z9EBIaiFfatRv98MOK9AWXs4pgtWUNM',
    authDomain: 'alpha-f914f.firebaseapp.com',
    projectId: 'alpha-f914f',
    storageBucket: 'alpha-f914f.firebasestorage.app',
    messagingSenderId: '474296722006',
    appId: '1:474296722006:web:b5d470c6826227443591f7'
  };
  var BASE = 'https://www.gstatic.com/firebasejs/11.10.0/';

  var ctx = null;             // { db, fs, au, user }
  var initPromise = null;
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });
  var status = 'off';
  var statusCbs = [];

  function setStatus(s) {
    status = s;
    statusCbs.forEach(function (f) { try { f(s); } catch (e) { /* ignore */ } });
  }
  function delay(ms, v) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms); }); }
  function js(v) { return JSON.stringify(v); }
  // 文件 ID：直接用原字串（中文也可以）；只有 / 與 % 需要跳脫
  function enc(k) { return String(k).replace(/%/g, '%25').replace(/\//g, '%2F'); }
  function dec(id) { return id.replace(/%2F/g, '/').replace(/%25/g, '%'); }

  function init() {
    if (initPromise) return initPromise;
    initPromise = (async function () {
      try {
        setStatus('syncing');
        var m = await Promise.all([
          import(BASE + 'firebase-app.js'),
          import(BASE + 'firebase-auth.js'),
          import(BASE + 'firebase-firestore.js')
        ]);
        var app = m[0].initializeApp(CONFIG);
        var au = m[1].getAuth(app);
        ctx = { db: m[2].getFirestore(app), fs: m[2], au: au, user: null };
        await new Promise(function (res, rej) {
          var un;
          un = m[1].onAuthStateChanged(au, function (u) {
            if (u) { ctx.user = u; if (un) un(); res(); }
            else { m[1].signInAnonymously(au).catch(rej); }
          });
        });
        readyResolve(true);
        return true;
      } catch (e) {
        console.error('Firebase 初始化失敗', e);
        setStatus('err');
        readyResolve(false);
        return false;
      }
    })();
    return initPromise;
  }

  function map(name, opts) {
    var lsKey = 'fb2_' + name;
    var st = loadState();      // { TS:{key:ms}, SYNCED:{key:json}, init:bool }
    var LAST = {};             // 本機上次看到的 JSON，用來偵測哪幾筆被改
    var timer = null, unsub = null, started = false;
    var syncedResolve;
    var h = { synced: new Promise(function (r) { syncedResolve = r; }) };

    function loadState() {
      try {
        var o = JSON.parse(localStorage.getItem(lsKey) || 'null');
        if (o && o.TS && o.SYNCED) return o;
      } catch (e) { /* ignore */ }
      return { TS: {}, SYNCED: {}, init: false };
    }
    function persist() { try { localStorage.setItem(lsKey, JSON.stringify(st)); } catch (e) { /* ignore */ } }
    function cur() { return opts.read() || {}; }
    function ref(k) { return ctx.fs.doc(ctx.db, name, enc(k)); }

    function stamp(local) {
      var now = Date.now();
      Object.keys(local).forEach(function (k) {
        var j = js(local[k]);
        if (j !== LAST[k]) { LAST[k] = j; st.TS[k] = now; }
      });
      Object.keys(LAST).forEach(function (k) { if (!(k in local)) delete LAST[k]; });
    }

    async function flush() {
      if (!started) return false;
      var local = cur();
      stamp(local);
      persist();
      // 第一次與雲端對過之前不上傳，避免用舊資料蓋掉雲端
      if (!ctx || !ctx.user || !st.init) return false;
      var dirty = Object.keys(local).filter(function (k) { return js(local[k]) !== st.SYNCED[k]; });
      var dels = Object.keys(st.SYNCED).filter(function (k) { return !(k in local); });
      if (!dirty.length && !dels.length) return true;
      setStatus('syncing');
      try {
        var jobs = dirty.map(function (k) {
          var j = js(local[k]);
          var f = { data: j, updatedAt: st.TS[k] || 1 };
          if (opts.extra) { var e = opts.extra(k, local[k]) || {}; for (var x in e) f[x] = e[x]; }
          return ctx.fs.setDoc(ref(k), f).then(function () { st.SYNCED[k] = j; });
        }).concat(dels.map(function (k) {
          return ctx.fs.deleteDoc(ref(k)).then(function () { delete st.SYNCED[k]; delete st.TS[k]; });
        }));
        await Promise.all(jobs);
        persist();
        setStatus('ok');
        return true;
      } catch (e) {
        console.error('同步失敗', e);
        setStatus('err');
        return false;
      }
    }

    function parse(d) {
      var f = d.data();
      if (!f || typeof f.data !== 'string') return null;
      try { return { v: JSON.parse(f.data), ts: f.updatedAt || 0 }; } catch (e) { return null; }
    }

    function apply(next) {
      opts.write(next);
      var cm = cur();
      LAST = {};
      Object.keys(cm).forEach(function (k) { LAST[k] = js(cm[k]); });
      persist();
      if (opts.onChange) opts.onChange();
    }

    function onSnap(snap) {
      var local = cur();
      if (!st.init) {
        if (snap.empty) {
          if (snap.metadata.fromCache) return;
          // 雲端真的是空的：把本機現有資料當成初始資料上傳
          st.init = true;
          Object.keys(local).forEach(function (k) { st.TS[k] = st.TS[k] || 1; });
          persist();
          syncedResolve(true);
          flush();
          setStatus('ok');
          return;
        }
        // 第一次：以雲端為準
        var first = {};
        st.SYNCED = {}; st.TS = {};
        snap.docs.forEach(function (d) {
          var p = parse(d); if (!p) return;
          var k = dec(d.id);
          first[k] = p.v; st.SYNCED[k] = js(p.v); st.TS[k] = p.ts;
        });
        st.init = true;
        apply(first);
        syncedResolve(true);
        setStatus('ok');
        return;
      }
      var next = Object.assign({}, local);
      var changed = false;
      snap.docChanges().forEach(function (c) {
        var d = c.doc, k = dec(d.id);
        if (c.type === 'removed') {
          // 別人刪掉的：本機沒有未上傳的修改才跟著刪；有修改就保留，之後會重新上傳
          if (k in next && js(local[k]) === st.SYNCED[k]) { delete next[k]; delete LAST[k]; changed = true; }
          delete st.SYNCED[k]; delete st.TS[k];
          return;
        }
        if (d.metadata.hasPendingWrites) return;   // 自己剛寫的
        var p = parse(d); if (!p) return;
        if (p.ts > (st.TS[k] || 0)) {
          next[k] = p.v; st.SYNCED[k] = js(p.v); st.TS[k] = p.ts; LAST[k] = js(p.v); changed = true;
        } else if (js(local[k]) === js(p.v)) {
          st.SYNCED[k] = js(p.v);
        }
      });
      if (changed) apply(next); else persist();
      flush();
      setStatus('ok');
    }

    function subscribe() {
      if (unsub) { unsub(); unsub = null; }
      var col = ctx.fs.collection(ctx.db, name);
      var q = col;
      if (opts.where) {
        var conds = opts.where().map(function (c) { return ctx.fs.where(c[0], c[1], c[2]); });
        q = ctx.fs.query.apply(null, [col].concat(conds));
      }
      unsub = ctx.fs.onSnapshot(q, onSnap, function (e) { console.error(e); setStatus('err'); });
    }

    h.start = function () {
      started = true;
      var cm = cur();
      LAST = {};
      Object.keys(cm).forEach(function (k) { LAST[k] = js(cm[k]); });
      init().then(function (ok) { if (ok) subscribe(); });
    };
    h.push = function (ms) {
      clearTimeout(timer);
      timer = setTimeout(flush, ms == null ? 1200 : ms);
    };
    h.pushNow = function () {
      clearTimeout(timer);
      return Promise.race([h.synced.then(flush), delay(8000, false)]);
    };
    // where 條件（例如時間範圍）改變後，重新監聽
    h.resubscribe = function () { if (ctx && ctx.user && started) subscribe(); };
    // 清空整個集合（含 where 範圍以外的舊資料）
    h.wipeAll = async function () {
      await ready;
      if (!ctx) throw new Error('尚未連線');
      var snap = await ctx.fs.getDocs(ctx.fs.collection(ctx.db, name));
      await Promise.all(snap.docs.map(function (d) { return ctx.fs.deleteDoc(d.ref); }));
    };
    return h;
  }

  window.Fb = {
    map: map,
    init: init,
    ready: ready,
    ctx: function () { return ctx; },
    status: function () { return status; },
    setStatus: setStatus,
    onStatus: function (f) { statusCbs.push(f); f(status); }
  };
})();
