const store = require('../../utils/store.js');
const { setBgm, playCorrect } = require('../../utils/audio.js');
const { getFontSizes } = require('../../utils/theme.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

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

  onCloudRefresh: function () {
    this.refresh();
  },

  refresh: function () {
    this.setData({
      settings: store.getSettings(),
      previewFs: getFontSizes().poemFs,
    });
  },

  onSwitch: function (event) {
    const key = event.currentTarget.dataset.key;
    const value = event.detail.value;
    store.setSetting(key, value);
    // 切完立刻生效：背景音起/停，音效打开时给一声试听
    if (key === 'bgm') setBgm(value);
    if (key === 'sfx' && value) playCorrect();
    this.refresh();
  },

  /** 显式试听：即使预览器没有 wx 音频能力，也能听出「开」的效果 */
  onTrySfx: function () {
    if (!store.getSettings().sfx) {
      wx.showToast({ title: '答题音效已经关啦，先打开再试听', icon: 'none' });
      return;
    }
    playCorrect();
  },

  onFont: function (event) {
    const key = event.currentTarget.dataset.key;
    store.setSetting('fontSize', key);
    this.refresh();
  },
});
