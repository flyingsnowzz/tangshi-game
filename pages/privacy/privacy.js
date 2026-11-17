/**
 * 隐私政策页。
 *
 * 联系邮箱用于隐私政策中的数据删除请求与政策咨询。
 */
Page({
  data: {
    updateDate: '2026年11月17日',
    contactEmail: 'zhanglei@doxue.com',
  },

  onCopyEmail: function () {
    const email = this.data.contactEmail;
    if (!email || email.indexOf('@') < 0) {
      wx.showToast({ title: '请联系开发者获取邮箱', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: email,
      success: function () {
        wx.showToast({ title: '邮箱已复制', icon: 'none' });
      },
    });
  },
});
