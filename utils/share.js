/**
 * 小程序转发分享（统一由 createCloudPage 注入到所有页面）。
 *
 * 微信真机：用户点右上角胶囊转发，或点 open-type="share" 按钮时，
 * 微信会调用页面的 onShareAppMessage，返回值决定卡片标题、落地页与封面图。
 * 没有定义这个函数的页面，转发菜单里「转发给朋友」是灰的 —— 这正是此前
 * 「分享功能不能用」的根因。
 *
 * 内置 H5 预览器不实现微信转发，点分享按钮不会有反应。onShareTap 会在
 * 1.2 秒后判断真实转发有没有被拉起，没有就给一句明确提示，避免用户以为
 * 按钮又坏了。真机里 onShareAppMessage 会被立即调用，因此不会误弹提示。
 */
const store = require('./store.js');
const catalog = require('./catalog.js');
// 只为拿题型数：原文案把玩法数量写死成中文数字，加一种题型就失准。
// question-factory 顶层只定义常量，题库是懒构建的，这里 require 不会提前算题。
const questionFactory = require('./question-factory.js');

// 微信分享卡片封面只认代码包路径 / 本地临时文件 / 网络图片，
// 不能用内联 base64（那是给 <image> 组件绕过预览器路径问题用的）。
// 5:4 专用封面：微信卡片缩略图是 5:4，直接塞 1:1 的吉祥物图会被左右裁掉两边。
const SHARE_IMAGE = '/assets/mascot/share-cover.png';
const HOME_PATH = '/pages/index/index';
const FALLBACK_TITLE = '古诗文闯关 · 一起背古诗文、攒星星、收诗签';

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 阿拉伯数字转中文（只覆盖 1–99，玩法数不会超过这个量级） */
function cnNum(n) {
  if (!(n > 0) || n > 99) return String(n);
  if (n < 10) return CN_DIGITS[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return (ten === 1 ? '' : CN_DIGITS[ten]) + '十' + (one ? CN_DIGITS[one] : '');
}

/** 玩法数 = 题型数，从题型表取，不写死 */
function playTypeCount() {
  try {
    return Object.keys(questionFactory.TYPE_NAMES).length;
  } catch (e) {
    return 0;
  }
}

function routeOf(page) {
  // 真机是 page.route，部分开发工具/预览器只在 __route__ 上给
  return (page && (page.route || page.__route__)) || '';
}

function summaryOf() {
  try {
    return store.isReady() ? store.getSummary() : null;
  } catch (e) {
    return null;
  }
}

function titleNameOf() {
  try {
    return store.isReady() ? store.getTitle().name : '';
  } catch (e) {
    return '';
  }
}

function poemTotalOf() {
  try {
    return catalog.getPoems().length;
  } catch (e) {
    return 0;
  }
}

/** 按当前页面生成转发卡片：不同页面给不同文案，落地页尽量留在对方能直接看懂的地方 */
function build(page) {
  const route = routeOf(page);
  const data = (page && page.data) || {};
  const summary = summaryOf();
  const cleared = summary ? (summary.clearedCount || 0) : 0;
  let title = FALLBACK_TITLE;
  let path = HOME_PATH;

  if (route.indexOf('pages/result/') >= 0) {
    const levelId = Number(data.levelId) || 1;
    const stars = Number(data.stars) || 1;
    const levelName = data.levelName || '这一关';
    title = '我在「古诗文闯关」第 ' + levelId + ' 关「' + levelName + '」拿了 ' + stars + ' 颗星，来比一比！';
  } else if (route.indexOf('pages/poem/') >= 0 && data.poem) {
    title = '《' + data.poem.title + '》· ' + data.poem.author + ' —— 一起读读这一篇';
    path = '/pages/poem/poem?poemId=' + data.poem.id;
  } else if (route.indexOf('pages/profile/') >= 0) {
    const titleName = titleNameOf();
    title = titleName
      ? ('我是「' + titleName + '」，已经闯过 ' + cleared + ' 关古诗文，来一起玩吧！')
      : ('古诗文闯关 · 已经闯过 ' + cleared + ' 关，来攒星星呀');
  } else if (route.indexOf('pages/quiz/') >= 0) {
    title = '我正在闯「古诗文闯关」，来帮我接下一句！';
  } else if (route.indexOf('pages/wrong/') >= 0) {
    title = '背错的古诗文我都收进错题本啦，一起复习一遍吧';
  } else {
    const total = poemTotalOf();
    const plays = playTypeCount();
    // 中文数字后面不加空格（阿拉伯数字才需要），文案要读起来是一句话
    const playText = plays ? (cnNum(plays) + '种玩法') : '多种玩法';
    title = cleared
      ? ('我已经闯过 ' + cleared + ' 关、背了 ' + total + ' 篇古诗文，来一起玩吧！')
      : (total
        ? ('古诗文闯关 · ' + total + ' 篇古诗文、' + playText + '，来一起背呀')
        : FALLBACK_TITLE);
  }

  return {
    title: title,
    path: path,
    imageUrl: SHARE_IMAGE,
  };
}

/** 转发给朋友：真机由微信调用；这里打标记，供预览器降级判断 */
function appMessage(page) {
  if (page) page._shareTriggered = true;
  return build(page);
}

/** 分享到朋友圈：只能带 query，不能自定义 path，所以仅诗词详情带诗 ID */
function timeline(page) {
  const conf = build(page);
  const data = (page && page.data) || {};
  const isPoem = routeOf(page).indexOf('pages/poem/') >= 0 && !!data.poem;
  return {
    title: conf.title,
    query: isPoem ? ('poemId=' + data.poem.id) : '',
    imageUrl: conf.imageUrl,
  };
}

/** 显式分享按钮的点击兜底：预览器里不实现转发，给一句可执行的提示 */
function tap(page) {
  if (!page) return;
  page._shareTriggered = false;
  setTimeout(function () {
    if (page._shareTriggered) return;
    try {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({
          title: '预览里不能真转发，发布试用版后用微信打开就能分享啦',
          icon: 'none',
          duration: 2600,
        });
      }
    } catch (e) { /* 预览器缺能力时静默 */ }
  }, 1200);
}

module.exports = {
  SHARE_IMAGE: SHARE_IMAGE,
  HOME_PATH: HOME_PATH,
  FALLBACK_TITLE: FALLBACK_TITLE,
  build: build,
  appMessage: appMessage,
  timeline: timeline,
  tap: tap,
};
