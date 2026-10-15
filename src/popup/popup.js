// Popup controller. Talks to the active tab's content script to toggle and pause
// auto-scroll, and persists speed / auto-enable / theme to chrome.storage.local.

const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

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
  const toggleBtn = document.getElementById('toggle-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const platformStatus = document.getElementById('platform-status');
  const statusEl = document.getElementById('status');
  const themeToggle = document.getElementById('theme-toggle');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsLink = document.getElementById('settings-link');
  const speedSlider = document.getElementById('playback-speed');
  const speedInput = document.getElementById('playback-speed-input');
  const autoEnableToggle = document.getElementById('auto-enable-toggle');
  const versionText = document.getElementById('version-text');

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

  const setInactive = (platform) => {
    platformStatus.textContent = `${PLATFORM_NAMES[platform]} – Inactive`;
    toggleBtn.disabled = false;
    toggleBtn.textContent = 'Enable Auto Scroll';
    toggleBtn.className = 'btn btn-primary';
    updatePauseButton(false, false);
  };

  const handleUnsupported = () => {
    platformStatus.textContent = 'Unsupported platform';
    statusEl.classList.remove('active');
    toggleBtn.disabled = true;
    updatePauseButton(false, false);
  };

  const updateUI = (enabled, paused, platform) => {
    toggleBtn.textContent = enabled ? 'Disable Auto Scroll' : 'Enable Auto Scroll';
    toggleBtn.className = enabled ? 'btn btn-success' : 'btn btn-primary';
    statusEl.classList.toggle('active', enabled);
    const label = !enabled ? 'Inactive' : paused ? 'Paused' : 'Active';
    platformStatus.textContent = `${PLATFORM_NAMES[platform]} – ${label}`;
    updatePauseButton(enabled, paused);
  };

  function updatePauseButton(enabled, paused) {
    pauseBtn.classList.toggle('hidden', !enabled);
    pauseBtn.disabled = !enabled;
    pauseBtn.textContent = enabled && paused ? 'Resume Auto Scroll' : 'Pause Auto Scroll';
    pauseBtn.setAttribute('aria-pressed', enabled && paused ? 'true' : 'false');
  }

  const loadState = async (platform) => {
    try {
      const { response } = await sendToActiveTab({ action: 'getStatus' });
      if (!response) return setInactive(platform);
      updateUI(response.enabled, Boolean(response.paused), platform);
      toggleBtn.disabled = false;
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
      pauseBtn.disabled = false;
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
    settingsBtn.addEventListener('click', openSettings);
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
      speedInput.value = v.toFixed(1);
    };

    const onChange = async (e) => {
      const raw = Number(e.target.value);
      if (!Number.isFinite(raw)) {
        const result = await chrome.storage.local.get({ playbackSpeed: VIDEO.DEFAULT_PLAYBACK_SPEED }).catch(() => ({}));
        return render(result.playbackSpeed ?? VIDEO.DEFAULT_PLAYBACK_SPEED);
      }
      const speed = clamp(raw, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED);
      render(speed);
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        try {
          await chrome.storage.local.set({ playbackSpeed: speed });
          broadcastSettingChange('playbackSpeed', speed);
        } catch (_) {}
      }, TIMING.SPEED_CHANGE_DEBOUNCE);
    };

    chrome.storage.local.get({ playbackSpeed: VIDEO.DEFAULT_PLAYBACK_SPEED })
      .then((r) => render(r.playbackSpeed)).catch(() => render(VIDEO.DEFAULT_PLAYBACK_SPEED));

    speedSlider.addEventListener('input', onChange);
    speedInput.addEventListener('change', onChange);
  };

  const setTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
    const next = theme === 'dark' ? 'light' : 'dark';
    themeToggle.title = `Switch to ${next} mode`;
    themeToggle.setAttribute('aria-label', `Switch to ${next} mode`);
  };

  const resolveTheme = (pref) =>
    pref === 'auto' || pref === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : pref;

  const initTheme = async () => {
    try {
      const result = await chrome.storage.local.get(['themePreference']);
      setTheme(resolveTheme(result.themePreference || 'auto'));
    } catch (_) {
      setTheme(resolveTheme('auto'));
    }
    themeToggle.addEventListener('click', async () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        await chrome.storage.local.set({ themePreference: next });
      } catch (_) {}
      setTheme(next);
    });
  };

  const initQuickLinks = () => {
    for (const [platform, url] of Object.entries(PLATFORM_URLS)) {
      document.getElementById(`${platform}-shortcut`)?.addEventListener('click', () => chrome.tabs.create({ url }));
    }
  };

  try {
    versionText.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch (_) {}

  initTheme();
  initPopup();
  initAutoEnable();
  initSpeed();
  initQuickLinks();
});
