/**
 * 隐私政策页。
 *
 * 【上架前必改】contactEmail 是占位值，必须替换成真实可联系邮箱后再提审，
 * 否则审核会以「隐私政策缺少有效联系方式」驳回。
 */
Page({
  data: {
    updateDate: '2026年11月17日',
    // TODO(上架前必改)：换成真实邮箱，如 support@你的域名.com
    contactEmail: '请替换成真实邮箱',
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
