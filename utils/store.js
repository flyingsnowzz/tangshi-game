/**
 * 用户进度模型（云托管 + 游客即玩）。
 *
 * 打开小程序不要求登录：游客可以完整答题、通关，成绩先写进本地缓冲 GUEST_KEY。
 * 只有用户在结算页点「登录并保存成绩」时，才 upgradeToCloud() 把游客期进度与
 * 云端已有进度合并写入 user_progress（按 owner_id RLS 隔离）。
 * 已登录状态下，写操作在内存立即生效，由防抖 flush() 串行写回云端。
 */
const { cloud } = require('./cloud.js');
const catalog = require('./catalog.js');

const TABLE = 'user_progress';
const GUEST_KEY = 'tangshi_guest_state_v1';
const FLUSH_DELAY = 600;

let mode = 'guest';      // 'guest' | 'cloud'
let cached = null;       // 内存中的完整 state
let rowId = null;        // 云端进度行 id
let flushTimer = null;
let serial = Promise.resolve();
let errorHandler = null;

function totalLevels() {
  // 与云端 game_catalog.levels 的关卡总数一致；仅在目录尚未就绪时兜底
  return catalog.getTotalLevels() || 40;
}

/* ---------------- 分轨（唐诗 / 宋词 / 古文）---------------- */

const GENRES = ['shi', 'ci', 'wen'];

/** 某个文体在关卡序列里的首关 / 末关 id，用于给解锁指针划边界 */
function genreRange(genre) {
  const levels = catalog.getLevels(genre) || [];
  let first = null;
  let last = null;
  levels.forEach(function (lv) {
    if (first === null || lv.id < first) first = lv.id;
    if (last === null || lv.id > last) last = lv.id;
  });
  return { first: first, last: last };
}

function genreOfLevel(levelId) {
  const lv = catalog.getLevel(levelId);
  return (lv && lv.genre) || 'shi';
}

/**
 * 分轨解锁指针：每个文体各自一条「解锁到第几关」，互不牵连。
 * 旧快照只有全局 unlocked（线性指针），这里按线性假设推导各文体起点：
 * 指针已越过某文体范围 → 该文体视为全解锁；否则默认可玩首关。
 */
function normalizeUnlockedBy(rawMap, legacyUnlocked) {
  const src = (rawMap && typeof rawMap === 'object') ? rawMap : {};
  const legacy = Math.max(1, Number(legacyUnlocked) || 1);
  const out = {};
  GENRES.forEach(function (g) {
    const range = genreRange(g);
    if (range.first === null) return;
    let value = Number(src[g]);
    if (!value) {
      value = legacy >= range.first ? Math.min(legacy, range.last + 1) : range.first;
    }
    out[g] = Math.max(range.first, Math.min(value, range.last + 1));
  });
  return out;
}

/** 某文体的通关进度与「下一关」；下一关永远落在该文体自己的序列里 */
function getGenreProgress(genre) {
  const levels = catalog.getLevels(genre) || [];
  const state = getState();
  const by = (state.unlockedBy || {})[genre] || 0;
  let cleared = 0;
  let next = null;
  levels.forEach(function (lv) {
    const record = state.levels[String(lv.id)];
    if (record && record.cleared) {
      cleared += 1;
      return;
    }
    if (next === null && by && lv.id <= by) next = lv.id;
  });
  if (next === null && levels.length) {
    // 全部通关 → 回到该文体最后一关再刷一次；指针异常落后 → 回到首关兜底
    next = cleared >= levels.length ? levels[levels.length - 1].id : levels[0].id;
  }
  return {
    total: levels.length,
    cleared: cleared,
    percent: levels.length ? Math.round(cleared * 100 / levels.length) : 0,
    nextLevelId: next,
    unlockedTo: by,
  };
}

