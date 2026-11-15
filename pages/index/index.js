const catalog = require('../../utils/catalog.js');
const inlineImages = require('../../utils/illustration-data.js');
const store = require('../../utils/store.js');
const { syncBgm } = require('../../utils/audio.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

// 吉祥物用内联图片数据，避免内置 H5 预览器解析不了包内绝对路径导致破图
const MASCOT = require('../../utils/illustration-data.js').MASCOT;
// 11 档字签：前 4 档唐诗（初/进/挑/巅），中 3 档宋词（词/苑/巅），后 4 档古文（文/典/道/宗）
const TIER_WORDS = ['初', '进', '挑', '巅', '词', '苑', '巅', '文', '典', '道', '宗'];
// 三个文体各自的首页 Tab；顺序即展示顺序
const GENRE_TABS = [
  { key: 'shi', label: '唐诗' },
  { key: 'ci', label: '宋词' },
  { key: 'wen', label: '古文' },
];
const GENRE_LABEL = { shi: '唐诗', ci: '宋词', wen: '古文' };

function starParts(stars) {
  const n = stars || 0;
  return { on: '★'.repeat(n), off: '☆'.repeat(3 - n) };
}

/** 按累计通关数给一句少年感的鼓励语 */
function cheerOf(cleared, total) {
  if (cleared >= total && total > 0) return '全部关卡都通啦，你就是诗社小状元！';
  if (cleared >= total * 0.75) return '离终点只差几关，稳住，冲！';
  if (cleared >= total * 0.3) return '已经背下好多首啦，越闯越顺手～';
  if (cleared >= 1) return '开局很棒，再拿几颗星吧！';
  return '今天先认识一首小诗，出发啦！';
}

function greetingOf() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好呀';
  if (hour < 18) return '下午好呀';
  return '晚上好呀';
}

/** 用日期做确定性索引，每天推一篇，点击可看意象图与全文 */
function todayPoemOf() {
  const poems = catalog.getPoems();
  if (!poems.length) return null;
  const now = new Date();
  const seed = now.getFullYear() * 372 + (now.getMonth() + 1) * 31 + now.getDate();
  const poem = poems[seed % poems.length];
  const illus = catalog.getIllustration(poem.id);
  const real = illus && illus.real ? illus.real : '';
  const bundled = inlineImages.get(poem.id) || (illus ? illus.path : '');
  return {
    id: poem.id,
    title: poem.title,
    author: poem.author,
    image: real || bundled,
    fallback: real ? bundled : (illus ? illus.path : ''),
    isReal: !!real,
    credit: illus ? (illus.credit || '') : '',
    motif: illus ? illus.motif : '',
  };
}

