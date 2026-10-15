// Shared constants for Reels AutoScroller.
// Loaded as a classic script (content script, popup, settings) — every top-level
// declaration here is visible to the scripts loaded after it in the same context.

const PLATFORMS = {
  INSTAGRAM: 'instagram',
  YOUTUBE: 'youtube',
  TIKTOK: 'tiktok',
  FACEBOOK: 'facebook',
};

const PLATFORM_NAMES = {
  [PLATFORMS.INSTAGRAM]: 'Instagram',
  [PLATFORMS.YOUTUBE]: 'YouTube',
  [PLATFORMS.TIKTOK]: 'TikTok',
  [PLATFORMS.FACEBOOK]: 'Facebook',
};

const PLATFORM_URLS = {
  [PLATFORMS.INSTAGRAM]: 'https://www.instagram.com/reels/',
  [PLATFORMS.YOUTUBE]: 'https://www.youtube.com/shorts',
  [PLATFORMS.TIKTOK]: 'https://www.tiktok.com/',
  [PLATFORMS.FACEBOOK]: 'https://www.facebook.com/reel/',
};

// Accent defaults to viewshot's green (#39d353); the user can override it.
const ACCENT_DEFAULT = '#39d353';

const DEFAULT_SETTINGS = {
  keyboardShortcuts: true,
  keyboardShortcut: 'Alt+T',
  pauseOnComments: false,
  autoEnable: false,
  playbackSpeed: 1,
  showStatusIndicator: true,
  showVideoTime: true,
  showProgressBar: true,
  speedUpShortcut: 'Alt+.',
  speedDownShortcut: 'Alt+,',
  resetSpeedShortcut: 'Alt+R',
  pauseShortcut: 'Alt+P',
  themePreference: 'auto',
  indicatorOpacity: 0.9,
  indicatorAccentColor: ACCENT_DEFAULT,
  platformPositions: {
    instagram: 'top-right',
    youtube: 'top-right',
    tiktok: 'top-right',
    facebook: 'top-right',
  },
};

const SHORTCUT_DEFAULTS = {
  MAIN: 'Alt+T',
  SPEED_UP: 'Alt+.',
  SPEED_DOWN: 'Alt+,',
  RESET_SPEED: 'Alt+R',
  PAUSE: 'Alt+P',
  HINT: 'Assign any key or combination to control Reels AutoScroller.',
};

const INDICATOR_POSITIONS = {
  'top-left': { top: '16px', left: '16px', right: 'auto', bottom: 'auto' },
  'top-right': { top: '16px', right: '16px', left: 'auto', bottom: 'auto' },
  'bottom-left': { bottom: '16px', left: '16px', right: 'auto', top: 'auto' },
  'bottom-right': { bottom: '16px', right: '16px', left: 'auto', top: 'auto' },
};

const TIMING = {
  SCROLL_COOLDOWN: 2000,
  SCROLL_ANIMATION_DURATION: 1000,
  URL_CHECK_INTERVAL: 1500,
  UNSUPPORTED_PAGE_GRACE_MS: 3500,
  STATISTICS_SAVE_DELAY: 10000,
  COMMENT_CHECK_INTERVAL: 200,
  COMMENT_CHECK_TIMEOUT: 100,
  SPEED_CHANGE_DEBOUNCE: 150,
  VIDEO_CHECK_INTERVAL: 750,
  SCROLL_DEBOUNCE: 100,
};

const VIDEO = {
  END_THRESHOLD_SECONDS: 0.5,
  NEAR_END_THRESHOLD: 0.3,
  MIN_PLAYBACK_SPEED: 0.1,
  MAX_PLAYBACK_SPEED: 5.0,
  DEFAULT_PLAYBACK_SPEED: 1.0,
  SPEED_ADJUSTMENT_STEP: 0.1,
};

const IMPORT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 500 * 1024,
  MAX_JSON_DEPTH: 10,
};

// Exported for the Node test suite; ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLATFORMS, PLATFORM_NAMES, PLATFORM_URLS, ACCENT_DEFAULT, DEFAULT_SETTINGS,
    SHORTCUT_DEFAULTS, INDICATOR_POSITIONS, TIMING, VIDEO, IMPORT_LIMITS,
  };
}
