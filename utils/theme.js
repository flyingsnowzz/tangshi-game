/** 字体大小档位：主要作用于诗句与全诗，兼顾长时间阅读的舒适度 */
const { getSettings } = require('./store.js');

const POEM_FONT = { small: 34, normal: 42, large: 52 };
const BODY_FONT = { small: 25, normal: 28, large: 32 };

function getFontSizes() {
  const size = getSettings().fontSize || 'normal';
  return {
    poemFs: POEM_FONT[size] || POEM_FONT.normal,
    bodyFs: BODY_FONT[size] || BODY_FONT.normal,
    level: size,
  };
}

module.exports = { getFontSizes, POEM_FONT, BODY_FONT };
