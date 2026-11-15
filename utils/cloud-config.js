/**
 * 云服务公开配置，由 workbuddy_cloud_service 激活后返回的 publicConfig 原样写入。
 * 这些是面向终端用户的公开值，不含任何长期密钥；服务端按 Origin 精确匹配校验。
 * 更换应用或重新激活时，只需更新此处，不要改动调用方。
 */
const publicConfig = {
  resourceId: 'wbcs_p3lSHkMkSBoWfj96CMP75X',
  endpoint: 'https://mp-api.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_8EtpEJLf48z8RTIxXza7bm_QxXTc7NAB9UUa6uUIwNr6LnXiad251Yq',
  workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_8EtpEJLf48z8RTIxXza7bm',
};

module.exports = { publicConfig };
