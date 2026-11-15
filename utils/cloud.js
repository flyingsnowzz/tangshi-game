/**
 * 全局唯一的云客户端实例。所有页面、数据层、登录组件共用它。
 * 小程序没有 location.origin，endpoint 必须显式取自 publicConfig。
 */
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');
const { publicConfig } = require('./cloud-config');

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  workBuddyOAuthClientId: publicConfig.workBuddyOAuthClientId,
  wx: createDiagnosticWx(wx),
});

module.exports = { cloud };
