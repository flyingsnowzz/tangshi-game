/**
 * 诗库浏览的统一次序与相邻关系。
 *
 * 诗库页（pages/library）与诗词详情页（pages/poem）的「上一首 / 下一首」
 * 必须走同一套次序，否则从诗库点开一首，再翻到下一首会跳到完全不相关的诗。
 *
 * 次序：先按学段（小学低年级 → 小学中高年级 → 初中 → 高中拓展），
 * 再按作者，最后按诗名。读起来像一本按课标梯度排的唐诗选。
 */
const catalog = require('./catalog.js');

const GRADE_RANK = {
  '小学低年级': 0,
  '小学中高年级': 1,
  '初中': 2,
  '高中拓展': 3,
};

// 筛选条上展示学段的固定顺序；只显示题库里实际出现的学段
const GRADE_ORDER = ['小学低年级', '小学中高年级', '初中', '高中拓展'];

function gradeRank(grade) {
  return Object.prototype.hasOwnProperty.call(GRADE_RANK, grade) ? GRADE_RANK[grade] : 99;
}

/** 返回按「学段 → 作者 → 诗名」排好序的诗列表（不修改原数组） */
function orderedPoems() {
  const poems = catalog.getPoems();
  return poems.slice().sort(function (a, b) {
    const ga = gradeRank(a.grade);
    const gb = gradeRank(b.grade);
    if (ga !== gb) return ga - gb;
    if (a.author !== b.author) return a.author < b.author ? -1 : 1;
    return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
  });
}

/** 给定诗 ID，返回它在统一次序里的位置与上一首/下一首 ID */
function neighbors(id) {
  const list = orderedPoems();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === id) {
      return {
        index: i,
        total: list.length,
        prevId: i > 0 ? list[i - 1].id : null,
        nextId: i < list.length - 1 ? list[i + 1].id : null,
      };
    }
  }
  return { index: -1, total: list.length, prevId: null, nextId: null };
}

/** 筛选条用的学段选项：永远含「全部」，后面是按固定顺序出现的学段 */
function gradeFilters() {
  const present = {};
  catalog.getPoems().forEach(function (p) { present[p.grade] = true; });
  const out = [{ key: 'all', name: '全部' }];
  GRADE_ORDER.forEach(function (g) {
    if (present[g]) out.push({ key: g, name: g });
  });
  return out;
}

module.exports = {
  GRADE_RANK: GRADE_RANK,
  GRADE_ORDER: GRADE_ORDER,
  orderedPoems: orderedPoems,
  neighbors: neighbors,
  gradeFilters: gradeFilters,
};
