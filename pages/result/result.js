const catalog = require('../../utils/catalog.js');
const inlineImages = require('../../utils/illustration-data.js');
const store = require('../../utils/store.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

createCloudPage({
  data: {
    levelId: 1,
    levelName: '',
    levelTier: '',
    stars: 1,
    gained: 0,
    wrongCount: 0,
    total: 0,
    points: 0,
    message: '',
    hasNext: false,
    nextLevelName: '',
    allCleared: false,
    newSigns: [],
    signCount: 0,
    collectedCount: 0,
  },

  onCloudFirst: function (options) {
    const levelId = Number(options.levelId) || 1;
    const stars = Number(options.stars) || 1;
    const gained = Number(options.gained) || 0;
    const wrongCount = Number(options.wrongCount) || 0;
    const total = Number(options.total) || 0;
    const totalLevels = catalog.getTotalLevels();
    const level = catalog.getLevel(levelId);
    // 「下一关」只在同一文体内串（唐诗末关不该一键跳进宋词首关），
    // 跨文体换赛道交给首页的文体 Tab。
    const nextLevelId = levelId + 1;
    const candidates = catalog.getLevel(nextLevelId);
    const genreNow = (level && level.genre) || 'shi';
    const sameGenre = !!candidates && ((candidates.genre || 'shi') === genreNow);
    const hasNext = sameGenre && nextLevelId <= totalLevels && store.isUnlocked(nextLevelId);
    const nextLevel = hasNext ? candidates : null;
    const summary = store.getSummary();

    let message = '继续加油，星星还能攒满';
    if (stars === 3) message = '一次全对，太厉害啦！';
    else if (stars === 2) message = '只差一点点，再试一次就满星';

    // 本关新收集的诗签，展示前三张意象图
    const ids = String(options.signs || '').split(',').filter(Boolean);
    const newSigns = ids.slice(0, 3).map(function (id) {
      const illus = catalog.getIllustration(id);
      if (!illus) return null;
      const real = illus.real || '';
      const bundled = inlineImages.get(id) || illus.path;
      return Object.assign({}, illus, {
        src: real || bundled,
        fallback: real ? bundled : illus.path,
        isReal: !!real,
        credit: illus.credit || '',
        triedFallback: false,
        failed: false,
      });
    }).filter(Boolean);

    this.setData({
      levelId: levelId,
      levelName: level ? level.name : '',
      levelTier: level ? catalog.getTierByIndex(level.tier).name : '',
      stars: stars,
      gained: gained,
      wrongCount: wrongCount,
      total: total,
      points: summary.points,
      message: message,
      hasNext: hasNext,
      nextLevelName: nextLevel ? nextLevel.name : '',
      allCleared: summary.clearedCount >= totalLevels,
      newSigns: newSigns,
      signCount: ids.length,
      collectedCount: summary.collectedCount,
    });
  },

  /** 诗签缩略图：内联数据 → 包内路径 → 「诗」字签 */
  onSignImageError: function (event) {
    const idx = Number(event.currentTarget.dataset.idx);
    const item = this.data.newSigns[idx];
    if (!item) return;
    const patch = {};
    if (!item.fallback || item.triedFallback) {
      patch['newSigns[' + idx + '].failed'] = true;
    } else {
      patch['newSigns[' + idx + '].src'] = item.fallback;
      patch['newSigns[' + idx + '].triedFallback'] = true;
      patch['newSigns[' + idx + '].isReal'] = false;
      patch['newSigns[' + idx + '].credit'] = '';
    }
    this.setData(patch);
  },

  /** 登录成功后 restore 会再次触发，刷新游客/云端标识与累计积分 */
  onCloudRefresh: function () {
    this.setData({
      isGuest: store.isGuest(),
      points: store.getSummary().points,
    });
  },

  replay: function () {
    wx.redirectTo({ url: '/pages/quiz/quiz?levelId=' + this.data.levelId });
  },

  next: function () {
    if (!this.data.hasNext) return;
    wx.redirectTo({ url: '/pages/quiz/quiz?levelId=' + (this.data.levelId + 1) });
  },

  goWrong: function () {
    wx.navigateTo({ url: '/pages/wrong/wrong' });
  },

  goHome: function () {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
