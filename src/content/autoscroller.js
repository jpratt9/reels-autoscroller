// Content-script entry point. Watches the current short-form video and advances
// the feed when it ends, honouring playback speed, keyboard shortcuts, and the
// pause-on-comments setting. One instance per frame, guarded against duplicates.

(() => {
  const scope = typeof window !== 'undefined' ? window : globalThis;
  if (scope.__rasInstance) return;

  const isContextValid = () => {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  const idleCallback = (callback, options = {}) => {
    if (typeof window.requestIdleCallback === 'function') return window.requestIdleCallback(callback, options);
    return setTimeout(callback, options.timeout || 0);
  };

  class Scroller {
    constructor() {
      this.ui = new UI(this);
      this.platform = new Platform();
      this.settings = { ...DEFAULT_SETTINGS };
      this.contextInvalidated = false;
      this.lastKnownUrl = window.location.href;
      this.unsupportedPageSince = null;
      this.commentOpenScore = 0;

      this.state = {
        isEnabled: false,
        isScrolling: false,
        isPaused: false,
        currentVideo: null,
        observer: null,
        lastScrollTime: 0,
        videoStartTime: null,
        lastCommentCheck: 0,
        uiUpdateScheduled: false,
        pauseReasons: { user: false, comments: false },
      };

      this.statistics = {
        totalScrolls: 0,
        totalWatchTime: 0,
        lastActive: Date.now(),
      };
      this.scrolledVideos = {};

      this.shortcuts = { main: null, speedUp: null, speedDown: null, resetSpeed: null, pause: null };
      this.originalPlaybackRates = new WeakMap();

      this.timers = {
        url: null, videoCheck: null, scroll: null, scrollCheck: null,
        mutation: null, comments: null, statsSave: null,
      };

      this.handlers = {
        videoEnd: this.handleVideoEnd.bind(this),
        timeUpdate: this.handleTimeUpdate.bind(this),
        metadata: this.handleLoadedMetadata.bind(this),
        keyDown: this.handleKeyDown.bind(this),
        scroll: this.handleScroll.bind(this),
        beforeUnload: () => this.cleanup(),
      };

      this.init();
    }

    init() {
      this.loadSettings(() => {
        this.setupEventListeners();
        window.addEventListener('scroll', this.handlers.scroll, { passive: true });
        this.loadExtensionState();
      });
      this.loadStatistics();
      this.setupMessageListener();
      window.addEventListener('beforeunload', this.handlers.beforeUnload);
    }

    // --- settings ----------------------------------------------------------

    loadSettings(callback = () => {}) {
      if (!isContextValid()) {
        this.contextInvalidated = true;
        return callback();
      }
      chrome.storage.local.get({ ...this.settings, statusIndicatorPositions: {} }).then((result) => {
        this.settings = result;
        this.settings.playbackSpeed = clamp(this.settings.playbackSpeed, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED);
        this.updateShortcuts();
        callback();
      }).catch(() => callback());
    }

    updateShortcuts() {
      this.shortcuts.main = parseShortcutString(this.settings.keyboardShortcut);
      this.shortcuts.speedUp = parseShortcutString(this.settings.speedUpShortcut);
      this.shortcuts.speedDown = parseShortcutString(this.settings.speedDownShortcut);
      this.shortcuts.resetSpeed = parseShortcutString(this.settings.resetSpeedShortcut);
      this.shortcuts.pause = parseShortcutString(this.settings.pauseShortcut);
    }

    setupMessageListener() {
      chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        try {
          const status = () => ({ enabled: this.state.isEnabled, paused: this.state.isPaused, platform: this.platform.platform });
          switch (request.action) {
            case 'toggle':
              this.toggle();
              sendResponse(status());
              break;
            case 'getStatus':
              sendResponse(status());
              break;
            case 'togglePause':
              if (this.state.isEnabled) this.togglePause(request.forceState);
              sendResponse(status());
              break;
            case 'settingChanged':
              this.handleSettingChange(request.key, request.value);
              sendResponse({ ok: true });
              break;
            default:
              sendResponse({ ok: false });
          }
        } catch (_) {
          sendResponse({ ok: false });
        }
        return true;
      });
    }

    handleSettingChange(key, value) {
      if (!Object.hasOwn(this.settings, key)) return;
      this.settings[key] = value;
      switch (key) {
        case 'keyboardShortcuts':
          this.setupEventListeners();
          break;
        case 'autoEnable':
          if (!value) this.setStored({ extensionEnabled: false });
          else if (this.state.isEnabled) this.saveExtensionState();
          this.syncUrlMonitoring();
          break;
        case 'pauseOnComments':
          this.commentOpenScore = 0;
          if (!value) { this.stopCommentsMonitoring(); this.setPause('comments', false); }
          else if (this.state.isEnabled) { this.startCommentsMonitoring(); this.checkCommentsStatus(); }
          break;
        case 'keyboardShortcut':
        case 'speedUpShortcut':
        case 'speedDownShortcut':
        case 'resetSpeedShortcut':
        case 'pauseShortcut':
          this.updateShortcuts();
          break;
        case 'playbackSpeed':
          if (this.state.isEnabled && this.state.currentVideo &&
              Math.abs(this.state.currentVideo.playbackRate - value) > 0.01) {
            requestAnimationFrame(() => this.applyPlaybackSpeed());
          }
          break;
        case 'showStatusIndicator':
        case 'showVideoTime':
        case 'showProgressBar':
          this.updateUI();
          break;
        case 'indicatorOpacity':
        case 'indicatorAccentColor':
          this.ui.applyCustomStyles();
          this.updateUI();
          break;
      }
    }

    setupEventListeners() {
      document.removeEventListener('keydown', this.handlers.keyDown);
      if (this.settings.keyboardShortcuts) document.addEventListener('keydown', this.handlers.keyDown);
    }

    // --- persisted enable state & SPA navigation ---------------------------

    setStored(data) {
      try { chrome.storage.local.set(data).catch(() => {}); } catch (_) {}
    }

    saveExtensionState() {
      if (!isContextValid()) { this.contextInvalidated = true; return; }
      this.setStored({ extensionEnabled: this.state.isEnabled });
    }

    loadExtensionState() {
      if (!isContextValid()) { this.contextInvalidated = true; return; }
      if (!this.settings.autoEnable) {
        this.setStored({ extensionEnabled: false });
        return this.syncUrlMonitoring();
      }
      if (this.platform.getPlatform() && !this.state.isEnabled) this.toggle();
      this.syncUrlMonitoring();
    }

    startUrlMonitoring() {
      if (this.timers.url) return;
      this.timers.url = setInterval(() => this.handleUrlChange(), TIMING.URL_CHECK_INTERVAL);
    }

    stopUrlMonitoring() {
      clearInterval(this.timers.url);
      this.timers.url = null;
    }

    syncUrlMonitoring() {
      if (this.state.isEnabled || this.settings.autoEnable) this.startUrlMonitoring();
      else this.stopUrlMonitoring();
    }

    handleUrlChange() {
      const currentUrl = window.location.href;
      const urlChanged = currentUrl !== this.lastKnownUrl;
      if (urlChanged) this.lastKnownUrl = currentUrl;

      const previousPlatform = this.platform.getPlatform();
      const newPlatform = detectPlatform(currentUrl);
      const platformChanged = newPlatform !== previousPlatform;
      const enteredSupported = !previousPlatform && Boolean(newPlatform);

      if (platformChanged) {
        this.platform.clearScheduledActions();
        this.platform = new Platform();
      }

      const onSupported = Boolean(this.platform.getPlatform());
      if (onSupported) this.unsupportedPageSince = null;

      if (!onSupported) {
        if (!this.state.isEnabled) return this.updateUI();
        // Give SPAs a grace period before disabling: a route change can briefly
        // land on an unsupported URL mid-transition.
        if (this.unsupportedPageSince === null) {
          this.unsupportedPageSince = Date.now();
          return this.updateUI();
        }
        if (Date.now() - this.unsupportedPageSince < TIMING.UNSUPPORTED_PAGE_GRACE_MS) {
          return this.updateUI();
        }
        this.state.isEnabled = false;
        this.stopAutoScroll();
        this.saveExtensionState();
        return;
      }

      if (!this.state.isEnabled) {
        if (this.settings.autoEnable && (enteredSupported || platformChanged)) this.toggle();
        else this.updateUI();
        return;
      }

      if (platformChanged) {
        this.stopAutoScroll();
        this.startAutoScroll();
        return;
      }
      if (!this.timers.videoCheck || !this.state.observer) return this.startAutoScroll();
      this.findAndWatchCurrentVideo();
    }

    // --- keyboard ----------------------------------------------------------

    handleKeyDown(event) {
      if (!this.settings.keyboardShortcuts) return;

      if (matchesShortcut(event, this.shortcuts.main)) {
        event.preventDefault();
        return this.toggle();
      }
      if (matchesShortcut(event, this.shortcuts.pause)) {
        event.preventDefault();
        if (this.state.isEnabled) this.togglePause();
        return;
      }
      if (!this.state.isEnabled) return;

      if (matchesShortcut(event, this.shortcuts.speedUp)) {
        event.preventDefault();
        this.adjustPlaybackSpeed(VIDEO.SPEED_ADJUSTMENT_STEP);
      } else if (matchesShortcut(event, this.shortcuts.speedDown)) {
        event.preventDefault();
        this.adjustPlaybackSpeed(-VIDEO.SPEED_ADJUSTMENT_STEP);
      } else if (matchesShortcut(event, this.shortcuts.resetSpeed)) {
        event.preventDefault();
        this.resetPlaybackSpeed();
      }
    }

    // --- playback speed ----------------------------------------------------

    adjustPlaybackSpeed(delta) {
      const next = clamp(this.settings.playbackSpeed + delta, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED);
      if (Math.abs(next - this.settings.playbackSpeed) < 0.01) return;
      this.settings.playbackSpeed = next;
      this.ui.showSpeedToast(next);
      this.applyPlaybackSpeed();
      this.setStored({ playbackSpeed: next });
      if (this.settings.showStatusIndicator) this.updateUI();
    }

    resetPlaybackSpeed() {
      const def = VIDEO.DEFAULT_PLAYBACK_SPEED;
      if (Math.abs(this.settings.playbackSpeed - def) < 0.01) return;
      this.settings.playbackSpeed = def;
      this.ui.showSpeedToast(def);
      this.applyPlaybackSpeed();
      this.setStored({ playbackSpeed: def });
      if (this.settings.showStatusIndicator) this.updateUI();
    }

    applyPlaybackSpeed(force = false) {
      const video = this.state.currentVideo;
      if (!video) return;
      if (!this.originalPlaybackRates.has(video)) this.originalPlaybackRates.set(video, video.playbackRate);
      if (force || Math.abs(video.playbackRate - this.settings.playbackSpeed) > 0.01) {
        video.playbackRate = this.settings.playbackSpeed;
      }
    }

    restorePlaybackSpeed(video) {
      if (this.originalPlaybackRates.has(video)) {
        video.playbackRate = this.originalPlaybackRates.get(video);
        this.originalPlaybackRates.delete(video);
      } else {
        video.playbackRate = VIDEO.DEFAULT_PLAYBACK_SPEED;
      }
    }

    seekVideoTo(ratio) {
      const video = this.state.currentVideo;
      if (video?.duration) video.currentTime = video.duration * ratio;
    }

    // --- enable / pause ----------------------------------------------------

    toggle() {
      this.state.isEnabled = !this.state.isEnabled;
      if (this.state.isEnabled) this.startAutoScroll();
      else this.stopAutoScroll();
      this.saveExtensionState();
      return this.state.isEnabled;
    }

    togglePause(forceState = null) {
      if (!this.state.isEnabled) return this.state.isPaused;
      const next = forceState !== null ? Boolean(forceState) : !this.state.pauseReasons.user;
      return this.setPause('user', next);
    }

    resetPauseState() {
      const wasPaused = this.state.isPaused;
      this.state.pauseReasons = { user: false, comments: false };
      this.state.isPaused = false;
      if (wasPaused && this.settings.showStatusIndicator) this.updateUI();
    }

    setPause(reason, shouldPause) {
      if (this.state.pauseReasons[reason] === shouldPause) return this.state.isPaused;
      this.state.pauseReasons[reason] = shouldPause;
      const wasPaused = this.state.isPaused;
      this.state.isPaused = Object.values(this.state.pauseReasons).some(Boolean);

      if (this.state.isPaused) this.platform.clearScheduledActions();
      if (this.state.isPaused !== wasPaused) {
        if (!this.state.isPaused) this.resumeAfterPause();
        this.updateUI();
      } else if (reason === 'user') {
        this.updateUI();
      }
      return this.state.isPaused;
    }

    resumeAfterPause() {
      if (!this.state.isEnabled) return;
      if (!this.state.currentVideo) return this.findAndWatchCurrentVideo();
      this.applyPlaybackSpeed(true);
      const video = this.state.currentVideo;
      const nearEnd = Number.isFinite(video.duration) && video.duration - video.currentTime <= VIDEO.NEAR_END_THRESHOLD;
      if (video.ended || nearEnd) this.scrollToNext(true);
    }

    startAutoScroll() {
      this.resetPauseState();
      if (this.settings.pauseOnComments) {
        this.commentOpenScore = 0;
        this.checkCommentsStatus();
      }
      if (this.state.currentVideo) {
        if (!this.originalPlaybackRates.has(this.state.currentVideo)) {
          this.originalPlaybackRates.set(this.state.currentVideo, this.state.currentVideo.playbackRate);
        }
        this.applyPlaybackSpeed(true);
      }
      this.syncUrlMonitoring();
      this.startVideoDetection();
      this.startCommentsMonitoring();
      this.findAndWatchCurrentVideo();
      this.updateUI();
    }

    stopAutoScroll() {
      this.state.isScrolling = false;
      this.platform.clearScheduledActions();
      this.resetPauseState();
      this.stopCommentsMonitoring();

      clearTimeout(this.timers.scroll);
      this.timers.scroll = null;
      clearTimeout(this.timers.statsSave);
      this.timers.statsSave = null;
      this.saveStatistics();

      this.stopVideoDetection();
      this.syncUrlMonitoring();

      if (this.state.currentVideo) {
        this.restorePlaybackSpeed(this.state.currentVideo);
        this.detachVideoListeners(this.state.currentVideo);
      }
      document.querySelectorAll('video').forEach((video) => {
        if (video !== this.state.currentVideo && this.originalPlaybackRates.has(video)) {
          this.restorePlaybackSpeed(video);
        }
      });
      this.state.currentVideo = null;
      this.updateUI();
    }

    // --- video detection ---------------------------------------------------

    startVideoDetection() {
      if (!document.body) return;
      if (!this.state.observer) {
        this.state.observer = new MutationObserver(() => {
          if (!this.state.isEnabled || this.timers.mutation) return;
          this.timers.mutation = setTimeout(() => {
            this.timers.mutation = null;
            if (this.state.isEnabled) this.findAndWatchCurrentVideo();
          }, TIMING.SCROLL_DEBOUNCE);
        });
        this.state.observer.observe(document.body, { childList: true, subtree: true });
      }
      if (!this.timers.videoCheck) {
        this.timers.videoCheck = setInterval(() => {
          if (this.state.isEnabled && document.visibilityState === 'visible') this.findAndWatchCurrentVideo();
        }, TIMING.VIDEO_CHECK_INTERVAL);
      }
    }

    stopVideoDetection() {
      this.state.observer?.disconnect();
      this.state.observer = null;
      clearTimeout(this.timers.mutation);
      this.timers.mutation = null;
      clearInterval(this.timers.videoCheck);
      this.timers.videoCheck = null;
    }

    handleScroll() {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(this.timers.scrollCheck);
      this.timers.scrollCheck = setTimeout(() => {
        if (this.state.isEnabled) this.findAndWatchCurrentVideo();
      }, TIMING.SCROLL_DEBOUNCE);
    }

    findAndWatchCurrentVideo() {
      if (this.state.currentVideo && !this.state.currentVideo.isConnected) {
        this.detachVideoListeners(this.state.currentVideo);
        this.state.currentVideo = null;
      }
      const video = this.platform.findVideo();
      if (video && video !== this.state.currentVideo) this.watchVideo(video);
    }

    watchVideo(video) {
      if (this.state.currentVideo && this.state.currentVideo !== video) {
        this.detachVideoListeners(this.state.currentVideo);
        if (!this.state.isEnabled) this.restorePlaybackSpeed(this.state.currentVideo);
        this.platform.clearScheduledActions();
      }
      this.state.currentVideo = video;
      this.state.videoStartTime = Date.now();
      this.attachVideoListeners(video);
      if (this.state.isEnabled) this.applyPlaybackSpeed(true);
      requestAnimationFrame(() => this.updateUI());
    }

    attachVideoListeners(video) {
      video.addEventListener('ended', this.handlers.videoEnd);
      video.addEventListener('timeupdate', this.handlers.timeUpdate);
      video.addEventListener('loadedmetadata', this.handlers.metadata);
    }

    detachVideoListeners(video) {
      video.removeEventListener('ended', this.handlers.videoEnd);
      video.removeEventListener('timeupdate', this.handlers.timeUpdate);
      video.removeEventListener('loadedmetadata', this.handlers.metadata);
    }

    handleVideoEnd() {
      if (this.state.isEnabled && !this.state.isScrolling && !this.state.isPaused) {
        clearTimeout(this.timers.scroll);
        this.timers.scroll = null;
        this.scrollToNext();
      }
    }

    handleTimeUpdate() {
      if (!this.state.isEnabled || !this.state.currentVideo) return;
      const video = this.state.currentVideo;

      if (video.duration && !this.state.isScrolling && !this.state.isPaused) {
        const remaining = video.duration - video.currentTime;
        if (remaining <= VIDEO.END_THRESHOLD_SECONDS && remaining > 0) {
          clearTimeout(this.timers.scroll);
          this.timers.scroll = setTimeout(() => {
            if (!this.state.isScrolling) this.scrollToNext();
          }, remaining * 1000);
        }
      }

      if ((this.settings.showVideoTime || this.settings.showProgressBar) && !this.state.uiUpdateScheduled) {
        this.state.uiUpdateScheduled = true;
        requestAnimationFrame(() => {
          this.updateUI();
          this.state.uiUpdateScheduled = false;
        });
      }

      if (this.settings.pauseOnComments) {
        const now = Date.now();
        if (!this.state.lastCommentCheck || now - this.state.lastCommentCheck > TIMING.COMMENT_CHECK_INTERVAL) {
          this.state.lastCommentCheck = now;
          idleCallback(() => { if (this.state.isEnabled) this.checkCommentsStatus(); }, { timeout: TIMING.COMMENT_CHECK_TIMEOUT });
        }
      }
    }

    handleLoadedMetadata() {
      if (this.state.isEnabled) this.applyPlaybackSpeed(true);
    }

    scrollToNext(force = false) {
      if (this.contextInvalidated || !isContextValid()) return this.handleContextInvalidation();
      if (!this.state.isEnabled || this.state.isPaused) return;
      if (!force && Date.now() - this.state.lastScrollTime < TIMING.SCROLL_COOLDOWN) return;

      clearTimeout(this.timers.scroll);
      this.timers.scroll = null;

      if (this.state.videoStartTime && this.state.currentVideo) {
        const watch = (Date.now() - this.state.videoStartTime) / 1000;
        this.statistics.totalWatchTime += watch;
      }

      this.state.isScrolling = true;
      this.state.lastScrollTime = Date.now();
      this.state.videoStartTime = Date.now();

      const platform = this.platform.getPlatform();
      if (platform) {
        this.scrolledVideos[platform] = (this.scrolledVideos[platform] || 0) + 1;
        this.statistics.totalScrolls += 1;
        this.statistics.lastActive = Date.now();
        if (!this.timers.statsSave) {
          this.timers.statsSave = setTimeout(() => {
            this.saveStatistics();
            this.timers.statsSave = null;
          }, TIMING.STATISTICS_SAVE_DELAY);
        }
      }

      this.platform.scroll(this.state.currentVideo,
        () => this.state.isEnabled && !this.state.isPaused && !this.contextInvalidated);

      setTimeout(() => {
        this.state.isScrolling = false;
        if (this.state.isEnabled && !this.state.isPaused) this.findAndWatchCurrentVideo();
      }, TIMING.SCROLL_ANIMATION_DURATION);
    }

    // --- comments ----------------------------------------------------------

    checkCommentsStatus() {
      if (!this.settings.pauseOnComments) {
        this.commentOpenScore = 0;
        return this.setPause('comments', false);
      }
      // Hysteresis: a single frame of ambiguity shouldn't flip the pause state.
      const open = this.platform.areCommentsOpen();
      this.commentOpenScore = open
        ? Math.min(this.commentOpenScore + 1, 2)
        : Math.max(this.commentOpenScore - 1, -2);
      if (this.commentOpenScore >= 1) this.setPause('comments', true);
      else if (this.commentOpenScore <= -2) this.setPause('comments', false);
    }

    startCommentsMonitoring() {
      if (this.timers.comments || !this.settings.pauseOnComments) return;
      this.timers.comments = setInterval(() => {
        if (!this.state.isEnabled || this.contextInvalidated) return;
        this.state.lastCommentCheck = Date.now();
        this.checkCommentsStatus();
      }, TIMING.COMMENT_CHECK_INTERVAL);
    }

    stopCommentsMonitoring() {
      clearInterval(this.timers.comments);
      this.timers.comments = null;
    }

    // --- statistics --------------------------------------------------------

    loadStatistics() {
      if (!isContextValid()) { this.contextInvalidated = true; return; }
      chrome.storage.local.get({
        scrolledVideos: {},
        statistics: { totalScrolls: 0, totalWatchTime: 0, lastActive: Date.now() },
      }).then((result) => {
        this.scrolledVideos = result.scrolledVideos;
        this.statistics = {
          totalScrolls: result.statistics.totalScrolls || 0,
          totalWatchTime: result.statistics.totalWatchTime || 0,
          lastActive: result.statistics.lastActive || Date.now(),
        };
      }).catch(() => {});
    }

    saveStatistics() {
      if (!isContextValid()) { this.contextInvalidated = true; return; }
      this.setStored({
        scrolledVideos: this.scrolledVideos,
        statistics: {
          totalScrolls: this.statistics.totalScrolls,
          totalWatchTime: this.statistics.totalWatchTime,
          lastActive: Date.now(),
        },
      });
    }

    // --- lifecycle ---------------------------------------------------------

    updateUI() {
      const show = this.state.isEnabled && this.platform.getPlatform() !== null;
      this.ui.update(show, this.state.isPaused, this.settings.playbackSpeed, this.state.currentVideo, this.settings);
    }

    handleContextInvalidation() {
      if (this.contextInvalidated) return;
      this.contextInvalidated = true;
      this.platform.clearScheduledActions();
      this.stopUrlMonitoring();
      this.stopCommentsMonitoring();
      this.stopVideoDetection();
      clearTimeout(this.timers.scroll);
      clearTimeout(this.timers.scrollCheck);
      clearTimeout(this.timers.statsSave);
      try { this.ui.destroy(); } catch (_) {}
    }

    cleanup() {
      this.stopVideoDetection();
      this.stopCommentsMonitoring();
      this.platform.clearScheduledActions();
      this.stopUrlMonitoring();
      clearTimeout(this.timers.scroll);
      clearTimeout(this.timers.scrollCheck);
      clearTimeout(this.timers.statsSave);
      window.removeEventListener('scroll', this.handlers.scroll);
      this.ui?.destroy();
      this.saveStatistics();
      this.saveExtensionState();
      window.removeEventListener('beforeunload', this.handlers.beforeUnload);
    }
  }

  try {
    if (isContextValid()) scope.__rasInstance = new Scroller();
  } catch (error) {
    if (!String(error?.message).includes('Extension context invalidated')) throw error;
  }
})();
