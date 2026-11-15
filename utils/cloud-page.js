/**
 * 页面级云端就绪包装器（游客即玩）。
 *
 * 打开小程序不检查登录、不弹登录框：公开题库先就绪，游客进度直接可用。
 * 会话检查只用来决定进度存哪里——有会话走云端 user_progress，没有走本地游客缓冲。
 * 登录/注册只在结算页「保存成绩」时由页面主动触发 onOpenLogin → login-sheet。
 *
 * 页面侧只需提供：
 *   onCloudFirst(options)  首次就绪时执行一次（读取路由参数、生成题目等）
 *   onCloudRefresh()       每次就绪后执行（刷新列表、统计数据、字体档位等）
 * WXML 侧用 authState 渲染 checking / error 两态，ready 时显示业务内容。
 */
const { cloud } = require('./cloud.js');
const catalog = require('./catalog.js');
const store = require('./store.js');
const share = require('./share.js');

function messageOf(error, fallback) {
  return (error && error.message) ? error.message : fallback;
}

function createCloudPage(options) {
  const page = Object.assign({}, options);
  const firstHook = options.onCloudFirst;
  const refreshHook = options.onCloudRefresh;
  const rawOnLoad = options.onLoad;
  const rawOnShow = options.onShow;
  const rawOnHide = options.onHide;
  const rawOnUnload = options.onUnload;

  delete page.onCloudFirst;
  delete page.onCloudRefresh;

  page.data = Object.assign({
    authState: 'checking',
    cloudError: '',
    isGuest: true,
    loginOpen: false,
  }, options.data || {});

  page.onLoad = function (routeOptions) {
    this._cloudOptions = routeOptions || {};
    this._cloudFirstDone = false;
    this._restoreToken = 0;
    if (rawOnLoad) rawOnLoad.call(this, routeOptions);
  };

  page.onShow = function () {
    this.restore();
    if (rawOnShow) rawOnShow.call(this);
  };

  page.onHide = function () {
    if (store.isReady()) store.flush();
    if (rawOnHide) rawOnHide.call(this);
  };

  page.onUnload = function () {
    if (store.isReady()) store.flush();
    if (rawOnUnload) rawOnUnload.call(this);
  };

  /** 内容就绪检查：不因为「未登录」而拦截页面 */
  page.restore = async function () {
    const token = (this._restoreToken || 0) + 1;
    this._restoreToken = token;
    const self = this;
    const alive = function () { return self._restoreToken === token; };

    this.setData({ authState: 'checking', cloudError: '' });
    const catalogTask = catalog.load();

    let session = null;
    try {
      const auth = await getApp().ensureSession();
      if (auth && auth.error) throw auth.error;
      session = auth ? auth.data : null;
    } catch (e) {
      session = null;
    }
    if (!alive()) return;

    const content = await catalogTask;
    if (!alive()) return;
    if (content.error) {
      this.setData({
        authState: 'error',
        cloudError: '题库加载失败：' + messageOf(content.error, '请检查网络后重试'),
      });
      return;
    }

    // 同一会话内不重复拉取，避免覆盖内存中尚未写回的改动
    if (session) {
      if (!store.isReady() || store.isGuest()) {
        const progress = await store.load();
        if (!alive()) return;
        if (progress.error) {
          this.setData({
            authState: 'error',
            cloudError: '进度读取失败：' + messageOf(progress.error, '请检查网络后重试'),
          });
          return;
        }
      }
    } else if (!store.isReady() || !store.isGuest()) {
      store.loadGuest();
    }
    if (!alive()) return;

    this.setData({
      authState: 'ready',
      cloudError: '',
      isGuest: store.isGuest(),
    });
    if (!this._cloudFirstDone) {
      this._cloudFirstDone = true;
      if (firstHook) firstHook.call(this, this._cloudOptions || {});
    }
    if (refreshHook) refreshHook.call(this);
  };

  /* ---- 登录弹层：只由结算页「保存成绩」按钮唤起 ---- */

  page.onOpenLogin = function () {
    this.setData({ loginOpen: true });
  };

  page.onCloseLogin = function () {
    this.setData({ loginOpen: false });
  };

  page.onSignedIn = async function () {
    getApp().resetSession();
    wx.showLoading({ title: '正在保存成绩', mask: true });
    const out = await store.upgradeToCloud();
    wx.hideLoading();
    if (out.error) {
      wx.showToast({ title: '成绩同步失败，稍后再试', icon: 'none' });
    } else {
      wx.showToast({ title: '成绩已保存到云端', icon: 'success' });
    }
    this.setData({ loginOpen: false });
    this.restore();
  };

  page.onCloudRetry = function () {
    getApp().resetSession();
    catalog.load(true);
    this.restore();
  };

  page.onSignOut = function () {
    const self = this;
    wx.showModal({
      title: '退出登录',
      content: '成绩已保存在云端，重新登录就能接着玩。退出后会回到试玩状态。',
      confirmText: '退出',
      cancelText: '取消',
      success: async function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '正在保存', mask: true });
        await store.flush();
        wx.hideLoading();
        await cloud.auth.signOut();
        getApp().resetSession();
        store.resetCache();
        store.loadGuest();
        self.restore();
      },
    });
  };

  /* ---- 转发分享：所有页面统一具备，页面若自定义则保留自定义 ----
   * 不定义 onShareAppMessage 的页面，微信右上角「转发给朋友」是灰的；
   * open-type="share" 按钮也不会生效。这里在包装器里一次补齐 7 个页面。 */
  if (typeof page.onShareAppMessage !== 'function') {
    page.onShareAppMessage = function () { return share.appMessage(this); };
  }
  if (typeof page.onShareTimeline !== 'function') {
    page.onShareTimeline = function () { return share.timeline(this); };
  }
  if (typeof page.onShareTap !== 'function') {
    page.onShareTap = function () { share.tap(this); };
  }

  Page(page);
  return page;
}

module.exports = { createCloudPage };
