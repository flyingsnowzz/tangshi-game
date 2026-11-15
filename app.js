const { syncBgm } = require('./utils/audio.js');
const { cloud } = require('./utils/cloud.js');
const store = require('./utils/store.js');

App({
  globalData: {
    appName: '唐诗闯关',
  },

  /** 全应用共享一次会话检查，登录/退出后由 resetSession 清空 */
  ensureSession: function () {
    if (!this.sessionPromise) {
      this.sessionPromise = cloud.auth.getSession();
    }
    return this.sessionPromise;
  },

  resetSession: function () {
    this.sessionPromise = null;
  },

  onLaunch: function () {
    // 云端写回失败时给一次轻量提示，不阻断本地继续作答
    store.onError(function (error) {
      console.warn('[Tangshi] progress sync failed', (error && error.message) || 'unknown');
      wx.showToast({ title: '进度同步失败，请检查网络', icon: 'none' });
    });
    // 不在启动阶段按默认设置抢跑背景音：此时进度还没加载，getSettings()
    // 只能拿到默认的 bgm:true，会把用户「已关闭」的选择覆盖掉一小会儿。
    // 真正的起播交给首页就绪后的背景音同步。
  },

  onShow: function () {
    // 只有进度已就绪、设置是真实用户值时才同步
    if (store.isReady()) {
      try { syncBgm(); } catch (e) { /* ignore */ }
    }
  },
});
