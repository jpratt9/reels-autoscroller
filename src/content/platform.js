// Per-platform knowledge: which video is "current", how to advance the feed, and
// whether a comments panel is open. One instance is created per page/platform.

class Platform {
  constructor() {
    this.platform = detectPlatform(window.location.href);
    this.cachedScrollContainers = [];
    this.lastScrollContainerScan = 0;
    this.pendingTimeouts = new Set();
  }

  getPlatform() {
    return this.platform;
  }

  clearScheduledActions() {
    this.pendingTimeouts.forEach((id) => clearTimeout(id));
    this.pendingTimeouts.clear();
  }

  // Schedule a fallback scroll step, skipped if `canExecute` says the page has
  // already moved on. Each strategy is tried a little later than the last.
  schedule(action, delay, canExecute = null) {
    const id = setTimeout(() => {
      this.pendingTimeouts.delete(id);
      if (typeof canExecute === 'function' && !canExecute()) return;
      action();
    }, delay);
    this.pendingTimeouts.add(id);
    return id;
  }

  // --- current-video selection --------------------------------------------

  getAllVideoCandidates() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length <= 48) return videos;
    // Infinite feeds accumulate detached <video>s; favour the freshest, keep a
    // small head sample for players that stay near the top of the DOM.
    const merged = [...videos.slice(-36), ...videos.slice(0, 12)];
    const seen = new Set();
    return merged.filter((v) => v && !seen.has(v) && seen.add(v));
  }

  getVideoScore(video) {
    if (!(video instanceof HTMLVideoElement)) return -1;

    let rect;
    try {
      rect = video.getBoundingClientRect();
    } catch (_) {
      return -1;
    }
    if (!rect || rect.width <= 1 || rect.height <= 1) return -1;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    const visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const visibleArea = visibleW * visibleH;
    const ratio = visibleArea / Math.max(1, rect.width * rect.height);

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const centered = Math.abs(centerX - vw / 2) < vw * 0.35 && Math.abs(centerY - vh / 2) < vh * 0.35;

    let score = Math.min(visibleArea / 1000, 1000) + ratio * 300;
    if (!video.paused && video.currentTime > 0) score += 300;
    if (Number.isFinite(video.duration) && video.duration > 0) score += 120;
    if (centered) score += 140;
    return score;
  }

  getBestVideoCandidate(videos = []) {
    let best = null;
    let bestScore = -1;
    for (const video of videos) {
      const score = this.getVideoScore(video);
      if (score > bestScore) {
        bestScore = score;
        best = video;
      }
    }
    return best;
  }

  findVideo() {
    const all = this.getAllVideoCandidates();
    if (!all.length) return null;

    if (this.platform === PLATFORMS.YOUTUBE) {
      const prioritized = [
        ...document.querySelectorAll('#shorts-player video, ytd-reel-video-renderer video, video.video-stream'),
        ...all,
      ];
      return this.getBestVideoCandidate(prioritized);
    }

    const active = all.filter((v) => !v.paused && v.currentTime > 0);
    return this.getBestVideoCandidate(active) || this.getBestVideoCandidate(all);
  }

  // Free the decoded frames and buffered media of clips we've already scrolled
  // well past. Infinite feeds leave every watched <video> in the DOM with its
  // buffers intact, so without this the tab's memory grows without bound as the
  // feed advances. Only touches connected, non-current videos at least 1.5
  // viewports above the fold — never the current clip or anything on/approaching
  // screen — so a downward auto-scroll never drops a video it's about to play.
  // The site re-fetches the source if the user ever scrolls back up to it.
  releaseStaleVideos(currentVideo = null) {
    const vh = window.innerHeight || 0;
    if (!vh) return;
    for (const video of document.querySelectorAll('video')) {
      if (video === currentVideo) continue;
      if (!video.src && !video.currentSrc && !video.srcObject) continue; // already released
      let rect;
      try {
        rect = video.getBoundingClientRect();
      } catch (_) {
        continue;
      }
      if (rect.bottom >= -vh * 1.5) continue; // still on screen or just above — leave it
      try {
        video.pause();
        video.removeAttribute('src');
        if (video.srcObject) video.srcObject = null;
        video.load(); // aborts the media and releases its buffered data
      } catch (_) {}
    }
  }

  // --- advancing the feed --------------------------------------------------

  scroll(currentVideo = null, canExecute = null) {
    this.clearScheduledActions();
    switch (this.platform) {
      case PLATFORMS.INSTAGRAM: return this.scrollInstagram(currentVideo, canExecute);
      case PLATFORMS.YOUTUBE: return this.scrollYouTube(currentVideo, canExecute);
      case PLATFORMS.TIKTOK: return this.scrollTikTok(currentVideo, canExecute);
      case PLATFORMS.FACEBOOK: return this.scrollFacebook(canExecute);
    }
  }

  // A snapshot of scroll positions, so a later fallback can bail once anything
  // has actually moved — avoids a burst of strategies double-scrolling.
  captureSnapshot(currentVideo) {
    const containers = [];
    if (currentVideo) {
      let el = currentVideo.parentElement;
      let inspected = 0;
      while (el && inspected < 20) {
        inspected++;
        if (el.scrollHeight > el.clientHeight + 8) {
          const s = window.getComputedStyle(el);
          if (['auto', 'scroll'].includes(s.overflowY) || ['auto', 'scroll'].includes(s.overflow)) {
            containers.push({ element: el, scrollTop: el.scrollTop });
            break;
          }
        }
        el = el.parentElement;
      }
    }
    for (const sel of ['main[role="main"]', '[role="main"]']) {
      const main = document.querySelector(sel);
      if (main && main.scrollHeight > main.clientHeight + 8 && !containers.some((c) => c.element === main)) {
        containers.push({ element: main, scrollTop: main.scrollTop });
        break;
      }
    }
    return { windowScrollY: window.scrollY, containers };
  }

  hasScrolledSince(snapshot) {
    if (!snapshot) return false;
    if (Math.abs(window.scrollY - snapshot.windowScrollY) > 50) return true;
    return snapshot.containers.some(
      ({ element, scrollTop }) => element?.isConnected && Math.abs(element.scrollTop - scrollTop) > 50
    );
  }

  scrollInstagram(currentVideo, canExecute) {
    const canRun = () => (typeof canExecute === 'function' ? canExecute() : true);
    if (!canRun()) return;
    if (this.tryContainerScroll(['main[role="main"]', '[role="main"]'])) return;

    const snapshot = this.captureSnapshot(currentVideo);
    const go = () => canRun() && !this.hasScrolledSince(snapshot);
    this.schedule(() => dispatchKeyEvent(currentVideo), 100, go);
    this.schedule(() => dispatchWheelEvent(currentVideo, ['main[role="main"]', '[role="main"]']), 200, go);
    this.schedule(() => simulateVideoSwipe(currentVideo), 300, go);
    this.schedule(() => window.scrollBy(0, window.innerHeight), 400, go);
  }

  scrollYouTube(currentVideo, canExecute) {
    const canRun = () => (typeof canExecute === 'function' ? canExecute() : true);
    if (!canRun()) return;
    if (this.tryContainerScroll(['#shorts-container', 'ytd-shorts', 'ytd-reel-video-renderer', '#shorts-inner-container'])) return;

    const snapshot = this.captureSnapshot(currentVideo);
    const go = () => canRun() && !this.hasScrolledSince(snapshot);
    dispatchKeyEvent(currentVideo);
    this.schedule(() => {
      if (currentVideo && scrollNearestContainer(currentVideo)) return;
      window.scrollBy(0, window.innerHeight);
    }, 100, go);
  }

  scrollTikTok(currentVideo, canExecute) {
    const canRun = () => (typeof canExecute === 'function' ? canExecute() : true);
    if (!canRun()) return;
    if (this.tryContainerScroll(['[data-e2e="feed-container"]'])) return;

    const snapshot = this.captureSnapshot(currentVideo);
    const go = () => canRun() && !this.hasScrolledSince(snapshot);
    this.schedule(() => dispatchKeyEvent(currentVideo), 100, go);
    this.schedule(() => dispatchWheelEvent(currentVideo, ['[data-e2e="feed-container"]']), 200, go);
    this.schedule(() => simulateVideoSwipe(currentVideo), 300, go);
    this.schedule(() => window.scrollBy(0, window.innerHeight), 400, go);
  }

  scrollFacebook(canExecute) {
    const canRun = () => (typeof canExecute === 'function' ? canExecute() : true);
    if (!canRun()) return;

    const main = document.querySelector('[role="main"]') || document.body;
    if (typeof main.focus === 'function') {
      try { main.focus({ preventScroll: true }); } catch (_) { main.focus(); }
    }

    const fbContainers = [
      '[role="main"] [data-pagelet*="Reels"]',
      '[role="main"] [data-pagelet*="Video"]',
      '[role="main"] [data-visualcompletion="ignore-dynamic"]',
      '[role="main"] div[role="presentation"]',
      '[role="main"] div[style*="overflow"]',
    ];
    if (this.tryContainerScroll(fbContainers)) return;

    const fbVideo = document.querySelector('[role="main"] video') || null;
    const snapshot = this.captureSnapshot(fbVideo);
    const go = () => canRun() && !this.hasScrolledSince(snapshot);
    this.schedule(() => dispatchFacebookKeyEvent(), 120, go);
    this.schedule(() => dispatchWheelEvent(fbVideo, ['[role="main"]', '[role="main"] [data-visualcompletion="ignore-dynamic"]']), 240, go);
    this.schedule(() => { if (fbVideo) simulateVideoSwipe(fbVideo); }, 360, go);
    this.schedule(() => {
      if (fbVideo && scrollNearestContainer(fbVideo)) return;
      window.scrollBy(0, window.innerHeight);
    }, 480, go);
  }

  tryContainerScroll(additionalSelectors = []) {
    const baseSelectors = ['div[style*="overflow-y: auto"]', 'div[style*="overflow: auto"]'];

    const now = Date.now();
    if (!this.cachedScrollContainers.length || now - this.lastScrollContainerScan > 2000) {
      this.cachedScrollContainers = this.collectScrollableContainers(baseSelectors);
      this.lastScrollContainerScan = now;
    } else {
      this.cachedScrollContainers = this.cachedScrollContainers.filter((el) => el && document.contains(el));
    }

    const dynamic = additionalSelectors.map((s) => document.querySelector(s)).filter(Boolean);
    const containers = [...dynamic, ...this.cachedScrollContainers];

    for (const container of containers) {
      const before = container.scrollTop;
      container.scrollTop = before + window.innerHeight;
      if (container.scrollTop > before + 5) return true;
      container.scrollBy(0, window.innerHeight);
      if (container.scrollTop > before + 5) return true;
    }
    if (!dynamic.length) this.cachedScrollContainers = [];
    return false;
  }

  collectScrollableContainers(baseSelectors) {
    const containers = new Set();
    baseSelectors.map((s) => document.querySelector(s)).filter(Boolean).forEach((el) => containers.add(el));

    const scrollable = (el) => {
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 8) return false;
      const s = window.getComputedStyle(el);
      return ['auto', 'scroll'].includes(s.overflowY) || ['auto', 'scroll'].includes(s.overflow);
    };

    let inspected = 0;
    const maxCached = 30;
    const primary = document.querySelectorAll(
      'main, [role="main"], section, div[style*="overflow"], div[class*="scroll"], div[data-e2e*="feed"]'
    );
    for (const el of primary) {
      if (containers.size >= maxCached || inspected >= 150) break;
      inspected++;
      if (scrollable(el)) containers.add(el);
    }

    if (containers.size < 3) {
      for (const div of document.querySelectorAll('div')) {
        if (containers.size >= maxCached || inspected >= 350) break;
        inspected++;
        if (scrollable(div)) containers.add(div);
      }
    }
    return Array.from(containers);
  }

  // --- comments detection (for pause-on-comments) --------------------------

  areCommentsOpen() {
    switch (this.platform) {
      case PLATFORMS.INSTAGRAM:
        return this.instagramCommentsOpen();
      case PLATFORMS.YOUTUBE:
        return anyVisible([
          '#comments.ytd-reel-video-renderer',
          'ytd-comments#comments',
          'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
          'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]',
          '[target-id="engagement-panel-comments-section"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
        ]);
      case PLATFORMS.TIKTOK:
        return this.tiktokCommentsOpen();
      case PLATFORMS.FACEBOOK:
        return this.facebookCommentsOpen();
      default:
        return false;
    }
  }

  // Instagram's comment panel carries no dialog role; detect its input/textbox.
  instagramCommentsOpen() {
    const probe = { ignoreOpacity: true };
    const direct = [
      'input[placeholder*="omment" i]',
      '[role="textbox"][aria-label*="omment" i]',
      'textarea[placeholder*="omment" i]',
      'textarea[aria-label*="omment" i]',
      'div[role="dialog"][aria-label*="omment" i]',
    ];
    for (const sel of direct) {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el, probe)) return true;
    }
    for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
      if (!isElementVisible(dialog, probe)) continue;
      if (dialog.querySelector(
        'input[placeholder*="omment" i], [role="textbox"][aria-label*="omment" i], ' +
        'textarea[placeholder*="omment" i], [contenteditable="true"][aria-label*="omment" i]'
      )) return true;
    }
    return false;
  }

  tiktokCommentsOpen() {
    const probe = { ignoreOpacity: true, allowOffscreen: true };
    const panels = [
      '[data-e2e="comment-panel"]', '[data-e2e="comment-drawer"]', '[data-e2e="comment-popup"]',
      '[data-e2e="comment-container"]', '[data-e2e="comment-list-container"]',
      '[data-e2e="comment-stage"]', '[data-e2e="pc-comment-container"]',
    ];
    if (anyVisible(panels, probe)) return true;

    const fallbacks = [
      '[role="dialog"][aria-label*="omment" i]',
      '[data-e2e="comment-input"], textarea[placeholder*="omment" i]',
      '[data-e2e="comment-close"], [data-e2e="comment-close-icon"]',
    ];
    for (const sel of fallbacks) {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el, probe)) return true;
    }
    return Boolean(document.querySelector(
      '[data-e2e="comment-icon"][aria-pressed="true"], [data-e2e="comment-icon"][aria-expanded="true"], ' +
      '[aria-label*="omment" i][aria-expanded="true"], [aria-label*="omment" i][aria-pressed="true"]'
    ));
  }

  facebookCommentsOpen() {
    const probe = { ignoreOpacity: true, allowOffscreen: true };
    const panelSelectors = [
      '[role="dialog"][aria-label*="omment" i]',
      '[role="complementary"][aria-label*="omment" i]',
      '[role="region"][aria-label*="omment" i]',
      '[data-pagelet*="ReelsDock"] [data-visualcompletion="ignore-dynamic"]',
      '[data-pagelet*="Dock"] [role="dialog"]',
      '[data-pagelet*="Dock"] [role="complementary"]',
      '[role="main"] [aria-describedby*="omment" i]',
      '[role="main"] [data-pagelet*="Dock"]',
    ];

    const candidates = new Set();
    panelSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el && !el.matches('button, [role="button"]')) candidates.add(el);
      });
    });

    const composer = document.querySelector(
      'textarea[aria-label*="omment" i], div[role="textbox"][aria-label*="omment" i], div[role="textbox"][data-lexical-editor="true"]'
    );
    if (composer) {
      const container = composer.closest('[role="dialog"], [role="complementary"], [role="region"], [data-pagelet]');
      if (container && !container.matches('button, [role="button"]')) candidates.add(container);
    }

    if (Array.from(candidates).some((el) => isElementVisible(el, probe))) return true;

    const toggle = document.querySelector(
      '[aria-label*="omment" i][aria-pressed="true"], [aria-label*="omment" i][aria-expanded="true"]'
    );
    if (!toggle) return false;
    if ((toggle.getAttribute('role') || '').toLowerCase() !== 'button') return true;
    return toggle.getAttribute('aria-pressed') === 'true' || toggle.getAttribute('aria-expanded') === 'true';
  }
}