createCloudPage({
  data: {
    mascotPath: MASCOT,
    greeting: '你好呀',
    cheerText: '',
    groups: [],
    genreTabs: [],
    activeGenre: 'shi',
    genreLabel: '唐诗',
    genreCleared: 0,
    genreTotal: 0,
    summary: {},
    titleName: '',
    unlocked: 1,
    totalLevels: 0,
    nextLevelId: 1,
    nextLevelName: '',
    nextLevelTier: '',
    nextEyebrow: '第一关',
    wrongCount: 0,
    poemTotal: 0,
    collectedCount: 0,
    collectPercent: 0,
    clearedPercent: 0,
    isNewPlayer: true,
    today: null,
    todayTriedFallback: false,
    todayImageFailed: false,
  },

  onCloudRefresh: function () {
    this.refresh();
    try { syncBgm(); } catch (e) { /* ignore */ }
  },

  refresh: function () {
    const state = store.getState();
    const total = catalog.getTotalLevels();
    const poemTotal = catalog.getPoems().length;
    const activeGenre = GENRE_LABEL[this.data.activeGenre] ? this.data.activeGenre : 'shi';
    const allTiers = catalog.getTiers();
    const progress = store.getGenreProgress(activeGenre);
    const prevExpanded = {};
    (this.data.groups || []).forEach(function (g) { prevExpanded[g.key] = g.expanded; });

    const groups = catalog.getGroupedLevels(activeGenre).map(function (group, index) {
      const levels = group.levels.map(function (level) {
        const record = state.levels[String(level.id)] || null;
        let status = 'locked';
        if (record && record.cleared) status = 'cleared';
        else if (store.isUnlocked(level.id)) status = 'active';
        const stars = record ? record.stars : 0;
        const parts = starParts(stars);
        let countText = level.count + ' 道题';
        if (status === 'cleared') countText += ' · 拿到 ' + stars + ' 颗星';
        else if (status === 'active') countText += ' · 等你来挑战';
        else countText += ' · 先过前面的关';
        return {
          id: level.id,
          badge: level.id < 10 ? '0' + level.id : String(level.id),
          name: level.name,
          count: level.count,
          status: status,
          statusText: status === 'cleared' ? '再来一次' : (status === 'active' ? '去挑战' : '未解锁'),
          countText: countText,
          stars: stars,
          starOn: parts.on,
          starOff: parts.off,
        };
      });
      const clearedCount = levels.filter(function (item) { return item.status === 'cleared'; }).length;
      return {
        key: group.tier.key,
        name: group.tier.name,
        subtitle: group.tier.subtitle,
        desc: group.tier.desc,
        theme: group.tier.theme,
        badgeWord: TIER_WORDS[allTiers.indexOf(group.tier)] || '诗',
        tierIndex: index,
        levels: levels,
        clearedCount: clearedCount,
        total: levels.length,
        percent: levels.length ? Math.round(clearedCount * 100 / levels.length) : 0,
      };
    });

    const summary = store.getSummary();
    const titleInfo = store.getTitle();
    // 下一关来自本文体自己的解锁链，不再用全局线性指针
    const nextLevelId = progress.nextLevelId || 1;
    const nextLevel = catalog.getLevel(nextLevelId);
    const nextGroup = groups.find(function (g) {
      return g.levels.some(function (l) { return l.id === nextLevelId; });
    });
    const isNewPlayer = summary.clearedCount === 0;

    // 每个文体只铺自己的档位（唐诗 4 档 / 宋词 3 档 / 古文 4 档），
    // 默认展开「正在闯」的那一档，展开状态按 tier.key 记忆，切 Tab 回来不会全塌。
    const activeTier = groups.findIndex(function (g) {
      return g.levels.some(function (l) { return l.id === nextLevelId; });
    });
    groups.forEach(function (g, index) {
      g.expanded = prevExpanded[g.key] !== undefined ? prevExpanded[g.key] : index === activeTier;
      g.collapsedTip = g.expanded ? '' : ('点开看 ' + g.total + ' 关');
    });

    const genreTabs = GENRE_TABS.map(function (tab) {
      const p = store.getGenreProgress(tab.key);
      return {
        key: tab.key,
        label: tab.label,
        cleared: p.cleared,
        total: p.total,
        percent: p.percent,
        active: tab.key === activeGenre,
      };
    });

    this.setData({
      groups: groups,
      genreTabs: genreTabs,
      activeGenre: activeGenre,
      genreLabel: GENRE_LABEL[activeGenre],
      genreCleared: progress.cleared,
      genreTotal: progress.total,
      summary: summary,
      titleName: titleInfo.name,
      unlocked: state.unlocked,
      totalLevels: total,
      nextLevelId: nextLevelId,
      nextLevelName: nextLevel ? nextLevel.name : '',
      nextLevelTier: nextGroup ? nextGroup.name : '',
      nextEyebrow: progress.cleared === 0 ? '第一关' : '接着闯',
      wrongCount: state.wrongBook.length,
      poemTotal: poemTotal,
      collectedCount: summary.collectedCount,
      collectPercent: poemTotal ? Math.round(summary.collectedCount * 100 / poemTotal) : 0,
      clearedPercent: progress.percent,
      greeting: greetingOf(),
      cheerText: cheerOf(progress.cleared, progress.total),
      isNewPlayer: isNewPlayer,
      today: todayPoemOf(),
      todayTriedFallback: false,
      todayImageFailed: false,
    });
  },

  /** 切换文体 Tab：唐诗 / 宋词 / 古文 各自一套档位与解锁进度 */
  onGenreTap: function (event) {
    const key = event.currentTarget.dataset.genre;
    if (!GENRE_LABEL[key] || key === this.data.activeGenre) return;
    const that = this;
    this.setData({ activeGenre: key, groups: [] }, function () {
      that.refresh();
    });
  },

  /** 收起 / 展开某一档，避免一次铺满首页 */
  onTierTap: function (event) {
    const idx = Number(event.currentTarget.dataset.tier);
    const groups = this.data.groups.map(function (g, i) {
      return Object.assign({}, g, { expanded: i === idx ? !g.expanded : g.expanded });
    });
    groups.forEach(function (g) {
      g.collapsedTip = g.expanded ? '' : ('点开看 ' + g.total + ' 关');
    });
    this.setData({ groups: groups });
  },

  /** 今日一诗缩略图：内联数据失败时切包内路径，再失败显示诗字签 */
  onTodayImageError: function () {
    if (this.data.todayTriedFallback || !this.data.today || !this.data.today.fallback) {
      this.setData({ todayImageFailed: true });
      return;
    }
    const today = Object.assign({}, this.data.today, { image: this.data.today.fallback, isReal: false, credit: '' });
    this.setData({ today: today, todayTriedFallback: true });
  },

  onLevelTap: function (event) {
    const id = Number(event.currentTarget.dataset.id);
    const status = event.currentTarget.dataset.status;
    if (status === 'locked') {
      wx.showToast({ title: '先过前面的关卡，就轮到它啦', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/quiz/quiz?levelId=' + id });
  },

  startNext: function () {
    wx.navigateTo({ url: '/pages/quiz/quiz?levelId=' + this.data.nextLevelId });
  },

  goTodayPoem: function () {
    if (!this.data.today) return;
    wx.navigateTo({ url: '/pages/poem/poem?poemId=' + this.data.today.id });
  },

  goLibrary: function () {
    wx.navigateTo({ url: '/pages/library/library' });
  },

  goSignAlbum: function () {
    wx.navigateTo({ url: '/pages/library/library?filter=collected' });
  },

  goWrong: function () {
    wx.navigateTo({ url: '/pages/wrong/wrong' });
  },

  goProfile: function () {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goSettings: function () {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
});
