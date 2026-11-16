const catalog = require('../../utils/catalog.js');
const { buildQuestions, rebuildQuestions } = require('../../utils/question-factory.js');
const store = require('../../utils/store.js');
const { playCorrect, playWrong, playClear } = require('../../utils/audio.js');
const { getFontSizes } = require('../../utils/theme.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

/**
 * 给异步操作加超时上限。内置 H5 预览不保证模拟云请求 / 页面路由，
 * 若 await 永久挂起会让「完成本关」看起来毫无反应，必须能继续往下走。
 */
function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(function (e) {
      return { error: { message: (e && e.message) || 'sync failed' } };
    }),
    new Promise(function (resolve) {
      setTimeout(function () { resolve({ error: null, timedOut: true }); }, ms);
    }),
  ]);
}

createCloudPage({
  data: {
    mode: 'level',
    levelId: 0,
    levelName: '',
    levelTier: '',
    questions: [],
    total: 0,
    index: 0,
    progressPercent: 0,
    current: null,
    typeName: '',
    imageSrc: '',
    imageFallback: '',
    imageTriedFallback: false,
    imageFailed: false,
    isChoice: true,
    isOrder: false,
    isMultiFill: false,
    optionsView: [],
    orderView: [],
    multiLinesView: [],
    multiCardsView: [],
    orderPicks: [],
    leftView: [],
    rightView: [],
    selectedKey: '',
    wrongKey: '',
    showResult: false,
    isWrong: false,
    feedback: '',
    tipVisible: false,
    hintEnabled: true,
    matchHint: '',
    wrongCount: 0,
    firstCorrect: 0,
    questionHadWrong: false,
    masteredSignatures: [],
    combo: 0,
    comboText: '',
    poemFs: 42,
    bodyFs: 28,
    finishing: false,
    routeFailed: false,
    fallback: null,
  },

  /** 只在云端内容 + 进度就绪后执行一次，避免返回页面时重新生成题目 */
  onCloudFirst: function (options) {
    const settings = store.getSettings();
    const fonts = getFontSizes();
    let questions = [];
    let mode = 'level';
    let levelId = 0;
    let levelName = '';
    let levelTier = '';

    if (options.mode === 'wrong') {
      mode = 'wrong';
      const snapshots = store.getWrongBook().map(function (item) {
        return { question: item.question };
      });
      questions = rebuildQuestions(snapshots);
      levelName = '错题重做';
      levelTier = '复盘巩固';
      if (!questions.length) {
        wx.showToast({ title: '错题本是空的', icon: 'none' });
        setTimeout(function () { wx.navigateBack(); }, 500);
        return;
      }
    } else {
      levelId = Number(options.levelId) || 1;
      if (!store.isUnlocked(levelId)) {
        wx.showToast({ title: '该关卡尚未解锁', icon: 'none' });
        setTimeout(function () { wx.navigateBack(); }, 500);
        return;
      }
      const level = catalog.getLevel(levelId);
      if (!level) {
        wx.showToast({ title: '关卡配置读取失败', icon: 'none' });
        setTimeout(function () { wx.navigateBack(); }, 500);
        return;
      }
      levelName = level.name;
      levelTier = catalog.getTierByIndex(level.tier).name;
      questions = buildQuestions(level);
    }

    this.setData({
      mode: mode,
      levelId: levelId,
      levelName: levelName,
      levelTier: levelTier,
      questions: questions,
      total: questions.length,
      hintEnabled: settings.hint,
      poemFs: fonts.poemFs,
      bodyFs: fonts.bodyFs,
    }, this.showQuestion.bind(this, 0));
  },

  /** 从诗词详情页返回时同步字体档位 */
  onCloudRefresh: function () {
    const fonts = getFontSizes();
    this.setData({
      poemFs: fonts.poemFs,
      bodyFs: fonts.bodyFs,
      hintEnabled: store.getSettings().hint,
    });
  },

  showQuestion: function (index) {
    const q = this.data.questions[index];
    if (!q) {
      this.finish();
      return;
    }
    let answerText = '';
    if (q.type === 'fill' || q.type === 'wf_fill' || q.type === 'multi_fill') {
      answerText = q.mainText;
    } else if (q.type === 'order') {
      answerText = q.orderText || '';
    } else if (q.type !== 'match') {
      const correct = q.options.find(function (item) { return item.key === q.answerKey; });
      answerText = correct ? correct.text : '';
    }
    const view = Object.assign({}, q, {
      // 填空类（含文言填空、多空填字）题干用挖空句，正文另作答案展示，不在此重复显示
      displayMain: q.type === 'fill' || q.type === 'wf_fill' || q.type === 'multi_fill' ? '' : q.mainText,
      // 挖空句的展示版（带句读）；老题库没有 maskedView 时退回 masked
      displayMasked: q.maskedView || q.masked,
      displayVerse: q.type === 'next' || q.type === 'author' || q.type === 'title',
      answerText: answerText,
    });
    this.setData({
      current: view,
      index: index,
      progressPercent: Math.round((index / this.data.total) * 100),
      typeName: q.typeName,
      imageSrc: view.imagePath || '',
      imageFallback: view.imageFallback || '',
      imageReal: !!view.imageReal,
      imageCredit: view.imageCredit || '',
      imageTriedFallback: false,
      imageFailed: false,
      isChoice: q.type !== 'match' && q.type !== 'order' && q.type !== 'multi_fill',
      isOrder: q.type === 'order',
      isMultiFill: q.type === 'multi_fill',
      multiLinesView: q.multiLines.map(function (item) {
        return { idx: item.idx, before: item.before, after: item.after, punct: item.punct, filled: '', state: '' };
      }),
      multiCardsView: q.multiCards.map(function (item) {
        return { key: item.key, text: item.text, used: false, wrong: false };
      }),
      optionsView: q.options.map(function (item) {
        return { key: item.key, text: item.text, state: 'plain' };
      }),
      orderView: q.orderItems.map(function (item) {
        return { key: item.key, text: item.text, state: 'plain', seq: 0 };
      }),
      orderPicks: [],
      leftView: q.leftItems.map(function (item) {
        return { key: item.key, text: item.text, matched: false, state: '' };
      }),
      rightView: q.rightItems.map(function (item) {
        return { key: item.key, text: item.text, matched: false, state: '' };
      }),
      selectedKey: '',
      wrongKey: '',
      showResult: false,
      isWrong: false,
      feedback: '',
      tipVisible: false,
      matchHint: '',
      questionHadWrong: false,
      comboText: '',
    });
  },

  /** 配图三级降级链：远程真实图 → 包内生成图 → 意象文字签，任何环境都不留空白框 */
  onImageError: function () {
    if (this.data.imageTriedFallback || !this.data.imageFallback) {
      this.setData({ imageFailed: true });
      return;
    }
    // 真实图加载失败，回退到包内生成图：同时清掉「真实图」标记与出处，避免张冠李戴
    this.setData({
      imageSrc: this.data.imageFallback,
      imageTriedFallback: true,
      imageReal: false,
      imageCredit: '',
    });
  },

  onOptionTap: function (event) {
    if (this.data.showResult) return;
    const key = event.currentTarget.dataset.key;
    const q = this.data.current;
    const correct = key === q.answerKey;

    const optionsView = this.data.optionsView.map(function (item) {
      return { key: item.key, text: item.text, state: item.key === key ? (correct ? 'picked' : 'wrong') : 'plain' };
    });

    if (correct) {
      const combo = this.data.combo + 1;
      const patch = {
        combo: combo,
        comboText: combo >= 2 ? '连对 ' + combo + ' 题，太顺啦！' : '',
        selectedKey: key,
        wrongKey: '',
        showResult: true,
        isWrong: false,
        feedback: q.correctFeedback || ('答对啦！这句出自《' + q.poemTitle + '》'),
        optionsView: optionsView,
      };
      if (!this.data.questionHadWrong) {
        patch.firstCorrect = this.data.firstCorrect + 1;
        if (this.data.mode === 'wrong') {
          patch.masteredSignatures = this.data.masteredSignatures.concat([q.signature]);
        }
      }
      this.setData(patch);
      playCorrect();
    } else {
      this.setData({
        wrongKey: key,
        isWrong: true,
        combo: 0,
        comboText: '',
        questionHadWrong: true,
        wrongCount: this.data.wrongCount + 1,
        feedback: '差一点点，再试一次就好啦',
        optionsView: optionsView,
      });
      store.recordWrong(q);
      playWrong();
    }
  },

  /** 排序题：依次点击四句，点满自动判定；排错清空重来，不阻断闯关 */
  onOrderTap: function (event) {
    if (this.data.showResult) return;
    const key = event.currentTarget.dataset.key;
    if (this.data.orderPicks.indexOf(key) >= 0) return;
    const q = this.data.current;
    const answerOrder = q.answerOrder || [];
    const picks = this.data.orderPicks.concat([key]);
    const orderView = this.data.orderView.map(function (item) {
      const seq = picks.indexOf(item.key) + 1;
      return { key: item.key, text: item.text, seq: seq, state: seq ? 'picked' : 'plain' };
    });

    if (picks.length < answerOrder.length) {
      this.setData({
        orderPicks: picks,
        orderView: orderView,
        matchHint: '已点 ' + picks.length + ' 句，接着排',
      });
      return;
    }

    const correct = picks.every(function (item, i) { return item === answerOrder[i]; });
    if (correct) {
      const combo = this.data.combo + 1;
      const patch = {
        combo: combo,
        comboText: combo >= 2 ? '连对 ' + combo + ' 题，太顺啦！' : '',
        showResult: true,
        isWrong: false,
        feedback: q.correctFeedback || '排对啦！',
        orderPicks: picks,
        orderView: orderView,
        matchHint: '',
      };
      if (!this.data.questionHadWrong) {
        patch.firstCorrect = this.data.firstCorrect + 1;
        if (this.data.mode === 'wrong') {
          patch.masteredSignatures = this.data.masteredSignatures.concat([q.signature]);
        }
      }
      this.setData(patch);
      playCorrect();
    } else {
      this.setData({
        orderPicks: [],
        orderView: this.data.orderView.map(function (item) {
          return { key: item.key, text: item.text, state: 'plain', seq: 0 };
        }),
        matchHint: '顺序还差一点，重新排一次就好',
        combo: 0,
        comboText: '',
        isWrong: true,
        questionHadWrong: true,
        wrongCount: this.data.wrongCount + 1,
        feedback: '差一点点，再试一次就好啦',
      });
      store.recordWrong(q);
      playWrong();
    }
  },

  onOrderReset: function () {
    if (this.data.showResult) return;
    this.setData({
      orderPicks: [],
      orderView: this.data.orderView.map(function (item) {
        return { key: item.key, text: item.text, state: 'plain', seq: 0 };
      }),
      matchHint: '',
      isWrong: false,
    });
  },

  /**
   * 多空填字：点字卡填入第一个未填的空；填满四格自动判题。
   * 交互参照截图——字卡与空一一对应，不做四选一。
   */
  onMultiCardTap: function (event) {
    if (this.data.showResult) return;
    const key = event.currentTarget.dataset.key;
    const card = this.data.multiCardsView.find(function (item) { return item.key === key; });
    if (!card || card.used) return;

    const slotIndex = this.data.multiLinesView.findIndex(function (item) { return !item.filled; });
    if (slotIndex < 0) return;
    const lines = this.data.multiLinesView.map(function (item, i) {
      return Object.assign({}, item, {
        filled: i === slotIndex ? card.text : item.filled,
        state: i === slotIndex ? 'filled' : item.state,
      });
    });
    const cards = this.data.multiCardsView.map(function (item) {
      return Object.assign({}, item, { used: item.key === key ? true : item.used, wrong: false });
    });
    const allFilled = lines.every(function (item) { return !!item.filled; });
    this.setData({ multiLinesView: lines, multiCardsView: cards, matchHint: allFilled ? '' : '已填 ' + lines.filter(function (i) { return !!i.filled; }).length + '/4，接着填' });
    if (allFilled) this.judgeMultiFill();
  },

  /** 多空填字：点已填的空撤回字卡，可重新安排 */
  onMultiSlotTap: function (event) {
    if (this.data.showResult) return;
    const idx = Number(event.currentTarget.dataset.index);
    const slot = this.data.multiLinesView[idx];
    if (!slot || !slot.filled) return;
    const text = slot.filled;
    const lines = this.data.multiLinesView.map(function (item, i) {
      return Object.assign({}, item, { filled: i === idx ? '' : item.filled, state: i === idx ? '' : item.state });
    });
    const cards = this.data.multiCardsView.map(function (item) {
      return Object.assign({}, item, { used: item.text === text ? false : item.used, wrong: false });
    });
    this.setData({ multiLinesView: lines, multiCardsView: cards, matchHint: '取回一个字，换个位置试试', isWrong: false });
  },

  /** 多空填字：四格填满后逐空判定，全对才过关 */
  judgeMultiFill: function () {
    const q = this.data.current;
    const answers = q.multiLines || [];
    const filled = this.data.multiLinesView;
    const wrongIndexes = [];
    filled.forEach(function (item, i) {
      if (item.filled !== answers[i].answer) wrongIndexes.push(i);
    });
    if (!wrongIndexes.length) {
      const combo = this.data.combo + 1;
      const patch = {
        combo: combo,
        comboText: combo >= 2 ? '连对 ' + combo + ' 题，太顺啦！' : '',
        showResult: true,
        isWrong: false,
        feedback: q.correctFeedback || '四个字都填对啦！',
        matchHint: '',
        multiLinesView: filled.map(function (item) { return Object.assign({}, item, { state: 'right' }); }),
      };
      if (!this.data.questionHadWrong) {
        patch.firstCorrect = this.data.firstCorrect + 1;
        if (this.data.mode === 'wrong') {
          patch.masteredSignatures = this.data.masteredSignatures.concat([q.signature]);
        }
      }
      this.setData(patch);
      playCorrect();
      return;
    }
    this.setData({
      multiLinesView: filled.map(function (item, i) {
        return Object.assign({}, item, { state: wrongIndexes.indexOf(i) >= 0 ? 'wrong' : 'filled' });
      }),
      multiCardsView: this.data.multiCardsView.map(function (item) {
        return Object.assign({}, item, { wrong: wrongIndexes.some(function (i) { return filled[i].filled === item.text; }) });
      }),
      matchHint: '有 ' + wrongIndexes.length + ' 个字没放回位置，点一下空就能取回',
      combo: 0,
      comboText: '',
      isWrong: true,
      questionHadWrong: true,
      wrongCount: this.data.wrongCount + 1,
      feedback: '差一点点，再看看',
    });
    store.recordWrong(q);
    playWrong();
  },

  onLeftTap: function (event) {
    if (this.data.showResult) return;
    const key = event.currentTarget.dataset.key;
    const leftView = this.data.leftView.map(function (item) {
      const matched = item.matched;
      return {
        key: item.key,
        text: item.text,
        matched: matched,
        state: matched ? 'match-done' : (item.key === key ? 'match-selected' : ''),
      };
    });
    this.setData({ leftView: leftView, matchHint: '' });
  },

  onRightTap: function (event) {
    if (this.data.showResult) return;
    const rightKey = event.currentTarget.dataset.key;
    const leftKey = this.data.leftView.reduce(function (acc, item) {
      return item.state === 'match-selected' ? item.key : acc;
    }, '');
    const q = this.data.current;
    if (!leftKey) {
      this.setData({ matchHint: '先点左边的诗人，再点右边的诗句' });
      return;
    }
    if (this.data.rightView.some(function (item) { return item.key === rightKey && item.matched; })) return;

    if (q.answerMap[leftKey] === rightKey) {
      const leftView = this.data.leftView.map(function (item) {
        const matched = item.matched || item.key === leftKey;
        return { key: item.key, text: item.text, matched: matched, state: matched ? 'match-done' : '' };
      });
      const rightView = this.data.rightView.map(function (item) {
        const matched = item.matched || item.key === rightKey;
        return { key: item.key, text: item.text, matched: matched, state: matched ? 'match-done' : '' };
      });
      const done = leftView.every(function (item) { return item.matched; });
      const patch = {
        leftView: leftView,
        rightView: rightView,
        matchHint: done ? '' : '连上一组啦，继续',
      };
      if (done) {
        const combo = this.data.combo + 1;
        patch.combo = combo;
        patch.comboText = combo >= 2 ? '连对 ' + combo + ' 题，太顺啦！' : '';
        patch.showResult = true;
        patch.feedback = '四组全部连上啦，好眼力！';
        if (!this.data.questionHadWrong) {
          patch.firstCorrect = this.data.firstCorrect + 1;
          if (this.data.mode === 'wrong') {
            patch.masteredSignatures = this.data.masteredSignatures.concat([q.signature]);
          }
        }
      }
      this.setData(patch);
      if (done) playCorrect();
    } else {
      this.setData({
        matchHint: '这一组不是一对，再看看',
        combo: 0,
        comboText: '',
        questionHadWrong: true,
        wrongCount: this.data.wrongCount + 1,
        leftView: this.data.leftView.map(function (item) {
          return {
            key: item.key,
            text: item.text,
            matched: item.matched,
            state: item.matched ? 'match-done' : '',
          };
        }),
      });
      store.recordWrong(q);
      playWrong();
    }
  },

  onNext: function () {
    if (this.data.finishing) return;
    const next = this.data.index + 1;
    if (next >= this.data.total) {
      this.finish();
      return;
    }
    this.showQuestion(next);
  },

  onToggleTip: function () {
    this.setData({ tipVisible: !this.data.tipVisible });
  },

  onViewPoem: function () {
    const poemId = this.data.current.poemId;
    if (!poemId) return;
    wx.navigateTo({ url: '/pages/poem/poem?poemId=' + poemId });
  },

  onExit: function () {
    wx.showModal({
      title: '先歇一会儿？',
      content: '这次就不算通关啦，答错的题还留在错题本里，回来接着闯。',
      confirmText: '退出',
      cancelText: '继续答题',
      success: function (res) {
        if (res.confirm) wx.navigateBack();
      },
    });
  },

  finish: async function () {
    if (this.data.finishing) return;
    this.setData({ finishing: true });

    if (this.data.mode === 'wrong') {
      const mastered = this.data.masteredSignatures;
      mastered.forEach(function (sig) { store.removeWrong(sig); });
      await this.syncBeforeLeave();
      try { wx.showToast({ title: '已掌握 ' + mastered.length + ' 道错题', icon: 'none' }); } catch (e) {}
      const self = this;
      setTimeout(function () {
        self.setData({ finishing: false });
        try { wx.navigateBack(); } catch (e) {}
      }, 500);
      return;
    }

    // 结算数据：任何一步异常都只降级，不阻断跳转
    let result = { stars: 1, gained: 0 };
    let newSigns = [];
    try {
      result = store.completeLevel({
        levelId: this.data.levelId,
        wrongCount: this.data.wrongCount,
        firstCorrect: this.data.firstCorrect,
        totalQuestions: this.data.total,
      });
      // 通关把本关读到的诗收进诗签册，结算页展示新解锁的意象图
      this.data.questions.forEach(function (q) {
        if (q.poemId && store.collectPoem(q.poemId)) newSigns.push(q.poemId);
      });
    } catch (e) {
      console.warn('[Tangshi] settle failed, continue anyway', e);
    }

    await this.syncBeforeLeave();
    try { playClear(); } catch (e) { /* 音效永远不阻断结算 */ }

    const url = '/pages/result/result?levelId=' + this.data.levelId
      + '&stars=' + result.stars
      + '&gained=' + result.gained
      + '&wrongCount=' + this.data.wrongCount
      + '&total=' + this.data.total
      + '&signs=' + encodeURIComponent(newSigns.join(','));

    const totalLevels = catalog.getTotalLevels();
    const hasNext = this.data.levelId < totalLevels;
    const fallback = {
      stars: result.stars,
      gained: result.gained,
      wrongCount: this.data.wrongCount,
      total: this.data.total,
      signCount: newSigns.length,
      levelId: this.data.levelId,
      levelName: this.data.levelName,
      starOn: '★'.repeat(result.stars),
      starOff: '☆'.repeat(3 - result.stars),
      hasNext: hasNext,
      nextLabel: hasNext ? '冲下一关' : '回第一关',
    };
    this.navigateToResult(url, fallback);
  },

  /** 跳转结算页；预览器若不模拟页面路由，则退化为页内结算卡，保证点击一定有可见结果 */
  navigateToResult: function (url, fallback) {
    const self = this;
    let settled = false;
    const showFallback = function () {
      if (settled) return;
      settled = true;
      self.setData({ finishing: false, routeFailed: true, fallback: fallback });
    };
    const tryReLaunch = function () {
      try {
        if (typeof wx.reLaunch !== 'function') { showFallback(); return; }
        wx.reLaunch({ url: url, success: function () { settled = true; }, fail: showFallback });
        setTimeout(showFallback, 600);
      } catch (e) { showFallback(); }
    };
    try {
      if (typeof wx.redirectTo !== 'function') { showFallback(); return; }
      wx.redirectTo({
        url: url,
        success: function () { settled = true; },
        fail: tryReLaunch,
      });
      // 预览器可能既不回调 success 也不回调 fail（纯 stub），定时兜底
      setTimeout(showFallback, 1000);
    } catch (e) {
      tryReLaunch();
    }
  },

  /** 页内兜底：在当前页重新开一关，完全不依赖页面路由 */
  startLevelInPage: function (levelId) {
    const level = catalog.getLevel(levelId);
    if (!level) return false;
    const questions = buildQuestions(level);
    this.setData({
      routeFailed: false,
      finishing: false,
      fallback: null,
      mode: 'level',
      levelId: levelId,
      levelName: level.name,
      levelTier: catalog.getTierByIndex(level.tier).name,
      questions: questions,
      total: questions.length,
      wrongCount: 0,
      firstCorrect: 0,
      combo: 0,
      comboText: '',
      masteredSignatures: [],
    }, this.showQuestion.bind(this, 0));
    return true;
  },

  restartFromFallback: function () {
    this.startLevelInPage(this.data.levelId);
  },

  startNextFromFallback: function () {
    const total = catalog.getTotalLevels();
    const next = this.data.levelId + 1;
    this.startLevelInPage(next <= total ? next : 1);
  },

  syncBeforeLeave: async function () {
    let out;
    try {
      out = await withTimeout(store.flush(), 1500);
    } catch (e) {
      out = { error: null };
    }
    if (out && out.error && !out.timedOut) {
      try { wx.showToast({ title: '成绩会在联网后自动补存', icon: 'none' }); } catch (e) {}
    }
    return out;
  },
});
