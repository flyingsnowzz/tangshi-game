const catalog = require('../../utils/catalog.js');
const inlineImages = require('../../utils/illustration-data.js');
const store = require('../../utils/store.js');
const order = require('../../utils/poem-order.js');
const { getFontSizes } = require('../../utils/theme.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

createCloudPage({
  data: {
    poem: null,
    authorIntro: '',
    illustration: null,
    illusSrc: '',
    illusFallback: '',
    illusTriedFallback: false,
    illusFailed: false,
    illusReal: false,
    illusCredit: '',
    collected: false,
    poemFs: 42,
    bodyFs: 28,
    seq: 0,
    total: 0,
    hasPrev: false,
    hasNext: false,
    prevId: '',
    nextId: '',
  },

  // 三级兜底：远程真实图（服务器 URL，不打包）→ 包内生成图 → 意象文字签
  applyIllus: function (poemId) {
    const illus = catalog.getIllustration(poemId);
    const real = illus && illus.real ? illus.real : '';
    const bundled = illus ? (inlineImages.get(poemId) || illus.path) : '';
    const src = real || bundled;
    this.setData({
      illustration: illus,
      illusSrc: src,
      // 有远程图时，加载失败先回退到包内生成图；无远程图则直接落到文字签
      illusFallback: real ? bundled : '',
      illusTriedFallback: false,
      // 古文/纯文论无实景照且无包内图：空 src 不会触发 image error，直接走文字签，避免留白
      illusFailed: !src,
      illusReal: !!real,
      illusCredit: illus ? (illus.credit || '') : '',
    });
  },

  onCloudFirst: function (options) {
    const poem = catalog.getPoem(options.poemId);
    if (!poem) {
      wx.showToast({ title: '未找到这首诗', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 500);
      return;
    }
    const nb = order.neighbors(poem.id);
    this.setData({
      poem: poem,
      authorIntro: catalog.getAuthorIntro(poem.author),
      collected: store.getCollected().indexOf(poem.id) >= 0,
      seq: nb.index + 1,
      total: nb.total,
      hasPrev: !!nb.prevId,
      hasNext: !!nb.nextId,
      prevId: nb.prevId || '',
      nextId: nb.nextId || '',
    });
    this.applyIllus(poem.id);
    this.applyFont();
  },

  /** 配图三级降级链：远程真实图 → 包内生成图 → 意象文字签；任何环境都不留空白框 */
  onIllusError: function () {
    if (this.data.illusTriedFallback || !this.data.illusFallback) {
      this.setData({ illusFailed: true });
      return;
    }
    // 真实图加载失败，回退到包内生成图：同时清掉「真实图」标记与出处，避免张冠李戴
    this.setData({
      illusSrc: this.data.illusFallback,
      illusTriedFallback: true,
      illusReal: false,
      illusCredit: '',
    });
  },

  onCloudRefresh: function () {
    this.applyFont();
    if (this.data.poem) {
      this.setData({ collected: store.getCollected().indexOf(this.data.poem.id) >= 0 });
    }
  },

  /** 收进诗签册：只增不删，避免误触把已收集的签弄丢 */
  onToggleCollect: function () {
    const poem = this.data.poem;
    if (!poem) return;
    if (store.getCollected().indexOf(poem.id) >= 0) return;
    store.collectPoem(poem.id);
    this.setData({ collected: true });
    wx.showToast({ title: '已收进诗签册', icon: 'success' });
  },

  /** 上一首 / 下一首：用 redirectTo 替换当前页，连续翻看时堆栈不会无限变深 */
  onPrev: function () {
    if (!this.data.hasPrev) return;
    wx.redirectTo({ url: '/pages/poem/poem?poemId=' + this.data.prevId });
  },

  onNext: function () {
    if (!this.data.hasNext) return;
    wx.redirectTo({ url: '/pages/poem/poem?poemId=' + this.data.nextId });
  },

  applyFont: function () {
    const fonts = getFontSizes();
    this.setData({ poemFs: fonts.poemFs, bodyFs: fonts.bodyFs });
  },
});
