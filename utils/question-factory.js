/**
 * 题目工厂：按关卡配置从云端题库随机生成十大题型。
 * 所有展示字段在此算好，页面不做复杂运算（WXML 表达式能力有限）。
 * 题目对象可整体序列化存入错题本，支持原样重做。
 *
 * 题型分两类：
 *   单选类 fill / next / guess / image / author / title / feihua / odd —— 页面复用四选一交互
 *   操作类 match（配对）/ order（排序）—— 页面各自有独立交互分支
 *
 * 古文五型（genre=wen 专用，基于 cards 而非 lines，同为四选一）：
 *   pause 诵读断句 / word 实词释义 / wf_fill 文言填空 / trans 名句翻译 / read 文意理解
 */
const catalog = require('./catalog.js');
const inlineImages = require('./illustration-data.js');

const TYPE_NAMES = {
  fill: '选字填空',
  next: '上下句对答',
  match: '诗人配对',
  guess: '诗意猜诗',
  image: '看图猜诗',
  order: '诗句排排队',
  author: '猜诗人',
  title: '猜诗名',
  feihua: '飞花令',
  odd: '火眼金睛',
  // 古文专用五型
  trans: '文句翻译',
  word: '实词释义',
  read: '文意理解',
  wf_fill: '文言填空',
  pause: '诵读断句',
};

const LETTERS = ['A', 'B', 'C', 'D'];
const FEIHUA_CHARS = ['月', '山', '花', '风', '春', '江', '日', '云', '雨', '雪', '秋', '人'];

/**
 * 全库可用诗句（过滤过短句、去重）。
 * 题库来自云端 catalog，必须等 load() 完成后才有值，因此这里延迟构建。
 */
let ALL_LINES = null;
let WEN_CARDS = null; // 古文名句卡片扁平池 [{poem, card}]，随云端刷新重建
const FRAGMENT_CACHE = {};

function allLines() {
  if (ALL_LINES) return ALL_LINES;
  const lines = [];
  const seen = {};
  catalog.getPoems().forEach(function (poem) {
    // 古文（genre=wen）的 lines 只供详情页展示；文言句不能混进诗词题的干扰项池
    if (poem.genre === 'wen') return;
    (poem.lines || []).forEach(function (line) {
      if (line.length >= 4 && !seen[line]) {
        seen[line] = true;
        lines.push(line);
      }
    });
  });
  ALL_LINES = lines;
  return lines;
}

/**
 * 古文名句卡片扁平池：把每篇 wen 的 cards 摊平成 [{poem, card}]。
 * 古文五型全部基于 cards（text/trans/words/pause），不依赖 lines。
 * 只在首次出题时构建，云端题库刷新后随 resetCache 重建。
 */
function allWenCards() {
  if (WEN_CARDS) return WEN_CARDS;
  const out = [];
  catalog.getPoems('wen').forEach(function (poem) {
    (poem.cards || []).forEach(function (card) {
      if (card && card.text) out.push({ poem: poem, card: card });
    });
  });
  WEN_CARDS = out;
  return out;
}