function defaultState() {
  return {
    version: 4,
    unlocked: 1,
    unlockedBy: {},
    levels: {},
    wrongBook: [],
    collected: [],
    stats: {
      totalAnswers: 0,
      firstCorrect: 0,
      totalQuestions: 0,
      points: 0,
      clearedCount: 0,
      fullStarCount: 0,
    },
    settings: {
      bgm: true,
      sfx: true,
      fontSize: 'normal',
      hint: true,
    },
  };
}

/** 快照可能来自旧版本或游客缓冲，统一补齐缺省字段 */
function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const merged = Object.assign({}, base, raw);
  merged.stats = Object.assign({}, base.stats, raw.stats || {});
  merged.settings = Object.assign({}, base.settings, raw.settings || {});
  merged.levels = (raw.levels && typeof raw.levels === 'object') ? raw.levels : {};
  merged.wrongBook = Array.isArray(raw.wrongBook) ? raw.wrongBook : [];
  merged.collected = Array.isArray(raw.collected) ? raw.collected : [];
  merged.unlocked = Math.max(1, Math.min(totalLevels(), Number(raw.unlocked) || 1));
  merged.unlockedBy = normalizeUnlockedBy(raw.unlockedBy, merged.unlocked);
  merged.version = base.version;
  return merged;
}

function isReady() { return !!cached; }
function isGuest() { return mode === 'guest'; }

/* ---------------- 游客模式 ---------------- */

function saveGuest(state) {
  try { wx.setStorageSync(GUEST_KEY, state); } catch (e) { /* 存储不可用时仅保留在内存 */ }
}

function loadGuest() {
  let raw = null;
  try { raw = wx.getStorageSync(GUEST_KEY); } catch (e) { raw = null; }
  cached = normalize(raw);
  mode = 'guest';
  rowId = null;
  return { error: null };
}

/* ---------------- 云端模式 ---------------- */

async function load() {
  let res;
  try {
    res = await cloud.database.from(TABLE).select('id, state').maybeSingle();
  } catch (e) {
    return { error: { message: (e && e.message) || '进度读取失败，请检查网络' } };
  }
  if (res.error) return { error: res.error };
  rowId = res.data ? res.data.id : null;
  cached = normalize(res.data ? res.data.state : null);
  mode = 'cloud';
  return { error: null };
}

/** 把当前内存快照写回目标存储；串行执行，避免并发写互相覆盖 */
function flush() {
  if (!cached) return Promise.resolve({ error: { message: '进度尚未就绪' } });
  if (mode === 'guest') {
    saveGuest(cached);
    return Promise.resolve({ error: null });
  }
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const snapshot = JSON.parse(JSON.stringify(cached));

  const run = serial.then(async function () {
    let res;
    try {
      if (rowId != null) {
        res = await cloud.database
          .from(TABLE).update({ state: snapshot }).eq('id', rowId).select('id');
      } else {
        res = await cloud.database
          .from(TABLE).insert({ state: snapshot }).select('id');
      }
    } catch (e) {
      return { error: { message: (e && e.message) || '进度同步失败，请检查网络' } };
    }
    if (res.error) return { error: res.error };
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) return { error: { message: '进度未保存，请重新登录后再试' } };
    rowId = rows[0].id;
    return { error: null };
  });

  serial = run.then(function () { return null; }, function () { return null; });
  return run;
}

function scheduleFlush() {
  if (mode === 'guest') return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(function () {
    flushTimer = null;
    flush().then(function (out) {
      if (out.error && errorHandler) errorHandler(out.error);
    });
  }, FLUSH_DELAY);
}

function onError(handler) { errorHandler = handler; }

/**
 * 合并两份进度：成绩取双方较优，累计计数取最大值避免两段游玩重复计分。
 * 云端为底、游客为增量；设置项只在游客期确实改过时才覆盖云端偏好。
 */
