/**
 * 背景音乐配置（真实无版权音乐，不走合成）。
 *
 * 设计（对齐「配图走服务器、不打包」的方案）：
 *  - remoteUrl 指向你自己服务器/CDN 上托管的 MP3（部署文档有上传与填地址步骤）；
 *    微信真机优先播放远程真实音乐，浏览器预览器也直接播这个 URL。
 *  - 远程加载失败（断网 / 域名未配 / 404 / 跨域）时，自动回退到包内同一首真实
 *    钢琴曲 /assets/audio/bgm.mp3（22 秒 / 130KB，首尾淡入淡出 + 响度归一）。
 *  - 内置 H5 预览器解析不了包内绝对路径，预览器改播 utils/bgm-data.js 内联的
 *    同一份音频（base64 data URI），所以预览与真机听到的是同一段真乐曲，
 *    而不是过去那种 900ms 一声的合成提示音。
 *  - 再失败则彻底静默，绝不打断答题、翻页、结算等业务流程。
 *
 * 授权：候选曲目均为 Public Domain Mark / CC0 / 纯 CC-BY，无 NC/ND/SA 限制。
 *  CC-BY 曲目须署名（填 credit），PD/CC0 无需署名。
 *
 * 部署前 remoteUrl 留空（默认走包内真实钢琴兜底）；把音乐传到服务器后，
 * 只需把 remoteUrl 改成对应的 https 地址，无需改其它代码。
 */
module.exports = {
  bgm: {
    // 部署后改成你的服务器地址，例如：
    // remoteUrl: 'https://your-domain.com/audio/bgm-bach-aria.mp3',
    remoteUrl: '',

    // 已下载并校验的真实无版权曲目（文件在 music-assets/server/，部署时任选一首上传）。
    // 默认推荐 Bach《哥德堡变奏曲》咏叹调：Public Domain，无需署名，舒缓空灵。
    recommended: [
      {
        file: 'bgm-bach-aria.mp3',
        title: 'Bach — Goldberg Variations, Aria',
        composer: 'Johann Sebastian Bach (1685–1750)',
        license: 'Public Domain Mark 1.0',
        credit: '',
        note: '舒缓空灵、无署名负担，默认首选。时长 4:52，循环不易听出重复。',
      },
      {
        file: 'bgm-chopin-albumleaf.mp3',
        title: 'Chopin — Albumleaf in E major',
        composer: 'Frédéric Chopin (1810–1849)',
        license: 'CC0 1.0',
        credit: '',
        note: '短小抒情、温柔，1:35；Musopen 公有领域录音，无署名负担。',
      },
      {
        file: 'bgm-satie-gnossiennes.mp3',
        title: 'Satie — Three Gnossiennes & 1st Gymnopédie',
        composer: 'Erik Satie (1866–1925)',
        license: 'CC-BY 3.0',
        credit: 'Erik Satie; performed by Rafi Simcha (CC BY 3.0)',
        note: '最「温柔梦幻」的钢琴，但需按 CC-BY 署名。演奏者 Rafi Simcha。',
      },
    ],

    // 包内兜底：Bach 咏叹调 00:20–00:42 截取的真实钢琴片段（22s 循环，非合成）。
    fallback: '/assets/audio/bgm.mp3',

    // 若选了 CC-BY 曲目（Satie），必须把署名写在这里并在游戏内展示。
    credit: '',
    license: '',
  },
};