/** 云端题库刷新后清空派生缓存 */
function resetCache() {
  ALL_LINES = null;
  WEN_CARDS = null;
  Object.keys(FRAGMENT_CACHE).forEach(function (key) { delete FRAGMENT_CACHE[key]; });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function sample(arr, n) {
  return shuffle(arr).slice(0, n);
}

function unique(arr) {
  const seen = {};
  return arr.filter(function (item) {
    if (seen[item]) return false;
    seen[item] = true;
    return true;
  });
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function optionList(correct, distractors) {
  const all = unique([correct].concat(distractors));
  const shuffled = shuffle(all);
  const options = shuffled.map(function (text, index) {
    return { key: LETTERS[index] || String(index + 1), text: text };
  });
  let answerKey = LETTERS[0];
  options.forEach(function (item) {
    if (item.text === correct) answerKey = item.key;
  });
  return { options: options, answerKey: answerKey };
}

/** 生成与答案等长的连续字词片段，作为填空干扰项；哈希去重避免扩库后 O(n²) 卡顿 */
function fragmentsOfLength(len) {
  if (FRAGMENT_CACHE[len]) return FRAGMENT_CACHE[len];
  const pool = [];
  const seen = {};
  allLines().forEach(function (line) {
    for (let i = 0; i + len <= line.length; i += 1) {
      const frag = line.slice(i, i + len);
      if (!seen[frag]) { seen[frag] = true; pool.push(frag); }
    }
  });
  FRAGMENT_CACHE[len] = pool;
  return pool;
}

function baseQuestion(levelId, index, type, poem) {
  return {
    id: 'q' + Date.now().toString(36) + '-' + levelId + '-' + index + '-' + Math.floor(Math.random() * 10000),
    signature: '',
    type: type,
    typeName: TYPE_NAMES[type],
    poemId: poem ? poem.id : '',
    poemTitle: poem ? poem.title : '',
    poemAuthor: poem ? poem.author : '',
    promptText: '',
    mainText: '',
    masked: '',
    maskedView: '',
    subText: '',
    options: [],
    answerKey: '',
    correctFeedback: '',
    tip: '',
    leftItems: [],
    rightItems: [],
    answerMap: {},
    imagePath: '',
    imageFallback: '',
    imageMotif: '',
    orderItems: [],
    answerOrder: [],
    orderText: '',
  };
}

/** 选一句有代表性、长度适中的诗句做题干 */
function pickRepresentativeLine(poem) {
  const valid = poem.lines.filter(function (line) {
    return line.length >= 5 && line.indexOf(poem.author) < 0;
  });
  if (valid.length) return valid[randInt(valid.length)];
  const fallback = poem.lines.filter(function (line) { return line.length >= 4; });
  return fallback.length ? fallback[0] : poem.lines[0];
}

/* ---------------- 题干句读 ----------------
 * 云端 poem.lines 是白文（不带标点），句读单独存在 poem.marks 里，
 * 一行一个标点，长度严格等于 lines 长度（见 build_punct_marks.py）。
 *
 * 为什么不在数据层直接把标点拼进 lines：
 *   本题库用 lines 做长度门槛（>=4 / >=5）、干扰项池、signature 去重，
 *   行尾多一个字会让短句跨过门槛，出题分布整体偏移。
 *
 * 所以：只给**题干展示文本**补标点，options / answerKey / signature
 * 一律保持白文，比较逻辑完全不受影响。
 */
function punctAt(poem, lineIndex) {
  const marks = poem && poem.marks;
  if (!marks) return '';
  return marks.charAt(lineIndex) || '';
}

/** 整句原样匹配（正文、猜诗人、猜诗名、上下句都用这条） */
function punctFor(poem, text) {
  const lines = (poem && poem.lines) || [];
  if (!text || !poem || !poem.marks) return '';
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === text) return punctAt(poem, i);
  }
  return '';
}

/** 挖空句匹配：把 □ 当通配符，其余字必须一一对上 */
function punctForMasked(poem, masked) {
  const lines = (poem && poem.lines) || [];
  if (!masked || !poem || !poem.marks) return '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length !== masked.length) continue;
    let hit = true;
    for (let j = 0; j < line.length; j += 1) {
      const mc = masked.charAt(j);
      if (mc !== '□' && mc !== line.charAt(j)) { hit = false; break; }
    }
    if (hit) return punctAt(poem, i);
  }
  return '';
}

/* ---------------- 原有四型 ---------------- */

