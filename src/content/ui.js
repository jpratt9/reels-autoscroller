// The on-page status indicator: a draggable pill showing Active/Paused + speed,
// the current video time, and a seekable progress bar. All class names are
// ras-prefixed so nothing collides with the host page's styles.

const RAS_ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const RAS_ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

class UI {
  constructor(scroller) {
    this.scroller = scroller;
    this.indicator = null;
    this.speedToast = null;
    this.speedToastTimeout = null;
    this.el = {};
    this.onStorageChange = null;
    this.themeQuery = null;
    this.onThemeChange = null;
    this.themeListenerAttached = false;
    this.cleanups = [];
  }

  get settings() {
    return this.scroller?.settings || {};
  }

  createIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'ras-indicator';
    indicator.className = 'ras-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');

    indicator.innerHTML = `
      <div class="ras-header">
        <div class="ras-text">
          <div class="ras-primary"></div>
          <div class="ras-time"></div>
        </div>
        <button class="ras-toggle" type="button" aria-label="Pause auto scroll">${RAS_ICON_PAUSE}</button>
      </div>
      <div class="ras-progress">
        <div class="ras-progress-track">
          <div class="ras-progress-fill"></div>
          <div class="ras-progress-thumb"></div>
        </div>
      </div>`;

    document.body.appendChild(indicator);
    this.indicator = indicator;
    this.el = {
      primary: indicator.querySelector('.ras-primary'),
      time: indicator.querySelector('.ras-time'),
      progress: indicator.querySelector('.ras-progress'),
      progressTrack: indicator.querySelector('.ras-progress-track'),
      progressFill: indicator.querySelector('.ras-progress-fill'),
      progressThumb: indicator.querySelector('.ras-progress-thumb'),
      toggle: indicator.querySelector('.ras-toggle'),
    };

    this.el.toggle.addEventListener('click', () => this.scroller.togglePause());

    this.applyPosition();
    this.setupDrag();
    this.setupSeeking();
    this.applyTheme();
    this.setupThemeListener();
    this.applyCustomStyles();
  }

  // --- theming -------------------------------------------------------------

  resolveTheme() {
    const preference = this.settings.themePreference || 'auto';
    if (preference === 'system' || preference === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return preference;
  }

  applyTheme() {
    const theme = this.resolveTheme();
    this.indicator?.setAttribute('data-theme', theme);
    this.speedToast?.setAttribute('data-theme', theme);
  }

  setupThemeListener() {
    if (this.themeListenerAttached) return;

    this.onStorageChange = (changes, area) => {
      if (area !== 'local') return;
      if (this.scroller?.settings) {
        Object.keys(changes).forEach((key) => {
          this.scroller.settings[key] = changes[key].newValue;
        });
      }
      if (changes.themePreference) this.applyTheme();
      if (changes.platformPositions || changes.statusIndicatorPositions) this.applyPosition();
      if (changes.indicatorOpacity || changes.indicatorAccentColor) this.applyCustomStyles();
    };
    try {
      chrome.storage.onChanged.addListener(this.onStorageChange);
    } catch (_) {}

    this.themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.onThemeChange = () => this.applyTheme();
    this.themeQuery.addEventListener?.('change', this.onThemeChange);
    this.themeListenerAttached = true;
  }

  teardownThemeListener() {
    if (!this.themeListenerAttached) return;
    try {
      if (this.onStorageChange) chrome.storage.onChanged.removeListener(this.onStorageChange);
    } catch (_) {}
    this.themeQuery?.removeEventListener?.('change', this.onThemeChange);
    this.onStorageChange = this.onThemeChange = this.themeQuery = null;
    this.themeListenerAttached = false;
  }

  applyCustomStyles() {
    const opacity = this.settings.indicatorOpacity ?? DEFAULT_SETTINGS.indicatorOpacity;
    const accent = this.settings.indicatorAccentColor || ACCENT_DEFAULT;
    if (this.indicator) this.indicator.style.opacity = opacity;
    [this.indicator, this.speedToast].filter(Boolean).forEach((el) => {
      el.style.setProperty('--ras-accent', accent);
    });
  }

  // --- positioning & dragging ---------------------------------------------

  platformName() {
    const host = window.location.hostname.replace(/^www\./, '');
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('youtube')) return 'youtube';
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('facebook')) return 'facebook';
    return 'default';
  }

  storageKey() {
    return `indicatorPosition_${window.location.hostname.replace(/^www\./, '') || 'default'}`;
  }

  applyPosition() {
    if (!this.indicator) return;
    const platform = this.platformName();
    const preset = (this.settings.platformPositions || {})[platform] || 'top-right';

    const set = (pos) => Object.assign(this.indicator.style, {
      top: pos.top ?? 'auto', left: pos.left ?? 'auto', right: pos.right ?? 'auto', bottom: pos.bottom ?? 'auto',
    });

    if (preset !== 'custom' && INDICATOR_POSITIONS[preset]) {
      set(INDICATOR_POSITIONS[preset]);
      return;
    }
    const saved = (this.settings.statusIndicatorPositions || {})[this.storageKey()];
    set(saved || INDICATOR_POSITIONS['top-right']);
  }

  savePosition() {
    const key = this.storageKey();
    const platform = this.platformName();
    const position = {
      top: this.indicator.style.top, left: this.indicator.style.left,
      right: this.indicator.style.right, bottom: this.indicator.style.bottom,
    };
    this.storageGet({ statusIndicatorPositions: {}, platformPositions: {} }, (result) => {
      const positions = result.statusIndicatorPositions || {};
      const platformPositions = result.platformPositions || {};
      positions[key] = position;
      platformPositions[platform] = 'custom';
      this.storageSet({ statusIndicatorPositions: positions, platformPositions });
    });
  }

  setupDrag() {
    const node = this.indicator;
    let pointerId = null;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const begin = () => {
      dragging = true;
      moved = true;
      node.classList.add('ras-dragging');
      if (pointerId !== null) {
        try { node.setPointerCapture(pointerId); } catch (_) {}
      }
    };

    const move = (clientX, clientY) => {
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 5) return;
        begin();
      }
      const maxLeft = Math.max(0, window.innerWidth - node.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - node.offsetHeight);
      node.style.left = `${Math.max(0, Math.min(startLeft + dx, maxLeft))}px`;
      node.style.top = `${Math.max(0, Math.min(startTop + dy, maxTop))}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
    };

    const stopTracking = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      move(e.clientX, e.clientY);
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      try { node.releasePointerCapture(pointerId); } catch (_) {}
      if (moved) this.savePosition();
      stopTracking();
      dragging = false;
      moved = false;
      pointerId = null;
      node.classList.remove('ras-dragging');
    };

    const onDown = (e) => {
      if (pointerId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.ras-toggle, .ras-progress')) return; // let controls work

      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      const rect = node.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
      e.preventDefault();
    };

    node.addEventListener('pointerdown', onDown);
    this.cleanups.push(() => {
      stopTracking();
      node.removeEventListener('pointerdown', onDown);
    });
  }

  setupSeeking() {
    let seeking = false;
    const seek = (e) => {
      const rect = this.el.progressTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.scroller.seekVideoTo(ratio);
    };
    const onMove = (e) => { if (seeking) seek(e); };
    const stop = () => {
      seeking = false;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', stop, true);
      document.removeEventListener('pointercancel', stop, true);
    };
    const onDown = (e) => {
      seeking = true;
      seek(e);
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', stop, true);
      document.addEventListener('pointercancel', stop, true);
      e.stopPropagation();
    };
    this.el.progress.addEventListener('pointerdown', onDown);
    this.cleanups.push(() => {
      this.el.progress.removeEventListener('pointerdown', onDown);
      stop();
    });
  }

  // --- storage shims (null-safe when context is torn down) -----------------

  storageGet(query, callback) {
    try {
      chrome.storage.local.get(query).then((r) => callback(r || {})).catch(() => callback({}));
    } catch (_) {
      callback({});
    }
  }

  storageSet(data) {
    try {
      chrome.storage.local.set(data).catch(() => {});
    } catch (_) {}
  }

  // --- updates -------------------------------------------------------------

  update(isActive, isPaused, playbackSpeed, video, settings) {
    if (!isActive || !settings.showStatusIndicator) {
      this.indicator?.classList.add('ras-hidden');
      return;
    }
    if (!this.indicator) this.createIndicator();
    else { this.applyTheme(); this.applyCustomStyles(); }

    this.indicator.classList.remove('ras-hidden');
    this.updateToggle(isPaused);

    this.el.primary.textContent = `${isPaused ? 'Paused' : 'Active'} • ${playbackSpeed.toFixed(1)}×`;

    if (settings.showVideoTime) {
      this.el.time.textContent = video?.duration
        ? `${this.formatTime(video.currentTime)} / ${this.formatTime(video.duration)}`
        : '0:00 / 0:00';
      this.el.time.classList.remove('ras-hidden');
    } else {
      this.el.time.classList.add('ras-hidden');
    }

    if (settings.showProgressBar) {
      this.el.progress.classList.remove('ras-hidden');
      if (video?.duration) this.updateProgress(video);
    } else {
      this.el.progress.classList.add('ras-hidden');
    }
  }

  updateToggle(isPaused) {
    const { toggle } = this.el;
    if (!toggle) return;
    const label = isPaused ? 'Resume auto scroll' : 'Pause auto scroll';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(isPaused));
    toggle.innerHTML = isPaused ? RAS_ICON_PLAY : RAS_ICON_PAUSE;
  }

  updateProgress(video) {
    const ratio = video.currentTime / video.duration;
    this.el.progressFill.style.transform = `scaleX(${ratio})`;
    this.el.progressThumb.style.left = `${ratio * 100}%`; // centred via CSS translate(-50%)
  }

  showSpeedToast(speed) {
    if (!this.speedToast) {
      this.speedToast = document.createElement('div');
      this.speedToast.id = 'ras-speed-toast';
      this.speedToast.className = 'ras-speed-toast';
      document.body.appendChild(this.speedToast);
      this.applyCustomStyles();
    }
    this.speedToast.setAttribute('data-theme', this.resolveTheme());
    this.speedToast.textContent = `Speed ${speed.toFixed(1)}×`;
    this.speedToast.classList.add('ras-visible');

    clearTimeout(this.speedToastTimeout);
    this.speedToastTimeout = setTimeout(() => {
      this.speedToast?.classList.remove('ras-visible');
    }, 1200);
  }

  formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  destroy() {
    this.teardownThemeListener();
    this.cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
    this.cleanups = [];
    clearTimeout(this.speedToastTimeout);
    this.speedToastTimeout = null;
    this.indicator?.remove();
    this.speedToast?.remove();
    this.indicator = this.speedToast = null;
    this.el = {};
  }
}