function mergeState(guestRaw, cloudRaw) {
  const base = defaultState();
  const out = normalize(cloudRaw);
  const guest = normalize(guestRaw);

  out.unlocked = Math.max(out.unlocked, guest.unlocked, 1);
  out.unlockedBy = out.unlockedBy || {};
  Object.keys(guest.unlockedBy || {}).forEach(function (g) {
    out.unlockedBy[g] = Math.max(out.unlockedBy[g] || 0, guest.unlockedBy[g] || 0);
  });

  const keys = {};
  Object.keys(out.levels).forEach(function (k) { keys[k] = true; });
  Object.keys(guest.levels).forEach(function (k) { keys[k] = true; });
  Object.keys(keys).forEach(function (k) {
    const a = out.levels[k];
    const b = guest.levels[k];
    if (!a) { out.levels[k] = b; return; }
    if (!b) return;
    out.levels[k] = {
      cleared: !!(a.cleared || b.cleared),
      stars: Math.max(a.stars || 0, b.stars || 0),
      bestWrong: Math.min(
        a.bestWrong === undefined ? 999 : a.bestWrong,
        b.bestWrong === undefined ? 999 : b.bestWrong
      ),
      plays: (a.plays || 0) + (b.plays || 0),
    };
  });

  ['totalAnswers', 'firstCorrect', 'totalQuestions', 'points'].forEach(function (k) {
    out.stats[k] = Math.max(out.stats[k] || 0, guest.stats[k] || 0);
  });
  let clearedCount = 0;
  let fullStarCount = 0;
  Object.keys(out.levels).forEach(function (k) {
    if (out.levels[k].cleared) clearedCount += 1;
    if (out.levels[k].stars === 3) fullStarCount += 1;
  });
  out.stats.clearedCount = clearedCount;
  out.stats.fullStarCount = fullStarCount;

  const wrongMap = {};
  out.wrongBook.forEach(function (item) { wrongMap[item.signature] = item; });
  guest.wrongBook.forEach(function (item) {
    const cur = wrongMap[item.signature];
    if (!cur) { wrongMap[item.signature] = item; return; }
    cur.wrongCount = Math.max(cur.wrongCount || 1, item.wrongCount || 1);
    cur.lastAt = Math.max(cur.lastAt || 0, item.lastAt || 0);
  });
  out.wrongBook = Object.keys(wrongMap)
    .map(function (k) { return wrongMap[k]; })
    .sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); })
    .slice(0, 100);

  const collected = {};
  out.collected.concat(guest.collected).forEach(function (id) { collected[id] = true; });
  out.collected = Object.keys(collected);

  const changed = Object.keys(base.settings).some(function (k) {
    return guest.settings[k] !== base.settings[k];
  });
  if (changed) out.settings = Object.assign({}, out.settings, guest.settings);

  return out;
}

/** 结算页登录成功后调用：读云端 → 合并游客缓冲 → 写回 → 清空缓冲 */
async function upgradeToCloud() {
  const guestSnapshot = cached ? JSON.parse(JSON.stringify(cached)) : null;
  const previousMode = mode;
  const loaded = await load();
  if (loaded.error) {
    mode = previousMode;
    if (guestSnapshot) cached = guestSnapshot;
    return loaded;
  }
  if (guestSnapshot) cached = mergeState(guestSnapshot, cached);
  const saved = await flush();
  if (saved.error) return saved;
  try { wx.removeStorageSync(GUEST_KEY); } catch (e) { /* ignore */ }
  return { error: null, merged: !!guestSnapshot };
}

function resetCache() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  cached = null;
  rowId = null;
  mode = 'guest';
  serial = Promise.resolve();
}

/* ---------------- 同步读写接口（页面沿用） ---------------- */

function getState() { return cached || defaultState(); }

function update(mutator) {
  const state = getState();
  mutator(state);
  cached = state;
  if (mode === 'guest') saveGuest(state);
  else scheduleFlush();
  return state;
}

function getSettings() { return getState().settings; }