/** 题型一：选字填空 —— 挖去连续两字，四选一补全 */
function makeFill(poem, levelId, index) {
  const candidates = poem.lines.filter(function (line) { return line.length >= 5; });
  if (!candidates.length) return null;
  const line = candidates[randInt(candidates.length)];
  const len = 2;
  const start = randInt(line.length - len + 1);
  const blank = line.slice(start, start + len);
  const masked = line.slice(0, start) + '□□' + line.slice(start + len);
  const pool = fragmentsOfLength(len).filter(function (f) { return f !== blank; });
  const distractors = sample(pool, 3);
  if (distractors.length < 3) return null;

  const q = baseQuestion(levelId, index, 'fill', poem);
  const built = optionList(blank, distractors);
  q.signature = poem.id + '|fill|' + masked;
  q.promptText = '点击选字，补全这句诗';
  // 题干补句读；masked 保持白文用于出题，展示版另存 maskedView
  q.masked = masked;
  q.maskedView = masked + punctForMasked(poem, masked);
  q.mainText = line + punctFor(poem, line);
  q.subText = '《' + poem.title + '》 · ' + poem.author;
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '缺失处的第一个字是「' + blank.charAt(0) + '」';
  return q;
}

/** 题型二：上下句对答 —— 给上句，选出下句 */
function makeNext(poem, levelId, index) {
  if (poem.lines.length < 2) return null;
  const pos = randInt(poem.lines.length - 1);
  const line = poem.lines[pos];
  const answer = poem.lines[pos + 1];
  const lines = allLines();
  let pool = lines.filter(function (item) {
    return item !== answer && item !== line && Math.abs(item.length - answer.length) <= 2;
  });
  let distractors = sample(pool, 3);
  if (distractors.length < 3) {
    const extra = sample(
      lines.filter(function (item) { return item !== answer && distractors.indexOf(item) < 0; }),
      3 - distractors.length
    );
    distractors = distractors.concat(extra);
  }
  if (distractors.length < 3) return null;

  const q = baseQuestion(levelId, index, 'next', poem);
  const built = optionList(answer, distractors);
  q.signature = poem.id + '|next|' + line;
  q.promptText = '请接出下一句';
  q.mainText = line + punctFor(poem, line);
  q.subText = '《' + poem.title + '》 · ' + poem.author;
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '下一句的第一个字是「' + answer.charAt(0) + '」';
  return q;
}

/** 题型三：诗意猜诗 —— 给白话释义，选出原句 */
function makeGuess(poem, levelId, index) {
  const answer = poem.lines[0];
  const brief = (poem.meaning || '').split(/[。；]/)[0] || ('《' + poem.title + '》写了什么');
  // 白话释义有时会直接引用原句（如《哥舒歌》"北斗七星高高挂着"、《问刘十九》
  // "红泥小火炉正烧着"）。这类题干等于把答案写在题面上，判定为不合格题目，
  // 返回 null 让 buildQuestions 换一首诗重抽，不修改题库数据。
  const leaks = poem.lines.some(function (line) { return line && brief.indexOf(line) >= 0; });
  if (leaks) return null;
  const pool = allLines().filter(function (item) {
    return item !== answer && item.length >= 5 && brief.indexOf(item) < 0;
  });
  const distractors = sample(pool, 3);
  if (distractors.length < 3) return null;

  const q = baseQuestion(levelId, index, 'guess', poem);
  const built = optionList(answer, distractors);
  q.signature = poem.id + '|guess|' + brief;
  q.promptText = '根据诗意，选出对应的诗句';
  q.mainText = brief + '。';
  q.subText = '出自哪一首诗词？';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '这首诗是《' + poem.title + '》';
  return q;
}

