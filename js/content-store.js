/* ============================================================
   内容数据小仓库（内容管理页 editor.html 与前台页面共用）
   ------------------------------------------------------------
   原理：在“管理内容”页面里做的修改会先存到浏览器 localStorage，
   前台页面打开时优先读取它；点“导出永久文件”后下载的 js 文件
   才是可以拷走 / 部署 / 换电脑使用的最终版本。
   一般不需要修改本文件。
   ============================================================ */
var ANFU_STORE = (function () {
  'use strict';

  var KEY_WORKS = 'anfu.works.v1';
  var KEY_PROFILE = 'anfu.profile.v1';

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // 返回 {ok:true} 或 {ok:false,error}（存超大图时可能超出浏览器容量）
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  // 递归合并：localStorage 里只存被改过的内容，其余沿用 js 文件里的默认值
  function deepMerge(base, over) {
    if (over == null) return base;
    if (Array.isArray(base) || Array.isArray(over)) return over;
    if (typeof base !== 'object' || base === null) return over;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over).forEach(function (k) {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }

  // 前台使用的作品列表：优先本地编辑版，否则用 works-data.js
  function loadWorks() {
    var saved = read(KEY_WORKS);
    var list = (saved && saved.length) ? saved : (window.WORKS || []);
    return list.map(function (w) {
      // 新上传的图存在 _data 里（dataURL），展示时优先用它
      return {
        id: w.id,
        type: w.type || 'image',
        category: w.category || 'illustration',
        title: w.title || '',
        src: w.src || '',
        poster: w.poster || '',
        desc: w.desc || '',
        _data: w._data || '',
        _posterData: w._posterData || ''
      };
    });
  }

  // 前台使用的文字内容：默认值 + 本地编辑覆盖
  function loadProfile() {
    return deepMerge(window.PROFILE || {}, read(KEY_PROFILE) || {});
  }

  function saveWorks(list) { return write(KEY_WORKS, list); }
  function saveProfile(p) { return write(KEY_PROFILE, p); }
  function resetWorks() { remove(KEY_WORKS); }
  function resetProfile() { remove(KEY_PROFILE); }
  function worksEdited() { return read(KEY_WORKS) !== null; }
  function profileEdited() { return read(KEY_PROFILE) !== null; }

  // 触发浏览器下载一个文本文件
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    triggerDownload(URL.createObjectURL(blob), filename);
  }

  // 触发浏览器下载一个 dataURL 图片
  function downloadDataURL(dataURL, filename) {
    triggerDownload(dataURL, filename);
  }

  function triggerDownload(href, filename) {
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return {
    loadWorks: loadWorks,
    loadProfile: loadProfile,
    saveWorks: saveWorks,
    saveProfile: saveProfile,
    resetWorks: resetWorks,
    resetProfile: resetProfile,
    worksEdited: worksEdited,
    profileEdited: profileEdited,
    downloadText: downloadText,
    downloadDataURL: downloadDataURL
  };
})();
