const store = require('../../utils/store.js');
const { TYPE_NAMES } = require('../../utils/question-factory.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

// 吉祥物用内联图片数据，避免内置 H5 预览器解析不了包内绝对路径导致破图
const MASCOT = require('../../utils/illustration-data.js').MASCOT;

createCloudPage({
  data: {
    mascotPath: MASCOT,
    list: [],
    count: 0,
  },

  onCloudRefresh: function () {
    this.refresh();
  },

  refresh: function () {
    const list = store.getWrongBook().map(function (item) {
      const q = item.question;
      let excerpt = q.masked || q.mainText || '诗人与诗句配对';
      if (excerpt.length > 24) excerpt = excerpt.slice(0, 24) + '…';
      return {
        signature: item.signature,
        typeName: q.typeName || TYPE_NAMES[q.type] || '诗词题',
        excerpt: excerpt,
        title: q.poemTitle || '多首诗作',
        author: q.poemAuthor || '',
        wrongCount: item.wrongCount,
        poemId: q.poemId || '',
      };
    });
    this.setData({ list: list, count: list.length });
  },

  redoAll: function () {
    if (!this.data.count) {
      wx.showToast({ title: '错题本是空的', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=wrong' });
  },

  viewPoem: function (event) {
    const poemId = event.currentTarget.dataset.poemid;
    if (!poemId) {
      wx.showToast({ title: '配对题请直接重做', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/poem/poem?poemId=' + poemId });
  },

  removeOne: function (event) {
    const signature = event.currentTarget.dataset.signature;
    store.removeWrong(signature);
    this.refresh();
    wx.showToast({ title: '已移出错题本', icon: 'none' });
  },

  clearAll: function () {
    if (!this.data.count) return;
    const that = this;
    wx.showModal({
      title: '清空错题本',
      content: '将移除全部 ' + this.data.count + ' 道错题，此操作不可撤销。',
      confirmText: '清空',
      cancelText: '再想想',
      success: function (res) {
        if (!res.confirm) return;
        store.clearWrong();
        that.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      },
    });
  },
});