/** 题型四：诗词匹配 —— 四位诗人与四句诗一一配对 */
function makeMatch(pool, levelId, index) {
  const chosen = [];
  const used = {};
  shuffle(pool).forEach(function (poem) {
    if (chosen.length >= 4) return;
    if (used[poem.author]) return;
    used[poem.author] = true;
    chosen.push(poem);
  });
  if (chosen.length < 4) return null;

  const leftItems = [];
  const rightItems = [];
  const answerMap = {};
  chosen.forEach(function (poem, i) {
    leftItems.push({ key: 'L' + i, text: poem.author });
    rightItems.push({ key: 'R' + i, text: pickRepresentativeLine(poem) });
    answerMap['L' + i] = 'R' + i;
  });

  const q = baseQuestion(levelId, index, 'match', chosen[0]);
  q.signature = 'match|' + chosen.map(function (p) { return p.id; }).join('-');
  q.promptText = '将诗人与对应的诗句一一配对';
  q.mainText = '先点左侧诗人，再点右侧诗句';
  q.subText = '四组全部配对正确即可过关';
  q.leftItems = leftItems;
  q.rightItems = shuffle(rightItems);
  q.answerMap = answerMap;
  q.tip = '《' + chosen[0].title + '》的作者是「' + chosen[0].author + '」';
  return q;
}

/* ---------------- 新增六型 ---------------- */

/** 题型五：看图猜诗 —— 看意象小画签，选出对应诗句 */
function makeImage(poem, levelId, index) {
  const illus = catalog.getIllustration(poem.id);
  if (!illus || !illus.path) return null;
  const answer = pickRepresentativeLine(poem);
  const pool = allLines().filter(function (item) {
    return item !== answer && Math.abs(item.length - answer.length) <= 3;
  });
  const distractors = sample(pool, 3);
  if (distractors.length < 3) return null;

  const q = baseQuestion(levelId, index, 'image', poem);
  const built = optionList(answer, distractors);
  q.signature = poem.id + '|image|' + illus.motif;
  q.promptText = '看这幅小画，猜猜是哪句诗';
  q.mainText = '';
  q.subText = '画里藏着一句诗词';
  // 优先级：远程真实图（服务器 URL，不打包）→ 包内生成图（内联 data URI，预览/真机通用）→ 文字签。
  // 远程真实图加载失败时回退到生成图；两级都失败时页面显示意象文字签。
  var real = illus.real || '';
  var bundled = inlineImages.get(poem.id) || illus.path;
  q.imagePath = real || bundled;
  q.imageFallback = real ? bundled : '';
  q.imageReal = !!real;
  q.imageCredit = illus.credit || '';
  q.imageMotif = illus.motif;
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.correctFeedback = '眼力真好！画的就是《' + poem.title + '》';
  q.tip = '这幅小画叫「' + illus.motif + '」';
  return q;
}

/** 题型六：诗句排排队 —— 把连续四句按原顺序依次点回来 */
function makeOrder(poem, levelId, index) {
  if (poem.lines.length < 4) return null;
  const start = randInt(poem.lines.length - 3);
  const ordered = poem.lines.slice(start, start + 4).filter(function (l) { return l.length >= 4; });
  if (ordered.length < 4 || unique(ordered).length < 4) return null;

  const items = shuffle(ordered.map(function (text, i) {
    return { key: 'O' + i, text: text };
  }));
  const answerOrder = ordered.map(function (text) {
    const hit = items.find(function (it) { return it.text === text; });
    return hit ? hit.key : '';
  });
  if (answerOrder.some(function (k) { return !k; })) return null;

  const q = baseQuestion(levelId, index, 'order', poem);
  q.signature = poem.id + '|order|' + ordered[0];
  q.promptText = '把四句诗排回原来的顺序';
  q.mainText = '按《' + poem.title + '》里的先后，依次点出来';
  q.subText = '点错了可以点「重排」再来';
  q.orderItems = items;
  q.answerOrder = answerOrder;
  q.orderText = ordered.join(' · ');
  q.correctFeedback = '排对啦！四句一口气背下来';
  q.tip = '第一句是「' + ordered[0] + '」';
  return q;
}

