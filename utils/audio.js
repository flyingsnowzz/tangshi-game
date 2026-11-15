/**
 * 轻量国风音效与背景音。
 *
 * 两条播放通道，按运行环境自动选：
 *  1) 微信真机：wx.createInnerAudioContext 播放工程内 /assets/audio/*.wav
 *  2) 内置 H5 预览器：浏览器没有 wx 音频能力，改用 Web Audio 合成五声音阶
 *     的极短音，让「答题音效 / 背景音乐」开关在预览里也能立刻听出差别。
 *
 * 之前只有一个静默降级的 wx 通道，预览器里切开关毫无反馈，看起来就像
 * 「设置没生效」。现在预览器也能真出声，同时设置页给了可见状态与试听按钮。
 *
 * 所有外部能力都做检测 + 异常隔离，音效永远只是「可失败的装饰」，
 * 绝不因为环境缺 API 中断业务流程（例如答题页 finish 的页面跳转）。
 */
const { getSettings } = require('./store.js');
const { bgm: bgmConfig } = require('./audio-config.js');
const bgmData = require('./bgm-data.js');

const AUDIO_DIR = '/assets/audio/';
const BGM_LOCAL = AUDIO_DIR + 'bgm.mp3';

let sfxCtx = null;
let bgmCtx = null;
let bgmActive = false;
let webCtx = null;
let bgmTimer = null;
let bgmStep = 0;
let webAudioEl = null; // 预览器里直接播远程真实 MP3 的 <audio> 元素

// 五声音阶（宫商角徵羽）：答对上扬、答错低沉、过关是一串小旋律
const SFX_NOTES = {
  correct: [{ f: 523.25, d: 0.09 }, { f: 659.25, d: 0.13 }],
  wrong: [{ f: 220.00, d: 0.24 }],
  clear: [
    { f: 523.25, d: 0.10 }, { f: 659.25, d: 0.10 },
    { f: 783.99, d: 0.10 }, { f: 1046.50, d: 0.24 },
  ],
};
const BGM_NOTES = [261.63, 293.66, 329.63, 392.00, 440.00, 392.00, 329.63, 293.66];

function callWx(name, arg) {
  try {
    if (typeof wx === 'undefined' || typeof wx[name] !== 'function') return false;
    wx[name](arg || {});
    return true;
  } catch (e) {
    return false;
  }
}

function currentSettings() {
  try {
    const settings = getSettings();
    return settings || { sfx: true, bgm: true };
  } catch (e) {
    return { sfx: true, bgm: true };
  }
}

/* ---------------- 环境判定 ---------------- */

function webCtor() {
  try {
    const G = typeof globalThis !== 'undefined' ? globalThis : null;
    return G ? (G.AudioContext || G.webkitAudioContext) || null : null;
  } catch (e) {
    return null;
  }
}

function hasWxAudio() {
  return typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function';
}

function webAudioCtx() {
  const Ctor = webCtor();
  if (!Ctor) return null;
  if (!webCtx) {
    try { webCtx = new Ctor(); } catch (e) { return null; }
  }
  // 浏览器自动播放策略会让上下文处于 suspended，用户手势后需要恢复
  if (webCtx && webCtx.state === 'suspended' && typeof webCtx.resume === 'function') {
    try { webCtx.resume(); } catch (e) { /* ignore */ }
  }
  return webCtx;
}

/* ---------------- 预览器通道：Web Audio 合成音 ---------------- */

function webTone(ctx, freq, at, dur, peak) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  } catch (e) { /* 单个音符失败不影响答题 */ }
}

function webPlay(name) {
  const ctx = webAudioCtx();
  if (!ctx) return false;
  const notes = SFX_NOTES[name] || SFX_NOTES.correct;
  let at = (typeof ctx.currentTime === 'number') ? ctx.currentTime : 0;
  notes.forEach(function (n) {
    webTone(ctx, n.f, at, n.d, 0.09);
    at += n.d;
  });
  return true;
}

function webBgmSynthStart() {
  const ctx = webAudioCtx();
  if (!ctx) return false;
  const tick = function () {
    const c = webAudioCtx();
    if (!c) return;
    const now = (typeof c.currentTime === 'number') ? c.currentTime : 0;
    webTone(c, BGM_NOTES[bgmStep % BGM_NOTES.length], now, 0.55, 0.022);
    bgmStep += 1;
  };
  tick();
  try { bgmTimer = setInterval(tick, 900); } catch (e) { /* ignore */ }
  return true;
}

/**
 * 预览器背景音乐：必须是**真实乐曲**，不能再合成。
 *
 * 优先级：remoteUrl（部署后配 CDN）→ 内联真实钢琴曲（bgm-data.js）→ 合成音兜底。
 * 之前只有 remoteUrl 与合成音两条路，remoteUrl 没配时就整段变成 900ms 一声的
 * 「嘀」音，听起来完全是音效而不是音乐——这次把真实钢琴曲内联进来治本。
 *
 * 注意区分两种失败：
 *  - 加载失败（onerror，域名没配/404/跨域）→ 换下一个音频源，最后才是合成音；
 *  - 自动播放被浏览器拦截（play() 返回 rejected）→ **不能**退化成合成音，
 *    否则用户第一次听到的还是提示音。这里挂一次性手势监听，等用户一碰屏幕就续播。
 */
let gestureBound = false;

