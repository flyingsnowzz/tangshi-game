const store = require('../../utils/store.js');
const catalog = require('../../utils/catalog.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

// 吉祥物用内联图片数据，避免内置 H5 预览器解析不了包内绝对路径导致破图
const MASCOT = require('../../utils/illustration-data.js').MASCOT;
const TIER_WORDS = ['初', '进', '达', '元'];

createCloudPage({
  data: {
    mascotPath: MASCOT,
    summary: {},
    titleName: '',
    titleDesc: '',
    nextName: '',
    nextNeed: '',
    progress: 100,
    tiers: [],
    totalLevels: 0,
    collectedCount: 0,
    poemTotal: 0,
  },

  onCloudRefresh: function () {
    this.refresh();
  },

  refresh: function () {
    const summary = store.getSummary();
    const title = store.getTitle();
    const tiers = title.tiers.map(function (item, index) {
      const current = index === title.currentIndex;
      const reached = index <= title.currentIndex;
      let badgeClass = 'tier-badge-todo';
      let stateText = '待解锁';
      let stateClass = 'tier-state-todo';
      if (current) {
        badgeClass = 'tier-badge-current';
        stateText = '当前称号';
        stateClass = 'tier-state-current';
      } else if (reached) {
        badgeClass = 'tier-badge-done';
        stateText = '已达成';
        stateClass = 'tier-state-done';
      }
      return {
        name: item.name,
        desc: item.desc,
        badgeWord: TIER_WORDS[index] || '诗',
        badgeStep: index + 1,
        badgeClass: badgeClass,
        stateText: stateText,
        stateClass: stateClass,
        reached: reached,
        current: current,
        need: '通关 ' + item.needCleared + ' 关'
          + (item.needFullStar ? ' · 满星 ' + item.needFullStar + ' 关' : ''),
      };
    });

    this.setData({
      summary: summary,
      titleName: title.name,
      titleDesc: title.desc,
      nextName: title.next ? title.next.name : '',
      nextNeed: title.next
        ? '通关 ' + title.next.needCleared + ' 关'
          + (title.next.needFullStar ? ' · 满星 ' + title.next.needFullStar + ' 关' : '')
        : '',
      progress: title.progress,
      tiers: tiers,
      totalLevels: catalog.getTotalLevels(),
      collectedCount: summary.collectedCount,
      poemTotal: catalog.getPoems().length,
    });
  },

  resetAll: function () {
    const that = this;
    wx.showModal({
      title: '重置全部进度',
      content: '将清空云端保存的闯关记录、星级、积分、错题与称号，仅保留设置项。此操作不可撤销。',
      confirmText: '重置',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return;
        store.resetAll();
        that.refresh();
        wx.showToast({ title: '进度已重置', icon: 'none' });
      },
    });
  },
});