/** 题型七：猜诗人 —— 给诗句，四选一选作者 */
function makeAuthor(poem, levelId, index) {
  const names = [];
  catalog.getPoems().forEach(function (p) {
    if (p.author !== poem.author && p.author !== '佚名' && names.indexOf(p.author) < 0) names.push(p.author);
  });
  const distractors = sample(names, 3);
  if (distractors.length < 3) return null;
  const line = pickRepresentativeLine(poem);
  // 诗句或副题里若带作者名就等于报答案，换一首重出
  if (line.indexOf(poem.author) >= 0) return null;

  const q = baseQuestion(levelId, index, 'author', poem);
  const built = optionList(poem.author, distractors);
  q.signature = poem.id + '|author|' + line;
  q.promptText = '这句诗是谁写的？';
  q.mainText = line + punctFor(poem, line);
  q.subText = '四位诗人里，只有一位写过这句';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.correctFeedback = '答对啦！是' + poem.author + '写的《' + poem.title + '》';
  q.tip = '这句出自《' + poem.title + '》';
  return q;
}

/** 题型八：猜诗名 —— 给诗句，四选一选诗题 */
function makeTitle(poem, levelId, index) {
  const titles = [];
  catalog.getPoems().forEach(function (p) {
    if (p.id !== poem.id && titles.indexOf(p.title) < 0) titles.push(p.title);
  });
  const distractors = sample(titles, 3);
  if (distractors.length < 3) return null;

  // 很多诗句自带诗题字面（如「清明时节雨纷纷」「乌衣巷口夕阳斜」），
  // 这类句子不能拿来当题干，否则等于直接报答案。
  const plainTitle = poem.title.replace(/[（(][^）)]*[）)]/g, '');
  const candidates = poem.lines.filter(function (l) {
    return l.length >= 5 && l.indexOf(plainTitle) < 0 && l.indexOf(poem.author) < 0;
  });
  if (!candidates.length) return null;
  const line = candidates[randInt(candidates.length)];

  const q = baseQuestion(levelId, index, 'title', poem);
  const built = optionList(poem.title, distractors);
  q.signature = poem.id + '|title|' + line;
  q.promptText = '这句诗出自哪一首？';
  q.mainText = line + punctFor(poem, line);
  q.subText = '作者是' + poem.author;
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.correctFeedback = '答对啦！这句出自《' + poem.title + '》';
  q.tip = '作者是「' + poem.author + '」';
  return q;
}

/** 题型九：飞花令（选择版）—— 四句里找出带令字的那一句 */
function makeFeihua(poem, levelId, index) {
  const chars = shuffle(FEIHUA_CHARS);
  let ch = '';
  let answer = '';
  for (let i = 0; i < chars.length && !answer; i += 1) {
    const hit = poem.lines.find(function (l) {
      return l.indexOf(chars[i]) >= 0 && l.length >= 5;
    });
    if (hit) { ch = chars[i]; answer = hit; }
  }
  if (!answer) return null;
  const pool = allLines().filter(function (l) {
    return l.indexOf(ch) < 0 && l !== answer && l.length >= 5
      && Math.abs(l.length - answer.length) <= 3;
  });
  const distractors = sample(pool, 3);
  if (distractors.length < 3) return null;

  const q = baseQuestion(levelId, index, 'feihua', poem);
  const built = optionList(answer, distractors);
  q.signature = poem.id + '|feihua|' + ch;
  q.promptText = '飞花令：找出带「' + ch + '」字的那一句';
  q.mainText = '本轮令字：' + ch;
  q.subText = '四句里只有一句带这个字';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.correctFeedback = '找到啦！这句出自《' + poem.title + '》';
  q.tip = '想想《' + poem.title + '》里哪句有「' + ch + '」';
  return q;
}

