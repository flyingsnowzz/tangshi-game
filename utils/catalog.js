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
      poems: map.poems,
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

function reset() {
  cache = null;
  loading = null;
}

/* ---------------- 题库 ---------------- */

function getPoems() {
  return cache ? cache.poems : [];
}

function getPoem(id) {
  const list = getPoems();
  return list.find(function (item) { return item.id === id; }) || null;
}

/** 按难度区间取诗；min 省略时从 1 开始，保证高难关卡不会抽到低难诗 */
function getPoemsByDifficulty(maxDifficulty, minDifficulty) {
  const min = minDifficulty || 1;
  const max = maxDifficulty || 4;
  return getPoems().filter(function (item) {
    return item.difficulty <= max && item.difficulty >= min;
  });
}

function getAuthorIntro(name) {
  const intro = cache ? cache.authors[name] : '';
  return intro || '唐代诗人，生平资料待补充。';
}

/* ---------------- 关卡 ---------------- */

function getLevels() {
  return cache ? cache.levels : [];
}

function getTiers() {
  return cache ? cache.tiers : [];
}

function getTotalLevels() {
  return getLevels().length;
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
  return tiers[index] || tiers[0] || { name: '唐诗闯关' };
}

function getGroupedLevels() {
  return getTiers().map(function (tier, index) {
    return {
      tier: tier,
      levels: getLevels().filter(function (item) { return item.tier === index; }),
    };
  });
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
  getLevel,
  getTier,
  getTierByIndex,
  getGroupedLevels,
  getIllustration,
};
