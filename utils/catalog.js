/**
 * 云端内容目录。
 *
 * game_catalog 是显式公开读表：题库 / 作者 / 关卡梯度 / 配图元数据全部存放在这里，
 * 页面与出题引擎只通过本模块读取，不再引用工程内的 data/*.js 静态数据。
 * 内容只在应用生命周期里拉取一次并缓存在内存，失败时返回 { error } 供页面展示。
 */
const { cloud } = require('./cloud.js');

let cache = null;
let loading = null;

function isReady() {
  return !!cache;
}

/** 拉取全部公开内容。force=true 可强制刷新（后台更新题库后重进页面时使用）。 */
function load(force) {
  if (!force && cache) return Promise.resolve({ data: cache, error: null });
  if (!force && loading) return loading;

  const task = (async function () {
    let rows;
    try {
      const res = await cloud.database.from('game_catalog').select('kind, payload');
      if (res.error) return { data: null, error: res.error };
      rows = Array.isArray(res.data) ? res.data : [];
    } catch (e) {
      return { data: null, error: { message: (e && e.message) || '云端内容请求失败' } };
    }

    const map = {};
    rows.forEach(function (row) {
      map[row.kind] = row.payload;
    });

    const levelConfig = map.levels || {};
    if (!Array.isArray(map.poems) || !map.poems.length
      || !Array.isArray(levelConfig.levels) || !levelConfig.levels.length) {
      return { data: null, error: { message: '云端题库或关卡配置为空，请稍后重试' } };
    }

    cache = {
      poems: decoratePoems(map.poems),
      authors: map.authors || {},
      levels: levelConfig.levels,
      tiers: Array.isArray(levelConfig.tiers) ? levelConfig.tiers : [],
      illustrations: map.illustrations || {},
    };
    return { data: cache, error: null };
  })();

  loading = task;
  const clear = function () {
    if (loading === task) loading = null;
  };
  task.then(clear, clear);
  return task;
}

/**
 * 给每首诗派生 displayLines（正文 + 句读）。
 *
 * 云端 poem.lines 存白文，句读单独存 poem.marks（一行一个标点，长度等于行数）。
 * lines 保持白文是因为出题引擎拿它做长度门槛和干扰项池；
 * 展示用 displayLines，详情页「整首诗读一遍」直接 for 这个字段。
 */
function decoratePoems(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (p) {
    if (!p || !Array.isArray(p.lines)) return p;
    const marks = typeof p.marks === 'string' ? p.marks : '';
    const displayLines = p.lines.map(function (line, i) {
      return line + (marks.charAt(i) || '');
    });
    return Object.assign({}, p, { displayLines: displayLines });
  });
}

function reset() {
  cache = null;
  loading = null;
}

/* ---------------- 题库 ---------------- */

/** 取题库；传 genre 时只返回该文体（shi=诗 / ci=词），不传返回全部（兼容旧调用） */
function getPoems(genre) {
  const list = cache ? cache.poems : [];
  if (!genre) return list;
  return list.filter(function (item) { return item.genre === genre || (!item.genre && genre === 'shi'); });
}

function getPoem(id) {
  const list = getPoems();
  return list.find(function (item) { return item.id === id; }) || null;
}

/**
 * 按难度区间取诗；min 省略时从 1 开始，保证高难关卡不会抽到低难诗。
 * 传 genre 时只在该文体内抽题，避免唐诗关抽到宋词（分轨数据正确性）。
 */
function getPoemsByDifficulty(maxDifficulty, minDifficulty, genre) {
  const min = minDifficulty || 1;
  const max = maxDifficulty || 4;
  return getPoems(genre).filter(function (item) {
    return item.difficulty <= max && item.difficulty >= min;
  });
}

function getAuthorIntro(name) {
  const intro = cache ? cache.authors[name] : '';
  return intro || '唐代诗人，生平资料待补充。';
}

/* ---------------- 关卡 ---------------- */

/** 取关卡；传 genre 时只返回该文体。不传返回全部（首页平铺 7 档时用）。 */
function getLevels(genre) {
  const list = cache ? cache.levels : [];
  if (!genre) return list;
  return list.filter(function (item) { return item.genre === genre || (!item.genre && genre === 'shi'); });
}

function getTiers(genre) {
  const list = cache ? cache.tiers : [];
  if (!genre) return list;
  return list.filter(function (item) { return item.genre === genre || (!item.genre && genre === 'shi'); });
}

function getTotalLevels() {
  return getLevels().length;
}

/**
 * 每个文体的首关 id 集合。分轨后唐诗(1)、宋词(41)、古文(53) 应各自可起步，
 * 否则玩家要线性打通前 52 关才能碰到古文，等于没上线。
 */
function getFirstLevelIds() {
  const first = {};
  getLevels().forEach(function (lv) {
    const g = lv.genre || 'shi';
    if (first[g] === undefined || lv.id < first[g]) first[g] = lv.id;
  });
  return Object.keys(first).map(function (g) { return first[g]; });
}

function getLevel(id) {
  return getLevels().find(function (item) { return item.id === Number(id); }) || null;
}

function getTier(key) {
  const tiers = getTiers();
  return tiers.find(function (item) { return item.key === key; }) || tiers[0] || null;
}

function getTierByIndex(index) {
  const tiers = getTiers();
  return tiers[index] || tiers[0] || { name: '古诗文闯关' };
}

/**
 * 关卡按档位分组。传 genre 时只看该文体。
 * 用 tier 值直接对应 tiers 数组下标（tiers 顺序即 0..N-1），
 * 这样宋词 tier=4/5/6 也能正确找到第 5/6/7 个 tier 配置。
 */
function getGroupedLevels(genre) {
  const allTiers = getTiers();
  const levels = getLevels(genre);
  const tiers = genre ? allTiers.filter(function (t) {
    return t.genre === genre || (!t.genre && genre === 'shi');
  }) : allTiers;
  const out = [];
  tiers.forEach(function (tier) {
    const idx = allTiers.indexOf(tier);
    const groupLevels = levels.filter(function (item) { return item.tier === idx; });
    if (groupLevels.length) out.push({ tier: tier, levels: groupLevels });
  });
  return out;
}

/* ---------------- 配图 ---------------- */

/** 返回某首诗的配图元数据 { path, motif, caption }，无配图时返回 null */
function getIllustration(poemId) {
  const item = cache ? cache.illustrations[poemId] : null;
  return item || null;
}

module.exports = {
  isReady,
  load,
  reset,
  getPoems,
  getPoem,
  getPoemsByDifficulty,
  getAuthorIntro,
  getLevels,
  getTiers,
  getTotalLevels,
  getFirstLevelIds,
  getLevel,
  getTier,
  getTierByIndex,
  getGroupedLevels,
  getIllustration,
};