/** 题型十：火眼金睛 —— 三句出自本诗，挑出混进来的那一句 */
function makeOdd(poem, pool, levelId, index) {
  const own = sample(unique(poem.lines.filter(function (l) { return l.length >= 5; })), 3);
  if (own.length < 3) return null;
  const others = pool.filter(function (p) { return p.id !== poem.id; });
  if (!others.length) return null;

  let intruder = '';
  for (let attempt = 0; attempt < 10 && !intruder; attempt += 1) {
    const other = others[randInt(others.length)];
    const candidates = sample(
      other.lines.filter(function (l) { return l.length >= 5 && own.indexOf(l) < 0; }), 1
    );
    if (candidates.length) intruder = candidates[0];
  }
  if (!intruder) return null;

  const q = baseQuestion(levelId, index, 'odd', poem);
  const built = optionList(intruder, own);
  q.signature = poem.id + '|odd|' + own.join('-');
  q.promptText = '下面四句里有一句不是《' + poem.title + '》的，把它挑出来';
  q.mainText = '三句出自同一首诗，一句跑错门了';
  q.subText = '《' + poem.title + '》 · ' + poem.author;
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.correctFeedback = '好眼力！那句不是《' + poem.title + '》里的';
  q.tip = '《' + poem.title + '》里有：' + own.join('、');
  return q;
}

/* ---------------- 古文五型（genre=wen，基于 cards） ---------------- */

/** 全库实词释义对，供 word / wf_fill 取干扰项 */
function allWenWords() {
  const pairs = [];
  allWenCards().forEach(function (item) {
    (item.card.words || []).forEach(function (wd) {
      if (wd && wd.w && wd.m) pairs.push(wd);
    });
  });
  return pairs;
}

/** 取与答案长度接近的干扰项，先紧后松，保证四选一质量 */
function closeDistractors(pool, correct, n, maxDiff) {
  const clean = unique(pool.filter(function (x) { return x && x !== correct; }));
  let hit = clean.filter(function (x) { return Math.abs(x.length - correct.length) <= maxDiff; });
  if (hit.length < n) {
    hit = hit.concat(clean.filter(function (x) {
      return Math.abs(x.length - correct.length) > maxDiff && hit.indexOf(x) < 0;
    }));
  }
  return sample(hit, n);
}

/** 古文题型一：文句翻译 —— 给文言原句，四选一选正确白话译文 */
function makeTrans(pick, levelId, index) {
  const card = pick.card;
  const correct = card.trans;
  if (!correct) return null;
  const pool = allWenCards().map(function (it) { return it.card.trans; });
  const distractors = closeDistractors(pool, correct, 3, 6);
  if (distractors.length < 3) return null;
  const q = baseQuestion(levelId, index, 'trans', pick.poem);
  const built = optionList(correct, distractors);
  q.signature = pick.poem.id + '|trans|' + card.text;
  q.promptText = '选出这句话的正确译文';
  q.mainText = card.text;
  q.subText = '《' + pick.poem.title + '》' + (pick.poem.author ? ' · ' + pick.poem.author : '');
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '抓住关键实词「' + ((card.words && card.words[0] && card.words[0].w) || '') + '」的意思';
  return q;
}

/** 古文题型二：文意理解 —— 给白话译文，四选一选对应文言原句（trans 的逆操作） */
function makeRead(pick, levelId, index) {
  const card = pick.card;
  const correct = card.text;
  if (!card.trans || !correct) return null;
  const pool = allWenCards().map(function (it) { return it.card.text; });
  const distractors = closeDistractors(pool, correct, 3, 6);
  if (distractors.length < 3) return null;
  const q = baseQuestion(levelId, index, 'read', pick.poem);
  const built = optionList(correct, distractors);
  q.signature = pick.poem.id + '|read|' + card.trans;
  q.promptText = '这句话说的是下面哪一句原文？';
  q.mainText = card.trans;
  q.subText = '读懂白话，找回原来的文言句子';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '原文里有「' + correct.slice(0, 4) + '」';
  return q;
}