function setSetting(key, value) {
  return update(function (state) { state.settings[key] = value; });
}

function getLevelRecord(levelId) {
  return getState().levels[String(levelId)] || null;
}

function isUnlocked(levelId) {
  const id = Number(levelId);
  // 分轨后每个文体各走各的解锁链：唐诗1 / 宋词41 / 古文53 都能直接从首关起步，
  // 不必线性打通前 52 关才有资格碰古文（否则分轨等于没上线）。
  const genre = genreOfLevel(id);
  const by = getState().unlockedBy || {};
  if (by[genre]) return id <= by[genre];
  if (id <= getState().unlocked) return true;
  const firsts = catalog.getFirstLevelIds ? catalog.getFirstLevelIds() : [];
  return firsts.indexOf(id) >= 0;
}

/** 记录一道错题，按 signature 去重并累计错误次数 */
function recordWrong(question) {
  update(function (state) {
    const found = state.wrongBook.find(function (item) {
      return item.signature === question.signature;
    });
    if (found) {
      found.wrongCount += 1;
      found.lastAt = Date.now();
      found.question = question;
    } else {
      state.wrongBook.unshift({
        signature: question.signature,
        question: question,
        wrongCount: 1,
        lastAt: Date.now(),
      });
    }
    if (state.wrongBook.length > 100) state.wrongBook.length = 100;
  });
}

function removeWrong(signature) {
  update(function (state) {
    state.wrongBook = state.wrongBook.filter(function (item) {
      return item.signature !== signature;
    });
  });
}

function clearWrong() {
  update(function (state) { state.wrongBook = []; });
}

function getWrongBook() { return getState().wrongBook; }

/** 诗签收集：每首诗只记一次，用于首页展示收集进度 */
function collectPoem(poemId) {
  if (!poemId) return false;
  const state = getState();
  if (state.collected.indexOf(poemId) >= 0) return false;
  update(function (s) { s.collected.push(poemId); });
  return true;
}

function getCollected() { return getState().collected; }

function calcStars(wrongCount) {
  if (wrongCount === 0) return 3;
  if (wrongCount <= 2) return 2;
  return 1;
}

/** 关卡通关结算；结果先落内存，由调用方在跳转前 flush */
function completeLevel(result) {
  const level = catalog.getLevel(result.levelId);
  const stars = calcStars(result.wrongCount);
  const gained = result.firstCorrect * 10 + (level ? level.count * 5 : 0) + (stars === 3 ? 20 : 0);

  update(function (state) {
    const key = String(result.levelId);
    const old = state.levels[key] || { stars: 0, bestWrong: 999, plays: 0 };
    state.levels[key] = {
      cleared: true,
      stars: Math.max(old.stars || 0, stars),
      bestWrong: Math.min(old.bestWrong === undefined ? 999 : old.bestWrong, result.wrongCount),
      plays: (old.plays || 0) + 1,
    };
    const limit = totalLevels();
    const levelId = Number(result.levelId);
    // 只推进本文体自己的解锁指针，别让唐诗的通关记录顺手把宋词/古文也开了
    const genre = genreOfLevel(levelId);
    const range = genreRange(genre);
    if (!state.unlockedBy) state.unlockedBy = {};
    const current = state.unlockedBy[genre] || range.first || 1;
    if (levelId >= current) {
      state.unlockedBy[genre] = range.last === null
        ? levelId + 1
        : Math.min(levelId + 1, range.last + 1);
    }
    if (levelId >= state.unlocked && state.unlocked < limit) {
      state.unlocked = levelId + 1;
    }
    state.stats.totalAnswers += result.totalQuestions + result.wrongCount;
    state.stats.firstCorrect += result.firstCorrect;
    state.stats.totalQuestions += result.totalQuestions;
    state.stats.points += gained;
    let clearedCount = 0;
    let fullStarCount = 0;
    Object.keys(state.levels).forEach(function (k) {
      if (state.levels[k].cleared) clearedCount += 1;
      if (state.levels[k].stars === 3) fullStarCount += 1;
    });
    state.stats.clearedCount = clearedCount;
    state.stats.fullStarCount = fullStarCount;
  });

  return { stars: stars, gained: gained };
}