function bindGestureRetry() {
  if (gestureBound) return;
  const doc = (typeof document !== 'undefined') ? document : null;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  gestureBound = true;
  const kick = function () {
    try {
      doc.removeEventListener('touchstart', kick, true);
      doc.removeEventListener('click', kick, true);
    } catch (e) { /* ignore */ }
    gestureBound = false;
    if (!bgmActive) return;
    webAudioCtx();
    if (webAudioEl) {
      try {
        const p = webAudioEl.play();
        if (p && typeof p.catch === 'function') p.catch(function () { /* 仍被拦就等下一次手势 */ });
      } catch (e) { /* ignore */ }
    }
  };
  try {
    doc.addEventListener('touchstart', kick, true);
    doc.addEventListener('click', kick, true);
  } catch (e) {
    gestureBound = false;
  }
}

function webBgmPlay(src, isRemote) {
  if (!src || typeof Audio === 'undefined') return false;
  try {
    webAudioEl = new Audio(src);
    webAudioEl.loop = true;
    webAudioEl.volume = isRemote ? 0.45 : 0.5;
    webAudioEl.onerror = function () {
      webAudioEl = null;
      // 远程地址失败（域名没配/404/跨域）→ 换内联真实音频；内联也失败才用合成音
      if (isRemote && bgmData && bgmData.dataUri) { webBgmPlay(bgmData.dataUri, false); return; }
      webBgmSynthStart();
    };
    const pr = webAudioEl.play();
    if (pr && typeof pr.catch === 'function') {
      // 自动播放被拦：保住真音频，等用户下一次触摸再续播，绝不换成合成音
      pr.catch(function () { bindGestureRetry(); });
    }
    return true;
  } catch (e) {
    webAudioEl = null;
    return false;
  }
}

function webBgmStart() {
  if (!webAudioCtx()) return false;
  if (bgmConfig && bgmConfig.remoteUrl && webBgmPlay(bgmConfig.remoteUrl, true)) return true;
  if (bgmData && bgmData.dataUri && webBgmPlay(bgmData.dataUri, false)) return true;
  return webBgmSynthStart();
}

function webBgmStop() {
  if (webAudioEl) {
    try { webAudioEl.pause(); } catch (e) { /* ignore */ }
    webAudioEl = null;
  }
  if (bgmTimer) {
    try { clearInterval(bgmTimer); } catch (e) { /* ignore */ }
    bgmTimer = null;
  }
}

/* ---------------- 微信真机通道：本地 WAV ---------------- */

function wxPlay(name) {
  try {
    if (!hasWxAudio()) return false;
    if (!sfxCtx) {
      sfxCtx = wx.createInnerAudioContext();
      if (typeof sfxCtx.onError === 'function') sfxCtx.onError(function () {});
    }
    sfxCtx.stop();
    sfxCtx.src = AUDIO_DIR + name + '.wav';
    sfxCtx.play();
    return true;
  } catch (e) {
    return false;
  }
}

function wxBgmStart() {
  try {
    if (!hasWxAudio()) return false;
    if (!bgmCtx) {
      bgmCtx = wx.createInnerAudioContext();
      bgmCtx.loop = true;
      bgmCtx.volume = 0.45;
      // 远程真实音乐优先；没配或加载失败则回退包内同一首真实钢琴曲
      var useRemote = !!(bgmConfig && bgmConfig.remoteUrl);
      bgmCtx.src = useRemote ? bgmConfig.remoteUrl : BGM_LOCAL;
      if (typeof bgmCtx.onError === 'function') {
        bgmCtx.onError(function () {
          // 远程失败：仅一次回退到包内真实音频，避免 onError 死循环
          if (useRemote && bgmCtx) {
            try {
              if (typeof bgmCtx.offError === 'function') bgmCtx.offError();
              bgmCtx.loop = true;
              bgmCtx.volume = 0.45;
              bgmCtx.src = BGM_LOCAL;
              bgmCtx.play();
            } catch (e) { /* ignore */ }
          }
        });
      }
    }
    bgmCtx.play();
    return true;
  } catch (e) {
    return false;
  }
}

function wxBgmStop() {
  if (bgmCtx) {
    try { bgmCtx.stop(); } catch (e) { /* ignore */ }
  }
}

/* ---------------- 对外接口 ---------------- */

function play(name) {
  const settings = currentSettings();
  if (!settings.sfx) return false;
  callWx('vibrateShort', { type: 'light', fail: function () {} });
  // 预览器里 wx 音频 API 可能是「存在但不出声」的 stub，所以浏览器环境
  // 一律优先用合成音；微信真机没有 AudioContext，自然走 WAV 通道。
  if (webCtor()) return webPlay(name);
  return wxPlay(name);
}

function playCorrect() { return play('correct'); }
function playWrong() { return play('wrong'); }
function playClear() { return play('clear'); }

/**
 * 幂等地同步背景音乐：app.onShow / 首页 refresh 会反复调用，
 * 状态没变时不重复起播，避免多个循环叠在一起。
 */
function setBgm(enabled) {
  const on = !!enabled;
  if (bgmActive === on) {
    if (on && webCtor()) webAudioCtx(); // 从后台回来时恢复被挂起的上下文
    return;
  }
  bgmActive = on;
  if (!on) {
    webBgmStop();
    wxBgmStop();
    return;
  }
  if (webCtor()) webBgmStart();
  else wxBgmStart();
}

function syncBgm() {
  setBgm(currentSettings().bgm);
}

/** 设置页「听一段背景音乐」：无视开关强制重起一次，方便现场确认听到的是真乐曲 */
function tryBgm(seconds) {
  webBgmStop();
  wxBgmStop();
  bgmActive = false;
  const started = webCtor() ? webBgmStart() : wxBgmStart();
  bgmActive = true;
  const limit = Number(seconds) > 0 ? Number(seconds) : 8;
  try {
    setTimeout(function () { setBgm(currentSettings().bgm); }, limit * 1000);
  } catch (e) { /* ignore */ }
  return started;
}

module.exports = { playCorrect, playWrong, playClear, setBgm, syncBgm, tryBgm };