/** 古文题型三：实词释义 —— 给句子与加点词，四选一选准确释义 */
function makeWord(pick, levelId, index) {
  const card = pick.card;
  const words = (card.words || []).filter(function (w) { return w.w && w.m; });
  if (!words.length) return null;
  const word = words[randInt(words.length)];
  const pool = allWenWords().map(function (w) { return w.m; });
  const distractors = closeDistractors(pool, word.m, 3, 3);
  if (distractors.length < 3) return null;
  const q = baseQuestion(levelId, index, 'word', pick.poem);
  const built = optionList(word.m, distractors);
  q.signature = pick.poem.id + '|word|' + word.w;
  q.promptText = '句中「' + word.w + '」是什么意思？';
  q.mainText = card.text;
  q.subText = '《' + pick.poem.title + '》 · 结合上下文想一想';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '把「' + word.m + '」放回句中读一遍';
  return q;
}

/** 古文题型四：文言填空 —— 挖去一个实词，四选一补全（挖空词必来自 words，且在原句中真实存在） */
function makeWenFill(pick, levelId, index) {
  const card = pick.card;
  const text = card.text || '';
  const words = (card.words || []).filter(function (w) {
    return w.w && text.indexOf(w.w) >= 0;
  });
  if (!text || !words.length) return null;
  const word = words[randInt(words.length)];
  const masked = text.replace(word.w, '□'.repeat(word.w.length));
  const pool = allWenWords().map(function (w) { return w.w; })
    .filter(function (w) { return w.length === word.w.length; });
  const distractors = unique(pool.filter(function (w) { return w !== word.w; }));
  if (distractors.length < 3) return null;
  const q = baseQuestion(levelId, index, 'wf_fill', pick.poem);
  const built = optionList(word.w, sample(distractors, 3));
  q.signature = pick.poem.id + '|wf_fill|' + masked;
  q.promptText = '补上句中空缺的字词';
  q.mainText = text;
  q.masked = masked;
  // 文言句来自 card.text，本身已带原文标点，展示版与白文版一致
  q.maskedView = masked;
  q.subText = '《' + pick.poem.title + '》';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '缺失词共 ' + word.w.length + ' 个字';
  return q;
}