/** 阶梯称号：门槛按云端关卡总数动态计算，扩容关卡后不用再改这里 */
const TITLES = [
  { name: '诗词萌新', desc: '刚翻开第一卷诗书，出发啦' },
  { name: '背诗小能手', desc: '已经记住好几首名篇啦' },
  { name: '唐诗小达人', desc: '闯过不少关，还拿了一串满星' },
  { name: '诗词小状元', desc: '全部关卡通关，诗社里的头名' },
];

function titleList() {
  const total = totalLevels();
  return TITLES.map(function (item, index) {
    let needCleared = 0;
    let needFullStar = 0;
    if (index === 1) needCleared = Math.max(2, Math.round(total * 0.08));
    if (index === 2) {
      needCleared = Math.max(4, Math.round(total * 0.3));
      needFullStar = Math.max(2, Math.round(total * 0.12));
    }
    if (index === 3) {
      needCleared = total;
      needFullStar = Math.max(3, Math.round(total * 0.25));
    }
    return Object.assign({}, item, { needCleared: needCleared, needFullStar: needFullStar });
  });
}

function getTitle() {
  const stats = getState().stats;
  const tiers = titleList();
  let current = tiers[0];
  let index = 0;
  tiers.forEach(function (item, i) {
    if (stats.clearedCount >= item.needCleared && stats.fullStarCount >= item.needFullStar) {
      current = item;
      index = i;
    }
  });
  const next = tiers[index + 1] || null;
  let progress = 100;
  if (next) {
    const clearedPart = next.needCleared ? Math.min(1, stats.clearedCount / next.needCleared) : 1;
    if (next.needFullStar) {
      const starPart = Math.min(1, stats.fullStarCount / next.needFullStar);
      progress = Math.round(((clearedPart + starPart) / 2) * 100);
    } else {
      progress = Math.round(clearedPart * 100);
    }
  }
  return {
    name: current.name,
    desc: current.desc,
    next: next,
    progress: progress,
    tiers: tiers,
    currentIndex: index,
  };
}

function getSummary() {
  const state = getState();
  const s = state.stats;
  const rate = s.totalAnswers ? Math.round((s.firstCorrect / s.totalAnswers) * 100) : 0;
  return {
    clearedCount: s.clearedCount,
    totalLevels: totalLevels(),
    totalAnswers: s.totalAnswers,
    totalQuestions: s.totalQuestions,
    firstCorrect: s.firstCorrect,
    accuracy: rate,
    points: s.points,
    fullStarCount: s.fullStarCount,
    wrongCount: state.wrongBook.length,
    collectedCount: state.collected.length,
    unlocked: state.unlocked,
  };
}

function resetAll() {
  const keepSettings = Object.assign({}, getState().settings);
  // 走一遍 normalize，确保分轨解锁指针按当前目录重新推导（各文体首关可玩）
  const fresh = normalize(null);
  fresh.settings = keepSettings;
  cached = fresh;
  if (mode === 'guest') saveGuest(fresh);
  else scheduleFlush();
  return fresh;
}

module.exports = {
  isReady,
  isGuest,
  loadGuest,
  load,
  upgradeToCloud,
  mergeState,
  flush,
  onError,
  resetCache,
  getState,
  getSettings,
  setSetting,
  getLevelRecord,
  isUnlocked,
  genreOfLevel,
  getGenreProgress,
  recordWrong,
  removeWrong,
  clearWrong,
  getWrongBook,
  collectPoem,
  getCollected,
  calcStars,
  completeLevel,
  getTitle,
  getSummary,
  resetAll,
};
