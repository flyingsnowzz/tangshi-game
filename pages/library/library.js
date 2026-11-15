const catalog = require('../../utils/catalog.js');
const store = require('../../utils/store.js');
const order = require('../../utils/poem-order.js');
const { createCloudPage } = require('../../utils/cloud-page.js');

createCloudPage({
  data: {
    filters: [],
    activeFilter: 'all',
    keyword: '',
    list: [],
    shown: 0,
    total: 0,
  },

  onCloudFirst: function (options) {
    // 首页「我的诗签册」会带 filter=collected 进来，直接停在已收藏视图
    const start = (options && options.filter) || 'all';
    this.setData({
      filters: order.gradeFilters().concat([{ key: 'collected', name: '已收藏' }]),
      activeFilter: start,
      total: catalog.getPoems().length,
    });
    this.applyFilter();
  },

  // 从详情页返回、或收藏状态变化后，重算列表里的「已收进诗签册」标记
  onCloudRefresh: function () {
    this.applyFilter();
  },

  applyFilter: function () {
    const filter = this.data.activeFilter;
    const kw = (this.data.keyword || '').trim();
    let poems = order.orderedPoems();
    if (filter === 'collected') {
      const collected = store.getCollected();
      poems = poems.filter(function (p) { return collected.indexOf(p.id) >= 0; });
    } else if (filter !== 'all') {
      poems = poems.filter(function (p) { return p.grade === filter; });
    }
    if (kw) {
      poems = poems.filter(function (p) {
        return p.title.indexOf(kw) >= 0 || p.author.indexOf(kw) >= 0;
      });
    }
    const collected = store.getCollected();
    const list = poems.map(function (p) {
      return {
        id: p.id,
        title: p.title,
        author: p.author,
        form: p.form,
        grade: p.grade,
        firstLine: Array.isArray(p.displayLines) && p.displayLines.length
          ? p.displayLines[0]
          : (Array.isArray(p.lines) && p.lines.length ? p.lines[0] : ''),
        collected: collected.indexOf(p.id) >= 0,
      };
    });
    this.setData({ list: list, shown: list.length });
  },

  onFilterTap: function (event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeFilter) return;
    this.setData({ activeFilter: key });
    this.applyFilter();
  },

  onSearch: function (event) {
    this.setData({ keyword: event.detail.value });
    this.applyFilter();
  },

  onClearSearch: function () {
    if (!this.data.keyword) return;
    this.setData({ keyword: '' });
    this.applyFilter();
  },

  onPoemTap: function (event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/poem/poem?poemId=' + id });
  },
});