/** 为由 / 分段的停顿串生成错误切分变体（同句不同切法），保证与正确项不重复 */
function pauseVariants(plain, correct, count) {
  const n = plain.length;
  if (n < 6) return [];
  const out = [];
  const seen = {};
  seen[correct] = true;
  let guard = 0;
  const maxCuts = Math.min(3, Math.floor(n / 3));
  while (out.length < count && guard < 80) {
    guard += 1;
    const cuts = [];
    const k = 1 + randInt(maxCuts);
    for (let i = 0; i < k; i += 1) {
      const p = 2 + randInt(n - 3); // 切点落在 2..n-2，避免首尾出现单字段
      if (cuts.indexOf(p) < 0) cuts.push(p);
    }
    cuts.sort(function (a, b) { return a - b; });
    const clean = [];
    cuts.forEach(function (p) {
      if (!clean.length || p - clean[clean.length - 1] >= 2) clean.push(p);
    });
    if (!clean.length) continue;
    let s = '';
    let last = 0;
    clean.forEach(function (p) { s += plain.slice(last, p) + '/'; last = p; });
    s += plain.slice(last);
    if (seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

/** 古文题型五：诵读断句 —— 给无标点句子，四选一选正确停顿 */
function makePause(pick, levelId, index) {
  const card = pick.card;
  const correct = card.pause || '';
  const plain = correct.replace(/\//g, '');
  // 停顿串去斜杠后必须与去标点的原句一致，否则该卡片不适合出断句题
  const stripPunct = function (s) { return s.replace(/[\s，。！？；：、,!?;:]/g, ''); };
  if (!correct || correct.indexOf('/') < 0 || stripPunct(plain) !== stripPunct(card.text || '')) return null;
  const distractors = pauseVariants(plain, correct, 3);
  if (distractors.length < 3) return null;
  const q = baseQuestion(levelId, index, 'pause', pick.poem);
  const built = optionList(correct, distractors);
  q.signature = pick.poem.id + '|pause|' + card.text;
  q.promptText = '给这句话选出正确的停顿（/ 表示停顿）';
  q.mainText = plain;
  q.subText = '《' + pick.poem.title + '》';
  q.options = built.options;
  q.answerKey = built.answerKey;
  q.tip = '先读懂意思，再按句意停顿';
  return q;
}

const WEN_TYPES = { trans: 1, read: 1, word: 1, wf_fill: 1, pause: 1 };

/** 取抽题池范围内的古文卡片 */
function wenCardsInPool(pool) {
  const ids = {};
  pool.forEach(function (p) { ids[p.id] = true; });
  return allWenCards().filter(function (item) { return ids[item.poem.id]; });
}

function makeByType(type, pool, levelId, index) {
  if (type === 'match') return makeMatch(pool, levelId, index);
  if (WEN_TYPES[type]) {
    const cards = wenCardsInPool(pool);
    if (!cards.length) return null;
    const pick = cards[randInt(cards.length)];
    if (type === 'trans') return makeTrans(pick, levelId, index);
    if (type === 'read') return makeRead(pick, levelId, index);
    if (type === 'word') return makeWord(pick, levelId, index);
    if (type === 'wf_fill') return makeWenFill(pick, levelId, index);
    if (type === 'pause') return makePause(pick, levelId, index);
  }
  if (!pool.length) return null;
  const poem = pool[randInt(pool.length)];
  if (type === 'fill') return makeFill(poem, levelId, index);
  if (type === 'guess') return makeGuess(poem, levelId, index);
  if (type === 'image') return makeImage(poem, levelId, index);
  if (type === 'order') return makeOrder(poem, levelId, index);
  if (type === 'author') return makeAuthor(poem, levelId, index);
  if (type === 'title') return makeTitle(poem, levelId, index);
  if (type === 'feihua') return makeFeihua(poem, levelId, index);
  if (type === 'odd') return makeOdd(poem, pool, levelId, index);
  return makeNext(poem, levelId, index);
}

/**
 * 按关卡生成题目：保证该关配置的每种题型至少出现一次，顺序打乱。
 * 生成失败的题型自动换诗重试，最终兜底为上下句对答。
 */
function buildQuestions(level) {
  // 按关卡所属文体抽题：唐诗关只出唐诗、宋词关只出宋词，避免跨轨串题。
  const pool = catalog.getPoemsByDifficulty(
    level.maxDifficulty, level.minDifficulty || 1, level.genre || 'shi');
  const plan = [];
  for (let i = 0; i < level.count; i += 1) {
    plan.push(level.types[i % level.types.length]);
  }
  const ordered = shuffle(plan);
  const list = [];

  const isWen = level.genre === 'wen';
  ordered.forEach(function (type, index) {
    let q = null;
    for (let attempt = 0; attempt < 20 && !q; attempt += 1) {
      q = makeByType(type, pool, level.id, index);
    }
    if (!q) {
      // 古文关不能兜底到 makeNext（古文无 lines）——改兜底为文句翻译，稳定可出
      for (let attempt = 0; attempt < 24 && !q; attempt += 1) {
        if (isWen) {
          const cards = wenCardsInPool(pool);
          if (cards.length) q = makeTrans(cards[randInt(cards.length)], level.id, index);
        } else if (pool.length) {
          q = makeNext(pool[randInt(pool.length)], level.id, index);
        }
      }
    }
    if (q) list.push(q);
  });

  return list;
}

/** 错题本重做：把快照还原成可直接作答的题目列表 */
function rebuildQuestions(snapshots) {
  return snapshots.map(function (item) {
    return Object.assign({}, item.question, { id: item.question.id + '-r' + Date.now().toString(36) });
  });
}

module.exports = {
  TYPE_NAMES,
  buildQuestions,
  rebuildQuestions,
  resetCache,
};
