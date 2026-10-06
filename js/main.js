/* ============================================================
   全站交互脚本（原生 JS，无任何依赖，本地双击 HTML 即可运行）
   包含：手机菜单 / 返回按钮 / 滚动渐入 / 作品渲染与筛选 / 大图弹窗
   ------------------------------------------------------------
   一般不需要修改本文件；添加作品请编辑 js/works-data.js
   ============================================================ */
(function () {
  'use strict';

  // 全站作品：优先读取“管理内容”页保存到浏览器的修改，否则用 works-data.js
  const siteWorks = window.ANFU_STORE
    ? ANFU_STORE.loadWorks()
    : (window.WORKS || []).slice();
  // 全站文字：默认值 + 浏览器里改过的内容
  const profile = window.ANFU_STORE
    ? ANFU_STORE.loadProfile()
    : (window.PROFILE || {});

  // 当前筛选结果（作品页使用）
  let visibleList = siteWorks.slice();
  let lightboxIndex = 0;

  // 作品实际显示的图片：新上传未导出的图存在 _data 里
  function workImage(w) { return w._data || w.src; }
  function workPoster(w) { return w._posterData || w.poster || workImage(w); }
  // 视频封面：没有封面时返回空（不能把 mp4 路径当图片用）
  function videoPoster(w) { return w._posterData || w.poster || ''; }

  /* ---------- 0. 把 PROFILE 文字绑定到页面上 ---------- */
  // HTML 里写 data-bind="home.desc" 的元素，会自动填入对应文字
  function deepGet(obj, path) {
    return path.split('.').reduce(function (o, k) {
      return o == null ? undefined : o[k];
    }, obj);
  }

  function applyProfile() {
    document.querySelectorAll('[data-bind]').forEach(function (el) {
      const v = deepGet(profile, el.dataset.bind);
      if (v != null && typeof v !== 'object') el.textContent = v;
    });

    // 带前缀的链接绑定，如 data-bind-href="contact.email" data-href-prefix="mailto:"
    document.querySelectorAll('[data-bind-href]').forEach(function (el) {
      const v = deepGet(profile, el.dataset.bindHref);
      if (v != null) el.href = (el.dataset.hrefPrefix || '') + v;
    });

    // 一键复制按钮的值同步
    document.querySelectorAll('[data-bind-copy]').forEach(function (el) {
      const v = deepGet(profile, el.dataset.bindCopy);
      if (v != null) el.setAttribute('data-copy', v);
    });

    // 关于我页的软件技能清单
    const skillBox = document.getElementById('skillList');
    if (skillBox && profile.skills) {
      skillBox.innerHTML = profile.skills.map(function (s) {
        const badge = s.badge === 'love'
          ? '<i class="badge badge-love">♡ 本命</i>'
          : s.badge === 'learn'
            ? '<i class="badge badge-learn">学习 ing</i>'
            : '';
        const sub = s.sub ? ' <small>' + esc(s.sub) + '</small>' : '';
        return '<span class="skill"><b>' + esc(s.name) + '</b>' + sub + badge + '</span>';
      }).join('');
    }
  }
  applyProfile();

  /* ---------- 1. 手机端导航菜单 ---------- */
  const navToggle = document.querySelector('.nav-toggle');
  const siteNav = document.getElementById('siteNav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      const open = siteNav.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
    });
    // 点击菜单项后自动收起
    siteNav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        siteNav.classList.remove('is-open');
        navToggle.classList.remove('is-open');
      });
    });
  }

  /* ---------- 2. 高亮当前页的导航 ---------- */
  const currentPage = document.body.dataset.page;
  document.querySelectorAll('.site-nav a').forEach(function (a) {
    if (a.dataset.nav === currentPage) a.classList.add('is-active');
  });

  /* ---------- 3. 左下角 🔙 返回按钮 ---------- */
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      // 有上一页历史就返回上一页，否则回首页
      if (history.length > 1) history.back();
      else window.location.href = 'index.html';
    });
  }

  /* ---------- 4. 滚动进入视口时的轻微渐入 ---------- */
  const revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  function observeReveals(scope) {
    (scope || document).querySelectorAll('.reveal:not(.is-visible)').forEach(function (el) {
      // HTML 里写 data-delay="120" 可以让元素晚一点出现，形成错落感
      if (el.dataset.delay) el.style.transitionDelay = el.dataset.delay + 'ms';
      revealObserver.observe(el);
    });
  }
  observeReveals();

  /* ---------- 4.5 动画增强：共享状态（必须在首次渲染卡片之前就位） ----------
     参考纸张手账 / 曲线画廊风格，全部原生实现：
     · 卡片像纸片一样依次落下入场，静止时微微倾斜
     · 鼠标悬停时 3D 轻倾斜 + 图片放大
     · 滚动时画廊有轻轻的波浪起伏
     · 大标题逐字「揭幕」、首屏拍立得视差
     · 顶部滚动进度条、弹窗翻页滑动
     尊重系统的“减少动态效果”设置。 */
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var motionCards = [];

  // 视口里的卡片才参与波浪计算（68 张卡片也很省性能）
  var waveObserver = reducedMotion ? null : new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { en.target._inWave = en.isIntersecting; });
  }, { rootMargin: '120px 40px' });

  function registerMotionCards() {
    motionCards = [];
    document.querySelectorAll('#featuredGrid').forEach(function (grid) {
      grid.querySelectorAll('.work-card').forEach(function (card) {
        motionCards.push(card);
        if (waveObserver) waveObserver.observe(card);
      });
    });
  }

  /* ---------- 5. 小工具 ---------- */
  // 防止标题里的特殊字符把 HTML 结构弄坏
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 分类名映射（想加新分类，在这里加一行 'key': '中文名'）
  const CATEGORY = {
    illustration: '插画作品',
    video: '短视频'
  };

  // 卡片静止时的小倾斜角度（手账拼贴感，JS 分配，hover 时扶正）
  const CARD_ROTS = ['-1.4deg', '1.2deg', '-0.5deg', '0.9deg', '-0.9deg', '1.5deg', '-1.1deg', '0.4deg'];

  function cardHTML(w, i) {
    const catName = CATEGORY[w.category] || '其他';
    const rot = CARD_ROTS[Math.abs(w.id) % CARD_ROTS.length];
    const colDelay = (i % 3) * 70; // 按列错峰，像纸片依次落下
    const media = w.type === 'video'
      ? '<div class="work-media">'
        + (videoPoster(w)
            ? '<img src="' + esc(videoPoster(w)) + '" alt="' + esc(w.title) + ' 的封面" loading="lazy">'
            : '<div class="work-ph">🎬<br>待添加封面</div>')
        + '<span class="play-badge">▶</span></div>'
      : '<div class="work-media">'
        + (workImage(w)
            ? '<img src="' + esc(workImage(w)) + '" alt="' + esc(w.title) + '" loading="lazy">'
            : '<div class="work-ph">🖼️<br>待添加图片</div>')
        + '</div>';

    return '<article class="work-card reveal" style="--rot:' + rot + ';animation-delay:' + colDelay + 'ms" '
      + 'tabindex="0" role="button" aria-label="查看作品：' + esc(w.title) + '">'
      + '<span class="cat-tag">' + esc(catName) + '</span>'
      + media
      + '<div class="work-info"><h3>' + esc(w.title) + '</h3>'
      + (w.desc ? '<p>' + esc(w.desc) + '</p>' : '')
      + '</div></article>';
  }

  /* ---------- 6. 作品展示页：横向画廊（绳子串起来的作品）+ 分类筛选 ---------- */
  const galleryTrack = document.getElementById('galleryTrack');

  if (galleryTrack) {
    // 画廊拖拽状态（var 声明：buildGrid 首次渲染时就要用到）
    var galleryX = 0;             // 当前横向位移（0 → -galleryMax）
    var galleryMax = 0;           // 可以拖动的最大距离
    var galleryDragMoved = false; // 刚发生过拖拽时，拦截误触的 click

    function buildGrid() {
      const cat = document.querySelector('.filter-btn.is-active').dataset.cat;
      visibleList = cat === 'all'
        ? siteWorks.slice()
        : siteWorks.filter(function (w) { return w.category === cat; });

      if (!visibleList.length) {
        galleryTrack.innerHTML = '<p class="empty-tip">这里还空空的，去「管理内容」页添加作品吧～</p>';
        galleryMetrics();
        return;
      }
      galleryTrack.classList.remove('is-switching');
      galleryTrack.innerHTML = visibleList.map(cardHTML).join('');
      observeReveals(galleryTrack);
      galleryMetrics();
    }

    function renderWorks() {
      const oldCards = galleryTrack.querySelectorAll('.work-card');
      if (!oldCards.length) { buildGrid(); return; }
      // 旧卡片先“揉成一团”退场，再让新卡片依次落下
      galleryTrack.classList.add('is-switching');
      oldCards.forEach(function (c, i) {
        c.style.animationDelay = (i % 3) * 28 + 'ms';
        c.classList.add('card-out');
      });
      setTimeout(buildGrid, 200);
    }

    // 分类筛选按钮
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-btn').forEach(function (b) {
          b.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        renderWorks();
      });
    });

    // 点击 / 回车卡片 → 打开对应序号的大图
    function cardIndex(card) {
      return Array.prototype.indexOf.call(galleryTrack.querySelectorAll('.work-card'), card);
    }
    galleryTrack.addEventListener('click', function (e) {
      if (galleryDragMoved) return; // 拖拽松手后的 click 不算点击
      const card = e.target.closest('.work-card');
      if (card) openLightbox(cardIndex(card));
    });
    galleryTrack.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const card = e.target.closest('.work-card');
      if (card) openLightbox(cardIndex(card));
    });

    /* ----- 绳子画廊拖拽：按住滑动 + 惯性甩动 + 两端回弹 + 弧线弯曲 -----
       参考 curve-gallery 的手感，全部用原生 pointer 事件实现。
       「减弱动态效果」时不启用，画廊退化为原生横向滚动。 */
    const galleryWrap = document.getElementById('galleryWrap');
    const galleryProgress = document.querySelector('.gallery-progress i');

    // 计算画廊尺寸，并缓存每张卡片中心点的横坐标（弯曲效果要用）
    function galleryMetrics() {
      const wrap = document.getElementById('galleryWrap');
      if (!wrap) return;
      galleryMax = Math.max(0, galleryTrack.scrollWidth - wrap.clientWidth);
      galleryTrack.querySelectorAll('.work-card').forEach(function (c) {
        c._cx = c.offsetLeft + c.offsetWidth / 2;
      });
      applyGalleryX();
    }

    function applyGalleryX() {
      galleryTrack.style.transform = 'translate3d(' + galleryX.toFixed(1) + 'px,0,0)';
      if (galleryProgress) {
        galleryProgress.style.transform =
          'scaleX(' + (galleryMax ? Math.min(1, -galleryX / galleryMax) : 1) + ')';
      }
      // 弧线弯曲：离屏幕中心越远的卡片越低、越歪，像挂在下垂的绳子上
      const wrap = document.getElementById('galleryWrap');
      if (!wrap) return;
      const half = wrap.clientWidth / 2;
      const cards = galleryTrack.querySelectorAll('.work-card');
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (c._cx == null) continue;
        const dx = c._cx + galleryX - half;
        if (Math.abs(dx) > half + 500) continue; // 视口外的不算
        const n = Math.max(-1, Math.min(1, dx / (half * 1.15)));
        c.style.setProperty('--curve-y', (n * n * 34).toFixed(1) + 'px');
        c.style.setProperty('--curve-r', (n * 5).toFixed(2) + 'deg');
      }
    }

    if (galleryWrap && !reducedMotion) {
      let dragging = false;
      let lastX = 0;
      let lastT = 0;
      let moved = 0;
      let gvel = 0;   // 甩动的速度（px/帧）
      let raf = null;

      // 松手后的惯性滚动，一点点衰减，两端像橡皮筋一样弹回来
      function tick() {
        galleryX += gvel;
        gvel *= 0.94;
        if (galleryX > 0) { galleryX += (0 - galleryX) * 0.16; gvel *= 0.55; }
        if (galleryX < -galleryMax) { galleryX += (-galleryMax - galleryX) * 0.16; gvel *= 0.55; }
        applyGalleryX();
        const resting = Math.abs(gvel) < 0.15 && galleryX <= 0.4 && galleryX >= -galleryMax - 0.4;
        if (resting) {
          galleryX = Math.max(-galleryMax, Math.min(0, galleryX));
          applyGalleryX();
          raf = null;
        } else {
          raf = requestAnimationFrame(tick);
        }
      }
      function startTick() {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      }

      galleryWrap.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 || (lightbox && lightbox.classList.contains('is-open'))) return;
        dragging = true;
        lastX = e.clientX;
        lastT = e.timeStamp;
        moved = 0;
        gvel = 0;
        galleryWrap.classList.add('is-dragging');
        e.preventDefault(); // 阻止选中文字 / 拖出图片影子
      });
      window.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        moved += Math.abs(dx);
        const dt = e.timeStamp - lastT;
        lastT = e.timeStamp;
        if (dt > 0) gvel = gvel * 0.7 + (dx / dt * 16.7) * 0.3; // 换算成“每帧”速度
        galleryX += dx;
        // 拖出边界时给阻力（橡皮筋手感）
        if (galleryX > 0) galleryX *= 0.35;
        if (galleryX < -galleryMax) galleryX = -galleryMax + (galleryX + galleryMax) * 0.35;
        applyGalleryX();
      });
      window.addEventListener('pointerup', function () {
        if (!dragging) return;
        dragging = false;
        galleryWrap.classList.remove('is-dragging');
        if (moved > 8) {
          // 拖过了就拦截紧接着的 click，避免误开大图
          galleryDragMoved = true;
          setTimeout(function () { galleryDragMoved = false; }, 80);
          startTick(); // 带着惯性继续滑
        } else {
          gvel = 0;
        }
      });
      window.addEventListener('pointercancel', function () {
        dragging = false;
        galleryWrap.classList.remove('is-dragging');
        gvel = 0;
        startTick();
      });

      // 鼠标滚轮：在画廊上滚动 = 横向浏览；滑到头了就还给页面继续上下滚
      galleryWrap.addEventListener('wheel', function (e) {
        if (lightbox && lightbox.classList.contains('is-open')) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 触控板横向滚动交给浏览器
        const canGo = (e.deltaY < 0 && galleryX < 0) || (e.deltaY > 0 && galleryX > -galleryMax);
        if (!canGo && !galleryMax) return;
        e.preventDefault();
        galleryX -= e.deltaY;
        if (galleryX > 0) galleryX = Math.min(galleryX, 40);
        if (galleryX < -galleryMax) galleryX = Math.max(galleryX, -galleryMax - 40);
        gvel = 0;
        applyGalleryX();
        startTick();
      }, { passive: false });

      window.addEventListener('resize', function () {
        galleryMetrics();
        galleryX = Math.max(-galleryMax, Math.min(0, galleryX));
        applyGalleryX();
      });
    } else if (galleryWrap) {
      galleryWrap.classList.add('is-static'); // 减弱动效：原生横向滚动
    }

    // 一切就绪，首次渲染画廊（要在拖拽模块初始化之后，避免用到未声明的变量）
    renderWorks();
  }

  /* ---------- 7. 大图弹窗 Lightbox（显示 PNG 原图 / 播放视频） ---------- */
  const lightbox = document.getElementById('lightbox');

  function renderLightbox(dir) {
    const w = visibleList[lightboxIndex];
    if (!w) return;
    const mediaBox = lightbox.querySelector('.lightbox-media');

    // 切走前暂停上一个视频，避免声音叠播
    const oldVideo = mediaBox.querySelector('video');
    if (oldVideo) oldVideo.pause();
    mediaBox.innerHTML = w.type === 'video'
      ? '<video src="' + esc(w.src) + '"' + (videoPoster(w) ? ' poster="' + esc(videoPoster(w)) + '"' : '') + ' controls playsinline></video>'
      : (workImage(w)
          ? '<img src="' + esc(workImage(w)) + '" alt="' + esc(w.title) + '（PNG 原图）">'
          : '<div class="work-ph work-ph-lg">🖼️ 这件作品还没有上传图片</div>');

    // 重新触发“翻页”入场动画（下一张从右滑入，上一张从左滑入）
    mediaBox.style.setProperty('--dir', (dir < 0 ? -46 : dir > 0 ? 46 : 0) + 'px');
    mediaBox.classList.remove('is-swap');
    void mediaBox.offsetWidth; // 强制回流，保证动画重新播放
    mediaBox.classList.add('is-swap');

    lightbox.querySelector('.lightbox-title').textContent = w.title;
    lightbox.querySelector('.lightbox-desc').textContent = w.desc || CATEGORY[w.category] || '';
    lightbox.querySelector('.lightbox-count').textContent =
      (lightboxIndex + 1) + ' / ' + visibleList.length;
  }

  function openLightbox(index, dir) {
    if (!lightbox || !visibleList.length) return;
    const prevIndex = lightboxIndex;
    lightboxIndex = (index + visibleList.length) % visibleList.length;
    if (typeof dir !== 'number') dir = lightboxIndex >= prevIndex ? 1 : -1;
    renderLightbox(dir);
    lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    // 先暂停视频，避免关闭瞬间还有声音
    const v = lightbox.querySelector('video');
    if (v) v.pause();
    lightbox.classList.remove('is-open');
    lightbox.querySelector('.lightbox-media').innerHTML = ''; // 清空，停止视频加载
    document.body.style.overflow = '';
  }

  if (lightbox) {
    lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    lightbox.querySelector('.lightbox-mask').addEventListener('click', closeLightbox);
    lightbox.querySelector('.lightbox-prev').addEventListener('click', function (e) {
      e.stopPropagation();
      openLightbox(lightboxIndex - 1, -1);
    });
    lightbox.querySelector('.lightbox-next').addEventListener('click', function (e) {
      e.stopPropagation();
      openLightbox(lightboxIndex + 1, 1);
    });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') openLightbox(lightboxIndex - 1, -1);
      if (e.key === 'ArrowRight') openLightbox(lightboxIndex + 1, 1);
    });
  }

  /* ---------- 8. 首页“精选作品”（自动取前三张，点击跳作品页） ---------- */
  const featuredGrid = document.getElementById('featuredGrid');
  if (featuredGrid && siteWorks.length) {
    const picks = siteWorks.filter(function (w) { return w.type === 'image' && workImage(w); }).slice(0, 3);
    featuredGrid.innerHTML = picks.map(function (w, i) {
      return '<a class="work-card reveal" style="--rot:' + CARD_ROTS[Math.abs(w.id) % CARD_ROTS.length]
        + ';animation-delay:' + (i * 90) + 'ms" href="works.html">'
        + '<span class="cat-tag">' + esc(CATEGORY[w.category] || '') + '</span>'
        + '<div class="work-media"><img src="' + esc(workImage(w)) + '" alt="' + esc(w.title) + '" loading="lazy"></div>'
        + '<div class="work-info"><h3>' + esc(w.title) + '</h3>'
        + (w.desc ? '<p>' + esc(w.desc) + '</p>' : '')
        + '</div></a>';
    }).join('');
    observeReveals(featuredGrid);
    registerMotionCards();
  }

  /* ---------- 9. 联系页：一键复制邮箱 / QQ ---------- */
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (err) {}
    document.body.removeChild(ta);
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const text = btn.dataset.copy;
      function flash() {
        const old = btn.textContent;
        btn.textContent = '已复制 ✓';
        setTimeout(function () { btn.textContent = old; }, 1500);
      }
      // 优先用现代剪贴板 API，失败时用旧办法兜底（本地 file:// 也能用）
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(flash).catch(function () {
          fallbackCopy(text);
          flash();
        });
      } else {
        fallbackCopy(text);
        flash();
      }
    });
  });

  /* ---------- 10. 动画增强（交互绑定；共享状态在 4.5 节提前声明） ---------- */
  const motionGrids = Array.prototype.slice.call(document.querySelectorAll('#galleryTrack, #featuredGrid'));

  // 鼠标 3D 倾斜（事件委托，每个网格只绑一次；仅支持悬停的设备）
  if (!reducedMotion && canHover) {
    motionGrids.forEach(function (grid) {
      let raf = null;
      let lastEvent = null;
      grid.addEventListener('pointermove', function (e) {
        const card = e.target.closest('.work-card');
        if (!card || (lightbox && lightbox.classList.contains('is-open'))) return;
        lastEvent = { card: card, x: e.clientX, y: e.clientY };
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = null;
          const c = lastEvent.card, r = c.getBoundingClientRect();
          const nx = ((lastEvent.x - r.left) / r.width - .5) * 2;
          const ny = ((lastEvent.y - r.top) / r.height - .5) * 2;
          c.style.setProperty('--rx', (-ny * 4).toFixed(2) + 'deg');
          c.style.setProperty('--ry', (nx * 5).toFixed(2) + 'deg');
          c.style.setProperty('--mx', (nx * 5).toFixed(1) + 'px');
          c.style.setProperty('--my', (ny * 4).toFixed(1) + 'px');
        });
      });
      grid.addEventListener('pointerout', function (e) {
        const card = e.target.closest('.work-card');
        if (!card) return;
        if (card.contains(e.relatedTarget)) return;
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
        card.style.setProperty('--mx', '0px');
        card.style.setProperty('--my', '0px');
      });
    });
  }

  /* ----- 滚动：波浪起伏 + 进度条 + 视差（单一 rAF，节流） ----- */
  if (!reducedMotion) {
    const progressBar = document.createElement('div');
    progressBar.className = 'scroll-progress';
    progressBar.innerHTML = '<i></i>';
    document.body.appendChild(progressBar);
    const progressFill = progressBar.querySelector('i');

    const heroVisual = document.querySelector('.hero-visual');
    const pageBanner = document.querySelector('.page-banner');
    let scrollRaf = null;

    function paintScroll() {
      scrollRaf = null;
      const y = window.scrollY || window.pageYOffset;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressFill.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';

      if (heroVisual) heroVisual.style.transform = 'translateY(' + (y * -0.05).toFixed(1) + 'px)';
      if (pageBanner && y < 420) {
        pageBanner.style.transform = 'translateY(' + (y * 0.12).toFixed(1) + 'px) scale(' + (1 - Math.min(y, 420) / 12000) + ')';
        pageBanner.style.opacity = String(Math.max(0, 1 - y / 380));
      }

      const cy = window.innerHeight / 2;
      for (let i = 0; i < motionCards.length; i++) {
        const c = motionCards[i];
        if (!c._inWave) continue;
        const r = c.getBoundingClientRect();
        const d = ((r.top + r.height / 2) - cy) / window.innerHeight; // -1~1 附近
        const wave = Math.max(-1, Math.min(1, d)) * -9;
        c.style.setProperty('--wave', wave.toFixed(1) + 'px');
      }
    }
    window.addEventListener('scroll', function () {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(paintScroll);
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(paintScroll);
    }, { passive: true });
    paintScroll();
  }

  /* ----- 大标题逐字揭幕（遮罩里的小字一个个跳出来） ----- */
  const TOKEN_RE = /\s+|[A-Za-z0-9’'\-.]+|(?:[\uD800-\uDBFF][\uDC00-\uDFFF])|[\s\S]/g;

  function makeWordToken(text) {
    const outer = document.createElement('span');
    outer.className = 'sp';
    const inner = document.createElement('span');
    inner.className = 'sp-in';
    inner.textContent = text;
    outer.appendChild(inner);
    return outer;
  }

  function splitHeading(h) {
    let wi = 0;
    Array.prototype.slice.call(h.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        // 文本节点：按「单词 / 单个汉字 / 空白」拆开
        const frag = document.createDocumentFragment();
        const tokens = node.nodeValue.match(TOKEN_RE) || [];
        tokens.forEach(function (tk) {
          if (/^\s+$/.test(tk)) {
            frag.appendChild(document.createTextNode(tk));
          } else {
            const el = makeWordToken(tk);
            el.querySelector('.sp-in').style.transitionDelay = (Math.min(wi, 14) * 38) + 'ms';
            wi++;
            frag.appendChild(el);
          }
        });
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === 1) {
        // 彩色高亮块等子元素：整块作为一个词，不拆坏里面的 data-bind
        const el = makeWordToken('');
        const inner = el.firstChild;
        node.parentNode.replaceChild(el, node); // 先把节点替换成遮罩壳
        inner.appendChild(node);                // 再把原子元素装进壳里
        inner.style.transitionDelay = (Math.min(wi, 14) * 38) + 'ms';
        wi++;
      }
    });
    h.classList.add('is-split');
  }

  const splitTargets = document.querySelectorAll('.hero h1, .page-banner h1, .section-head h2');
  if (reducedMotion) {
    splitTargets.forEach(function (h) { h.classList.add('is-split', 'play'); });
  } else if (splitTargets.length) {
    splitTargets.forEach(splitHeading);
    const headObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('play');
          headObserver.unobserve(en.target);
        }
      });
    }, { threshold: .25 });
    splitTargets.forEach(function (h) { headObserver.observe(h); });
  }

  /* ---------- 11. 页脚年份自动更新 ---------- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- 12. 手绘小伙伴：藏在角落的可点击小彩蛋 ----------
     小猫咪 / 彩虹 / 雨滴 / 星星 / 云朵 / 小花，
     平时轻轻飘着，点一下会蹦一下、冒出表情气泡和小特效粒子。 */
  const BUDDY_SVG = {
    rainbow: '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<path d="M8 46 A24 24 0 0 1 56 46" fill="none" stroke="#f0aeb8" stroke-width="7" stroke-linecap="round"/>'
      + '<path d="M16.5 46 A15.5 15.5 0 0 1 47.5 46" fill="none" stroke="#f6d365" stroke-width="7" stroke-linecap="round"/>'
      + '<path d="M25 46 A7 7 0 0 1 39 46" fill="none" stroke="#a8d8b0" stroke-width="7" stroke-linecap="round"/></svg>',
    cat: '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<path d="M15 27 L12 10 L27 19" fill="#fdf0b8" stroke="#56566a" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<path d="M49 27 L52 10 L37 19" fill="#fdf0b8" stroke="#56566a" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<circle cx="32" cy="37" r="19" fill="#fdf0b8" stroke="#56566a" stroke-width="2.5"/>'
      + '<circle cx="25" cy="34" r="2.2" fill="#56566a"/><circle cx="39" cy="34" r="2.2" fill="#56566a"/>'
      + '<path d="M30.5 39 L33.5 39 L32 41.2 Z" fill="#f0aeb8" stroke="#56566a" stroke-width="1.2" stroke-linejoin="round"/>'
      + '<path d="M29 43.5 Q32 46 35 43.5" fill="none" stroke="#56566a" stroke-width="2" stroke-linecap="round"/>'
      + '<path d="M11 34 L20 36 M11 42 L20 41 M53 34 L44 36 M53 42 L44 41" stroke="#56566a" stroke-width="1.6" stroke-linecap="round"/></svg>',
    raindrop: '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<path d="M32 7 C32 7 16 28 16 40 a16 16 0 0 0 32 0 C48 28 32 7 32 7 Z" fill="#bfe3f5" stroke="#56566a" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<circle cx="26" cy="41" r="2.2" fill="#56566a"/><circle cx="38" cy="41" r="2.2" fill="#56566a"/>'
      + '<path d="M28 47 Q32 50 36 47" fill="none" stroke="#56566a" stroke-width="2" stroke-linecap="round"/>'
      + '<path d="M24.5 20 Q26.5 16 25 12.5" fill="none" stroke="#8fc9e8" stroke-width="2.2" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<path d="M32 6 L39 24 L59 25 L43.5 37 L49 56 L32 45 L15 56 L20.5 37 L5 25 L25 24 Z" fill="#fdf0b8" stroke="#56566a" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<circle cx="27" cy="30" r="2" fill="#56566a"/><circle cx="37" cy="30" r="2" fill="#56566a"/>'
      + '<path d="M29 36 Q32 38.5 35 36" fill="none" stroke="#56566a" stroke-width="2" stroke-linecap="round"/></svg>',
    cloud: '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<path d="M14 44 Q6 44 7.5 37.5 Q9 31 16 32 Q17 23 26.5 23 Q34.5 23 36.5 30 Q45 27 47 35 Q55 36 53 42 Q52 44.5 46 44.5 Z" fill="#ffffff" stroke="#56566a" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<path d="M23 50 l-2 6 M33 50 l-2 6 M43 50 l-2 6" stroke="#8fc9e8" stroke-width="2.6" stroke-linecap="round"/></svg>',
    flower: '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<g stroke="#56566a" stroke-width="2.2">'
      + '<circle cx="32" cy="15" r="8.5" fill="#fadadd"/><circle cx="48" cy="27" r="8.5" fill="#fadadd"/>'
      + '<circle cx="42" cy="46" r="8.5" fill="#fadadd"/><circle cx="22" cy="46" r="8.5" fill="#fadadd"/>'
      + '<circle cx="16" cy="27" r="8.5" fill="#fadadd"/></g>'
      + '<circle cx="32" cy="31" r="7.5" fill="#fdf0b8" stroke="#56566a" stroke-width="2.2"/>'
      + '<circle cx="29.5" cy="30" r="1.4" fill="#56566a"/><circle cx="34.5" cy="30" r="1.4" fill="#56566a"/>'
      + '<path d="M30 33.5 Q32 35 34 33.5" fill="none" stroke="#56566a" stroke-width="1.6" stroke-linecap="round"/></svg>'
  };
  const BUDDY_TALK = {
    cat: '喵～', raindrop: '滴答！', rainbow: '哇，彩虹！',
    star: '闪亮✦', cloud: '哗啦啦…', flower: '开花啦～'
  };
  const BUDDY_SPARK = {
    cat: ['💖', '✨', '💕'], raindrop: ['💧', '💦', '💧'], rainbow: ['✨', '🌈', '⭐'],
    star: ['⭐', '✧', '✦'], cloud: ['💧', '💦', '☁️'], flower: ['🌸', '✿', '🌼']
  };
  // 每个页面藏几只小伙伴：[类型, 水平位置, 垂直位置]，第一条会在手机上也显示
  const BUDDY_SPOTS = {
    home: [['rainbow', 'right:3%', 'top:11%'], ['cat', 'left:3%', 'top:64%'],
           ['raindrop', 'right:5%', 'top:55%'], ['star', 'left:3%', 'top:26%']],
    works: [['raindrop', 'right:4%', 'top:22%'], ['star', 'left:3%', 'top:30%'],
            ['cloud', 'left:4%', 'top:72%']],
    about: [['cat', 'right:4%', 'top:24%'], ['flower', 'left:3%', 'top:55%'],
            ['star', 'right:7%', 'top:60%']],
    contact: [['cloud', 'right:5%', 'top:20%'], ['raindrop', 'left:4%', 'top:42%'],
              ['flower', 'right:6%', 'top:56%']]
  };

  // 小特效粒子：从点击处朝四面八方飞出去（首页涂鸦 & 小伙伴共用）
  function buddyBurst(x, y, emojis) {
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('span');
      p.className = 'buddy-spark';
      p.textContent = emojis[i % emojis.length];
      const ang = (Math.PI * 2 * i) / 8 + Math.random() * .6;
      const dist = 42 + Math.random() * 42;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist - 26).toFixed(0) + 'px');
      document.body.appendChild(p);
      setTimeout(function () { p.remove(); }, 900);
    }
  }

  // 通用：蹦一下 + 冒气泡 + 撒粒子（挂到任意元素上）
  function attachBuddyFx(el, talk, sparks) {
    el.addEventListener('click', function () {
      // 1) 蹦一下（捏扁再弹起）
      el.classList.remove('is-boop');
      void el.offsetWidth;
      el.classList.add('is-boop');
      setTimeout(function () { el.classList.remove('is-boop'); }, 500); // 蹦完继续飘
      // 2) 冒出说话气泡
      let bubble = el.querySelector('.buddy-bubble');
      if (!bubble) {
        bubble = document.createElement('span');
        bubble.className = 'buddy-bubble';
        bubble.textContent = talk || '✧';
        el.appendChild(bubble);
      }
      bubble.classList.add('is-show');
      clearTimeout(el._talkTimer);
      el._talkTimer = setTimeout(function () { bubble.classList.remove('is-show'); }, 1200);
      // 3) 小特效粒子（“减少动态效果”时不飞）
      if (!reducedMotion) {
        const r = el.getBoundingClientRect();
        buddyBurst(r.left + r.width / 2, r.top + r.height / 2, sparks || ['✨']);
      }
    });
  }

  // 首页 hero 里的手绘涂鸦（小太阳 / 小爱心）也能点
  document.querySelectorAll('[data-buddy]').forEach(function (el) {
    attachBuddyFx(el, el.dataset.talk, (el.dataset.spark || '✨').split(','));
  });

  if (!document.querySelector('.buddy') && BUDDY_SPOTS[document.body.dataset.page]) {
    BUDDY_SPOTS[document.body.dataset.page].forEach(function (spot, idx) {
      const type = spot[0];
      const el = document.createElement('div');
      el.className = 'buddy';
      el.dataset.type = type;
      if (idx === 0) el.dataset.mobile = '1'; // 手机上只留第一只
      el.style.cssText = spot[1] + ';' + spot[2];

      const inner = document.createElement('div');
      inner.className = 'buddy-inner';
      inner.innerHTML = BUDDY_SVG[type];
      // 每只小伙伴飘动的节奏都不一样
      inner.style.animationDuration = (3.1 + Math.random() * 1.6).toFixed(2) + 's';
      inner.style.animationDelay = '-' + (Math.random() * 3).toFixed(2) + 's';
      el.appendChild(inner);

      attachBuddyFx(el, BUDDY_TALK[type] || '✧', BUDDY_SPARK[type] || ['✨']);

      document.body.appendChild(el);
    });
  }

})();
