// Popup controller. Talks to the active tab's content script to toggle and pause
// auto-scroll, and persists speed / auto-enable to chrome.storage.local.

const svg = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" ${opts || 'fill="currentColor"'} stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON_DOWN = svg('<polyline points="5 8 12 14 19 8"/><polyline points="5 13 12 19 19 13"/>', 'fill="none" stroke="currentColor" stroke-width="2.2"');
const ICON_STOP = svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>');
const ICON_PAUSE = svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>');
const ICON_PLAY = svg('<path d="M8 5v14l11-7z"/>');

const PLATFORM_MATCHES = [
  'https://*.instagram.com/*',
  'https://*.youtube.com/*',
  'https://*.tiktok.com/*',
  'https://*.facebook.com/*',
];

// Apply the stored theme before first paint to avoid a flash.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', system);
  chrome.storage.local.get(['themePreference']).then((result) => {
    const pref = result.themePreference || 'auto';
    const theme = pref === 'auto' || pref === 'system' ? system : pref;
    document.documentElement.setAttribute('data-theme', theme);
  }).catch(() => {});
})();

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  const platformStatus = document.getElementById('platform-status');
  const toggleBtn = document.getElementById('toggle-btn');
  const toggleIco = document.getElementById('toggle-ico');
  const toggleLbl = document.getElementById('toggle-lbl');
  const pauseBtn = document.getElementById('pause-btn');
  const pauseIco = document.getElementById('pause-ico');
  const pauseLbl = document.getElementById('pause-lbl');
  const speedSlider = document.getElementById('playback-speed');
  const speedVal = document.getElementById('speed-val');
  const autoEnableToggle = document.getElementById('auto-enable-toggle');
  const versionText = document.getElementById('version-text');
  const settingsLink = document.getElementById('settings-link');

  toggleIco.innerHTML = ICON_DOWN;
  pauseIco.innerHTML = ICON_PAUSE;

  const openSettings = () => chrome.tabs.create({ url: chrome.runtime.getURL('src/settings/settings.html') });

  const ensureSupportedTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) throw new Error('NO_ACTIVE_TAB');
    const platform = detectPlatform(tab.url);
    if (!platform) throw new Error('UNSUPPORTED_PLATFORM');
    return { tabId: tab.id, platform };
  };

  const sendToActiveTab = async (message) => {
    const { tabId, platform } = await ensureSupportedTab();
    const response = await chrome.tabs.sendMessage(tabId, message);
    return { response, platform };
  };

  const setToggle = (enabled, disabled) => {
    toggleBtn.disabled = disabled;
    toggleBtn.classList.toggle('on', enabled);
    toggleIco.innerHTML = enabled ? ICON_STOP : ICON_DOWN;
    toggleLbl.textContent = enabled ? 'Disable Auto Scroll' : 'Enable Auto Scroll';
  };

  const setPause = (enabled, paused) => {
    pauseBtn.classList.toggle('hidden', !enabled);
    pauseBtn.disabled = !enabled;
    pauseIco.innerHTML = enabled && paused ? ICON_PLAY : ICON_PAUSE;
    pauseLbl.textContent = enabled && paused ? 'Resume Auto Scroll' : 'Pause Auto Scroll';
  };

  const handleUnsupported = () => {
    platformStatus.textContent = 'Unsupported platform';
    statusEl.classList.remove('active');
    setToggle(false, true);
    setPause(false, false);
  };

  const setInactive = (platform) => {
    platformStatus.textContent = `${PLATFORM_NAMES[platform]} — Inactive`;
    statusEl.classList.remove('active');
    setToggle(false, false);
    setPause(false, false);
  };

  const updateUI = (enabled, paused, platform) => {
    statusEl.classList.toggle('active', enabled);
    const label = !enabled ? 'Inactive' : paused ? 'Paused' : 'Active';
    platformStatus.textContent = `${PLATFORM_NAMES[platform]} — ${label}`;
    setToggle(enabled, false);
    setPause(enabled, paused);
  };

  const loadState = async (platform) => {
    try {
      const { response } = await sendToActiveTab({ action: 'getStatus' });
      if (!response) return setInactive(platform);
      updateUI(response.enabled, Boolean(response.paused), platform);
    } catch (error) {
      if (error?.message === 'UNSUPPORTED_PLATFORM') handleUnsupported();
      else setInactive(platform); // content script not injected yet
    }
  };

  const handleToggle = async () => {
    try {
      const { response, platform } = await sendToActiveTab({ action: 'toggle' });
      if (response) updateUI(response.enabled, Boolean(response.paused), platform);
    } catch (error) {
      if (error?.message === 'UNSUPPORTED_PLATFORM') handleUnsupported();
      else platformStatus.textContent = 'Please refresh the page';
    }
  };

  const handlePause = async () => {
    pauseBtn.disabled = true;
    try {
      const { response, platform } = await sendToActiveTab({ action: 'togglePause' });
      if (response) updateUI(response.enabled, Boolean(response.paused), platform);
    } catch (error) {
      pauseBtn.disabled = false;
      if (error?.message === 'UNSUPPORTED_PLATFORM') handleUnsupported();
    }
  };

  const broadcastSettingChange = async (key, value) => {
    try {
      const tabs = await chrome.tabs.query({ url: PLATFORM_MATCHES });
      for (const tab of tabs) {
        if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'settingChanged', key, value }).catch(() => {});
      }
    } catch (_) {}
  };

  const initPopup = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const platform = tab?.url ? detectPlatform(tab.url) : null;
      if (platform) loadState(platform);
      else handleUnsupported();
    } catch (_) {
      handleUnsupported();
    }
    toggleBtn.addEventListener('click', handleToggle);
    pauseBtn.addEventListener('click', handlePause);
    settingsLink.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
  };

  const initAutoEnable = async () => {
    try {
      const result = await chrome.storage.local.get({ autoEnable: DEFAULT_SETTINGS.autoEnable });
      autoEnableToggle.checked = Boolean(result.autoEnable);
    } catch (_) {
      autoEnableToggle.checked = DEFAULT_SETTINGS.autoEnable;
    }
    autoEnableToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      try {
        await chrome.storage.local.set({ autoEnable: enabled });
        broadcastSettingChange('autoEnable', enabled);
      } catch (_) {
        autoEnableToggle.checked = !enabled;
      }
    });
  };

  const initSpeed = () => {
    let saveTimeout = null;
    const render = (value) => {
      const v = clamp(value, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED);
      speedSlider.value = v;
      speedVal.textContent = `${v.toFixed(1)}×`;
    };
    speedSlider.addEventListener('input', (e) => {
      const speed = clamp(Number(e.target.value), VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED);
      render(speed);
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        try {
          await chrome.storage.local.set({ playbackSpeed: speed });
          broadcastSettingChange('playbackSpeed', speed);
        } catch (_) {}
      }, TIMING.SPEED_CHANGE_DEBOUNCE);
    });
    chrome.storage.local.get({ playbackSpeed: VIDEO.DEFAULT_PLAYBACK_SPEED })
      .then((r) => render(r.playbackSpeed)).catch(() => render(VIDEO.DEFAULT_PLAYBACK_SPEED));
  };

  const initQuickLinks = () => {
    for (const [platform, url] of Object.entries(PLATFORM_URLS)) {
      document.getElementById(`${platform}-shortcut`)?.addEventListener('click', () => chrome.tabs.create({ url }));
    }
  };

  try {
    versionText.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch (_) {}

  initPopup();
  initAutoEnable();
  initSpeed();
  initQuickLinks();
});
