const store = require('../../utils/store.js');
const { setBgm, playCorrect, tryBgm } = require('../../utils/audio.js');
const { getFontSizes } = require('../../utils/theme.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

const LABEL_OF = { bgm: '背景音乐', sfx: '答题音效', hint: '闯关提示' };

const FONT_OPTIONS = [
  { key: 'small', name: '小', desc: '诗句 34' },
  { key: 'normal', name: '中', desc: '诗句 42' },
  { key: 'large', name: '大', desc: '诗句 52' },
];

createCloudPage({
  data: {
    settings: {},
    fontOptions: FONT_OPTIONS,
    previewFs: 42,
  },

  /**
   * 进页面先把本机存档读出来，开关立刻显示真实状态。
   * 否则云端 restore 完成前 settings 是空的，开关会先显示成「全关」，
   * 明明有音乐在放却看着像关着，会让人以为开关坏了。
   */
  onLoad: function () {
    if (!store.isReady()) store.loadGuest();
    this.refresh();
  },

  onCloudRefresh: function () {
    this.refresh();
  },

  refresh: function () {
    this.setData({
      settings: store.getSettings(),
      previewFs: getFontSizes().poemFs,
    });
  },

  /**
   * 开关：整行可点，纯 view 实现。
   * 不用原生 <switch> 的原因——宿主预览层不渲染它，控件会整块消失，
   * 用户就完全没法关音乐（已踩过）。这里用 data-key + 取反，命中区域更大。
   */
  onToggle: function (event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    const next = !store.getSettings()[key];
    store.setSetting(key, next);
    // 切完立刻生效：背景音起/停，音效打开时给一声试听
    if (key === 'bgm') setBgm(next);
    if (key === 'sfx' && next) playCorrect();
    this.refresh();
    // 给一句明确反馈，避免「点了到底关没关」的疑虑
    const label = LABEL_OF[key] || '设置';
    wx.showToast({ title: label + (next ? '已打开' : '已关闭'), icon: 'none' });
  },

  /** 显式试听音效：即使预览器没有 wx 音频能力，也能听出「开」的效果 */
  onTrySfx: function () {
    if (!store.getSettings().sfx) {
      wx.showToast({ title: '答题音效已经关啦，先打开再试听', icon: 'none' });
      return;
    }
    playCorrect();
  },

  /** 试听背景音乐：不受开关限制，先放 10 秒让人确认「这是乐曲不是提示音」 */
  onTryBgm: function () {
    const started = tryBgm(10);
    wx.showToast({
      title: started ? '正在播放背景音乐' : '这台设备暂时放不出声音',
      icon: 'none',
    });
  },

  onFont: function (event) {
    const key = event.currentTarget.dataset.key;
    store.setSetting('fontSize', key);
    this.refresh();
  },

  /** 隐私政策入口：提审必需的用户可访问入口 */
  onOpenPrivacy: function () {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },
});
