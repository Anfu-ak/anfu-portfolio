/* ============================================================
   「管理内容」页面逻辑（editor.html 专用）
   ------------------------------------------------------------
   功能：作品增删改 / 图片压缩导入 / 全站文字编辑 / 技能编辑
        自动保存到浏览器 localStorage / 导出永久 js 文件与图片
   零依赖，纯原生 JS。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function deepGet(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function deepSet(obj, path, val) {
    var keys = path.split('.');
    for (var i = 0; i < keys.length - 1; i++) {
      if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = val;
  }

  function basename(p) {
    var m = String(p || '').split('/').pop();
    return m;
  }

  // 文件名安全化（中文也保留，只去掉不适合做文件名的字符）
  function safeName(name) {
    var base = String(name || '').replace(/\.[^.]+$/, '').trim();
    base = base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base) base = 'work-' + Date.now();
    return base + '.png';
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- 状态 ---------- */
  var state = {
    works: ANFU_STORE.loadWorks(),         // 当前作品（含新图 dataURL）
    profile: ANFU_STORE.loadProfile()     // 当前全部文字（默认值 + 已保存修改）
  };
  var uid = Date.now();

  /* ---------- 轻提示 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2200);
  }

  /* ---------- 自动保存 ---------- */
  var workSaveTimer = null, profileSaveTimer = null;

  function saveNow(silent) {
    var r = ANFU_STORE.saveWorks(state.works);
    if (!r.ok) {
      toast('保存失败：浏览器存储空间不够了，请先导出图片后删掉几张大图再试');
      return;
    }
    if (!silent) {
      var d = new Date();
      var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
      $('#saveStatus').textContent = '✓ 已自动保存 ' + t;
    }
    renderExportStatus();
  }
  function scheduleWorkSave() {
    clearTimeout(workSaveTimer);
    workSaveTimer = setTimeout(function () { saveNow(); }, 400);
  }

  function saveProfileNow(silent) {
    var r = ANFU_STORE.saveProfile(state.profile);
    if (!r.ok) { toast('文字保存失败：' + r.error); return; }
    if (!silent) toast('✓ 文字已保存，刷新前台页面即可看到');
    renderExportStatus();
  }
  function scheduleProfileSave() {
    clearTimeout(profileSaveTimer);
    profileSaveTimer = setTimeout(function () { saveProfileNow(true); }, 300);
  }

  /* ---------- 标签页切换 ---------- */
  $all('.ed-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $all('.ed-tab').forEach(function (b) { b.classList.remove('is-active'); });
      $all('.ed-panel').forEach(function (p) { p.hidden = true; p.classList.remove('is-active'); });
      btn.classList.add('is-active');
      var panel = $('#panel-' + btn.dataset.tab);
      panel.hidden = false;
      panel.classList.add('is-active');
      if (btn.dataset.tab === 'export') renderExportStatus();
    });
  });

  /* ============================================================
     作品管理
     ============================================================ */
  function existingSrcs() {
    var set = {};
    (window.WORKS || []).forEach(function (w) {
      if (w.src) set[w.src] = 1;
      if (w.poster) set[w.poster] = 1;
    });
    state.works.forEach(function (w) {
      if (w.src && !w._data) set[w.src] = 1;
      if (w.poster && !w._posterData) set[w.poster] = 1;
    });
    return Object.keys(set).sort();
  }

  function renderWorks() {
    var list = $('#workEditorList');
    $('#workEmptyTip').hidden = state.works.length > 0;

    list.innerHTML = state.works.map(function (w, i) {
      var thumb = w._posterData || w._data || w.poster || w.src;
      var srcs = existingSrcs();

      var imageBlock = w.type === 'video'
        ? '<label class="ed-field ed-full"><span>视频文件路径（把 mp4 放进 assets/videos/ 后填写）</span>'
          + '<input type="text" data-action="field" data-id="' + w.id + '" data-field="src" value="' + esc(w.src) + '" placeholder="assets/videos/my-video.mp4"></label>'
          + '<div class="ed-field ed-full"><span>视频封面（PNG，可选）</span>'
          + posterControl(w, srcs) + '</div>'
        : '<div class="ed-field ed-full"><span>作品图片（PNG，建议长边不超过 2000px；大图会自动压缩）</span>'
          + imageControl(w, srcs) + '</div>';

      return '<div class="ed-work" data-id="' + w.id + '">'
        + '<div class="ed-work-thumb">'
        + (thumb ? '<img src="' + esc(thumb) + '" alt="预览">' : '<div class="ed-noimg">🖼️<br>暂无图片</div>')
        + '</div>'
        + '<div class="ed-work-fields">'
        + '<div class="ed-row-grid">'
        + '<label class="ed-field"><span>标题</span>'
        + '<input type="text" data-action="field" data-id="' + w.id + '" data-field="title" value="' + esc(w.title) + '" placeholder="给作品起个名字"></label>'
        + '<label class="ed-field"><span>类型</span>'
        + '<select data-action="type" data-id="' + w.id + '">'
        + '<option value="image"' + (w.type === 'image' ? ' selected' : '') + '>插画作品</option>'
        + '<option value="video"' + (w.type === 'video' ? ' selected' : '') + '>短视频</option>'
        + '</select></label>'
        + '<div class="ed-orderbtns">'
        + '<button type="button" class="btn btn-sm" data-action="up" data-id="' + w.id + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" class="btn btn-sm" data-action="down" data-id="' + w.id + '"' + (i === state.works.length - 1 ? ' disabled' : '') + '>↓</button>'
        + '<button type="button" class="btn btn-sm ed-danger" data-action="del" data-id="' + w.id + '">删除</button>'
        + '</div></div>'
        + '<label class="ed-field ed-full"><span>一句话介绍（可留空）</span>'
        + '<textarea rows="2" data-action="field" data-id="' + w.id + '" data-field="desc" placeholder="写点什么……">' + esc(w.desc) + '</textarea></label>'
        + imageBlock
        + '</div></div>';
    }).join('');
  }

  // 图片选择控件（上传新图 / 选用已有图）
  function imageControl(w, srcs) {
    var html = '<div class="ed-imgctrl">'
      + '<label class="btn btn-blue btn-sm ed-filebtn">📁 选择 PNG 图片'
      + '<input type="file" accept="image/png,image/*" data-action="uploadImage" data-id="' + w.id + '" hidden></label>'
      + existingSelect(w, srcs, false)
      + '</div>';
    if (w._data) {
      html += '<div class="ed-newfile">🆕 新图片将保存为：<b>assets/works/' + esc(basename(w.src)) + '</b>'
        + ' <label class="ed-inline">改名：<input type="text" class="ed-fname" data-action="renameImage" data-id="' + w.id + '" value="' + esc(basename(w.src)) + '"></label>'
        + ' <button type="button" class="btn btn-sm" data-action="removeImage" data-id="' + w.id + '">撤销新图</button></div>';
    } else if (w.src) {
      html += '<div class="ed-newfile ed-muted">当前图片：' + esc(w.src) + '</div>';
    }
    return html;
  }

  function posterControl(w, srcs) {
    var html = '<div class="ed-imgctrl">'
      + '<label class="btn btn-blue btn-sm ed-filebtn">📁 选择封面 PNG'
      + '<input type="file" accept="image/png,image/*" data-action="uploadPoster" data-id="' + w.id + '" hidden></label>'
      + existingSelect(w, srcs, true)
      + '</div>';
    if (w._posterData) {
      html += '<div class="ed-newfile">🆕 新封面将保存为：<b>assets/works/' + esc(basename(w.poster)) + '</b>'
        + ' <label class="ed-inline">改名：<input type="text" class="ed-fname" data-action="renamePoster" data-id="' + w.id + '" value="' + esc(basename(w.poster)) + '"></label>'
        + ' <button type="button" class="btn btn-sm" data-action="removePoster" data-id="' + w.id + '">撤销新封面</button></div>';
    } else if (w.poster) {
      html += '<div class="ed-newfile ed-muted">当前封面：' + esc(w.poster) + '</div>';
    }
    return html;
  }

  function existingSelect(w, srcs, isPoster) {
    var cur = isPoster ? w.poster : w.src;
    var action = isPoster ? 'pickPoster' : 'pickImage';
    var html = '<label class="ed-inline ed-existing">或选用已有图：'
      + '<select data-action="' + action + '" data-id="' + w.id + '"><option value="">— 请选择 —</option>';
    srcs.forEach(function (s) {
      html += '<option value="' + esc(s) + '"' + (s === cur ? ' selected' : '') + '>' + esc(basename(s)) + '</option>';
    });
    return html + '</select></label>';
  }

  function findWork(id) {
    id = Number(id);
    for (var i = 0; i < state.works.length; i++) if (state.works[i].id === id) return state.works[i];
    return null;
  }

  // 读取图片文件 → 压缩 → PNG dataURL
  function readImageFile(file, maxEdge, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (Math.max(w, h) > maxEdge) {
          var k = maxEdge / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try {
          cb(canvas.toDataURL('image/png'));
        } catch (e) {
          toast('图片处理失败：' + e);
        }
      };
      img.onerror = function () { toast('图片读取失败，请换一张试试'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // 作品列表事件委托
  $('#workEditorList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action, w = findWork(btn.dataset.id);
    if (!w && ['del', 'up', 'down'].indexOf(action) >= 0) return;

    if (action === 'del') {
      if (!confirm('确定删除「' + (w.title || '未命名作品') + '」吗？')) return;
      state.works = state.works.filter(function (x) { return x.id !== w.id; });
      saveNow(); renderWorks(); toast('已删除');
    } else if (action === 'up' || action === 'down') {
      var i = state.works.indexOf(w);
      var j = action === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= state.works.length) return;
      var t = state.works[i]; state.works[i] = state.works[j]; state.works[j] = t;
      saveNow(); renderWorks();
    } else if (action === 'removeImage') {
      w._data = ''; w.src = ''; saveNow(); renderWorks();
    } else if (action === 'removePoster') {
      w._posterData = ''; w.poster = ''; saveNow(); renderWorks();
    }
  });

  $('#workEditorList').addEventListener('change', function (e) {
    var el = e.target;
    var action = el.dataset.action;
    if (!action) return;
    var w = findWork(el.dataset.id);
    if (!w) return;

    if (action === 'field') {
      w[el.dataset.field] = el.value;
      scheduleWorkSave();
    } else if (action === 'type') {
      w.type = el.value;
      w.category = el.value === 'video' ? 'video' : 'illustration';
      scheduleWorkSave(); renderWorks();
    } else if (action === 'pickImage') {
      w._data = ''; w.src = el.value; saveNow(); renderWorks();
    } else if (action === 'pickPoster') {
      w._posterData = ''; w.poster = el.value; saveNow(); renderWorks();
    } else if (action === 'uploadImage' && el.files && el.files[0]) {
      var file = el.files[0];
      var name = safeName(file.name);
      readImageFile(file, 1600, function (data) {
        w._data = data; w.src = 'assets/works/' + name;
        saveNow(); renderWorks(); toast('✓ 图片已导入，记得在「导出与保存」里下载备份');
      });
    } else if (action === 'uploadPoster' && el.files && el.files[0]) {
      var f2 = el.files[0];
      var name2 = safeName(f2.name).replace(/\.png$/, '-poster.png');
      readImageFile(f2, 1280, function (data) {
        w._posterData = data; w.poster = 'assets/works/' + name2;
        saveNow(); renderWorks(); toast('✓ 封面已导入');
      });
    }
  });

  // 标题/介绍等输入（不等 change，边打边存）
  $('#workEditorList').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.action !== 'field') return;
    var w = findWork(el.dataset.id);
    if (w) { w[el.dataset.field] = el.value; scheduleWorkSave(); }
  });

  // 改新图片的目标文件名
  $('#workEditorList').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.action === 'renameImage') {
      var w = findWork(el.dataset.id);
      if (w) w.src = 'assets/works/' + safeName(el.value);
      scheduleWorkSave();
    } else if (el.dataset.action === 'renamePoster') {
      var w2 = findWork(el.dataset.id);
      if (w2) w2.poster = 'assets/works/' + safeName(el.value).replace(/\.png$/, '-poster.png');
      scheduleWorkSave();
    }
  });

  // 添加作品
  function addWork(type) {
    var w = {
      id: uid++,
      type: type,
      category: type === 'video' ? 'video' : 'illustration',
      title: type === 'video' ? '我的短视频' : '新作品',
      src: type === 'video' ? 'assets/videos/my-video.mp4' : '',
      poster: '',
      desc: '',
      _data: '',
      _posterData: ''
    };
    state.works.push(w);
    saveNow(); renderWorks();
    var card = $('.ed-work[data-id="' + w.id + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(type === 'video' ? '已添加短视频，记得上传封面 PNG 并填好视频路径' : '已添加新作品，给它选张 PNG 图片吧');
  }
  $('#btnAddImage').addEventListener('click', function () { addWork('image'); });
  $('#btnAddVideo').addEventListener('click', function () { addWork('video'); });

  /* ============================================================
     个人文字编辑
     ============================================================ */
  function fillProfileForm() {
    $all('[data-profile]').forEach(function (el) {
      var v = deepGet(state.profile, el.dataset.profile);
      el.value = v == null ? '' : v;
    });
    renderSkills();
  }

  $('#panel-text').addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset.profile) return;
    deepSet(state.profile, el.dataset.profile, el.value);
    scheduleProfileSave();
  });
  $('#panel-text').addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset.profile) {
      deepSet(state.profile, el.dataset.profile, el.value);
      scheduleProfileSave();
    }
  });

  /* ---------- 技能编辑 ---------- */
  function renderSkills() {
    var box = $('#skillEditorList');
    box.innerHTML = state.profile.skills.map(function (s, i) {
      return '<div class="ed-skillrow">'
        + '<input type="text" value="' + esc(s.name) + '" data-skill="name" data-idx="' + i + '" placeholder="软件名">'
        + '<input type="text" value="' + esc(s.sub || '') + '" data-skill="sub" data-idx="' + i + '" placeholder="小字（可空）">'
        + '<select data-skill="badge" data-idx="' + i + '">'
        + '<option value=""' + (!s.badge ? ' selected' : '') + '>无角标</option>'
        + '<option value="love"' + (s.badge === 'love' ? ' selected' : '') + '>♡ 本命</option>'
        + '<option value="learn"' + (s.badge === 'learn' ? ' selected' : '') + '>学习 ing</option>'
        + '</select>'
        + '<button type="button" class="btn btn-sm ed-danger" data-skill-del="' + i + '">删除</button>'
        + '</div>';
    }).join('');
  }

  function syncSkillsFromDOM() {
    state.profile.skills = $all('#skillEditorList .ed-skillrow').map(function (row) {
      return {
        name: row.querySelector('[data-skill=name]').value,
        sub: row.querySelector('[data-skill=sub]').value,
        badge: row.querySelector('[data-skill=badge]').value
      };
    });
    scheduleProfileSave();
  }

  $('#skillEditorList').addEventListener('input', syncSkillsFromDOM);
  $('#skillEditorList').addEventListener('change', syncSkillsFromDOM);
  $('#skillEditorList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-skill-del]');
    if (!btn) return;
    var i = Number(btn.dataset.skillDel);
    state.profile.skills.splice(i, 1);
    saveProfileNow(true); renderSkills();
  });
  $('#btnAddSkill').addEventListener('click', function () {
    state.profile.skills.push({ name: '新软件', sub: '', badge: '' });
    saveProfileNow(true); renderSkills();
  });

  /* ============================================================
     导出与保存
     ============================================================ */
  // 导出时去掉内部字段（dataURL 等），只保留前台需要的
  function publicWorks() {
    return state.works.map(function (w) {
      var o = {
        id: w.id,
        type: w.type || 'image',
        category: w.category || 'illustration',
        title: w.title || '',
        src: w.src || ''
      };
      if (w.type === 'video' && w.poster) o.poster = w.poster;
      if (w.desc) o.desc = w.desc;
      return o;
    });
  }

  // 需要单独下载的新图片（去重）
  function pendingImages() {
    var map = {};
    state.works.forEach(function (w) {
      if (w._data && w.src) map[basename(w.src)] = w._data;
      if (w._posterData && w.poster) map[basename(w.poster)] = w._posterData;
    });
    return Object.keys(map).map(function (name) { return { name: name, data: map[name] }; });
  }

  var WORKS_HEADER =
    '/* ============================================================\n' +
    '   作品数据 —— 由「管理内容」页导出生成\n' +
    '   字段：id 编号 / type 类型(image|video) / category 分类\n' +
    '        title 标题 / src 图片或视频路径 / poster 视频封面 / desc 介绍\n' +
    '   ============================================================ */\n';

  var PROFILE_HEADER =
    '/* ============================================================\n' +
    '   全站文字 / 技能 / 联系方式 —— 由「管理内容」页导出生成\n' +
    '   放回 js/ 文件夹替换旧文件即可生效。\n' +
    '   ============================================================ */\n';

  function buildWorksFile() {
    return WORKS_HEADER + 'var WORKS = ' + JSON.stringify(publicWorks(), null, 2) + ';\n';
  }
  function buildProfileFile() {
    return PROFILE_HEADER + 'var PROFILE = ' + JSON.stringify(state.profile, null, 2) + ';\n';
  }

  $('#btnExportWorks').addEventListener('click', function () {
    ANFU_STORE.downloadText('works-data.js', buildWorksFile(), 'application/javascript');
    toast('✓ works-data.js 已下载');
  });

  $('#btnExportProfile').addEventListener('click', function () {
    ANFU_STORE.downloadText('profile-data.js', buildProfileFile(), 'application/javascript');
    toast('✓ profile-data.js 已下载');
  });

  $('#btnDownloadImgs').addEventListener('click', async function () {
    var imgs = pendingImages();
    if (!imgs.length) { toast('没有需要下载的新图片～'); return; }
    toast('开始下载 ' + imgs.length + ' 张图片，若浏览器询问请点「允许」');
    for (var i = 0; i < imgs.length; i++) {
      ANFU_STORE.downloadDataURL(imgs[i].data, imgs[i].name);
      await sleep(700); // 错开，避免浏览器拦截连续下载
    }
    toast('✓ 图片已下载，记得放进 assets/works/ 文件夹');
  });

  /* ---------- 恢复默认 ---------- */
  $('#btnResetWorks').addEventListener('click', function () {
    if (!confirm('确定清空浏览器里保存的作品修改，恢复为文件默认内容吗？')) return;
    ANFU_STORE.resetWorks();
    state.works = ANFU_STORE.loadWorks();
    renderWorks(); renderExportStatus(); toast('已恢复作品默认内容');
  });
  $('#btnResetProfile').addEventListener('click', function () {
    if (!confirm('确定清空浏览器里保存的文字修改，恢复为文件默认内容吗？')) return;
    ANFU_STORE.resetProfile();
    state.profile = ANFU_STORE.loadProfile();
    fillProfileForm(); renderExportStatus(); toast('已恢复文字默认内容');
  });

  /* ---------- 状态面板 ---------- */
  function renderExportStatus() {
    var box = $('#exportStatus');
    if (!box) return;
    var pending = pendingImages();
    var defaultCount = (window.WORKS || []).length;
    var rows = [
      ['当前作品数量', state.works.length + ' 件（文件默认 ' + defaultCount + ' 件）'
        + (ANFU_STORE.worksEdited() ? ' · <b style="color:#c98a2b">有未导出的修改</b>' : '')],
      ['待下载的新图片', pending.length ? pending.length + ' 张：' + pending.map(function (p) { return esc(p.name); }).join('、')
        : '0 张'],
      ['文字内容', ANFU_STORE.profileEdited() ? '<b style="color:#c98a2b">已自定义（建议导出 profile-data.js 备份）</b>' : '与文件默认一致']
    ];
    box.innerHTML = rows.map(function (r) {
      return '<li><span>' + r[0] + '</span><span>' + r[1] + '</span></li>';
    }).join('');
    var pc = $('#pendingImgCount');
    if (pc) pc.textContent = pending.length;
  }

  /* ---------- 初始化 ---------- */
  renderWorks();
  fillProfileForm();
  renderExportStatus();

  // 暴露给自动化测试（普通使用可忽略）
  window.__anfuEditor = {
    state: state,
    addWork: addWork,
    buildWorksFile: buildWorksFile,
    buildProfileFile: buildProfileFile,
    pendingImages: pendingImages,
    saveNow: function () { saveNow(true); saveProfileNow(true); },
    // 测试用：模拟“上传了一张图片”
    importImage: function (workId, dataURL, filename) {
      var w = state.works.filter(function (x) { return String(x.id) === String(workId); })[0];
      if (!w) return false;
      w._data = dataURL;
      w.src = 'assets/works/' + filename;
      saveNow(true); renderWorks();
      return true;
    }
  };
})();
