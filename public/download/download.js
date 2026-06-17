/*
 * OpenJammer — /download enhancement
 * Vanilla JS, no framework, no service worker. Progressive enhancement on top
 * of a JS-off-safe page: index.html ships a <details open> all-platforms list
 * and static <a> links to /releases/latest. This script ONLY enhances:
 *   - detects the OS (never guesses Mac arch),
 *   - resolves the truly-latest asset URLs (baked JSON → REST → latest.json),
 *   - swaps in a detected-OS primary card and collapses the <details>.
 * On any detect throw it does nothing and leaves the shipped floor intact.
 *
 * The page NEVER serves bytes: every download <a> points at github.com /
 * objects.githubusercontent.com (Vercel bandwidth untouched).
 */
(function () {
  'use strict';

  var OWNER = 'ponderingBGI';
  var REPO = 'openjammer';
  var RELEASES_LATEST_WEB =
    'https://github.com/' + OWNER + '/' + REPO + '/releases/latest';
  var REST_LATEST =
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/latest';
  var LATEST_JSON =
    'https://github.com/' +
    OWNER +
    '/' +
    REPO +
    '/releases/latest/download/latest.json';
  var SESSION_KEY = 'oj-release-rest-v1';

  /*
   * Asset suffix regexes — match against assets[].name (NEVER literal filenames;
   * Tauri stamps the version into every name, so a literal path 404s each bump).
   * FOUNDER ACTION (ship-gate): confirm these against the FIRST published
   * release's real assets[].name and adjust if Tauri's naming differs.
   * Current expectation (Tauri v2 default naming):
   *   OpenJammer_<ver>_aarch64.dmg        macOS Apple Silicon
   *   OpenJammer_<ver>_x64.dmg            macOS Intel
   *   OpenJammer_<ver>_x64-setup.exe      Windows NSIS
   *   open-jammer_<ver>_amd64.deb         Linux .deb
   *   open-jammer_<ver>_amd64.AppImage    Linux AppImage
   */
  var SUFFIX = {
    'macos-arm': /_aarch64\.dmg$/,
    'macos-intel': /_x64\.dmg$/,
    windows: /_x64-setup\.exe$/,
    'linux-deb': /_amd64\.deb$/,
    'linux-appimage': /_amd64\.AppImage$/,
  };

  // Map a baked releases.json platform key → our internal target id.
  var BAKED_KEY = {
    'macos-arm': 'darwin-aarch64',
    'macos-intel': 'darwin-x86_64',
    windows: 'windows-x86_64',
    'linux-appimage': 'linux-x86_64-appimage',
    'linux-deb': 'linux-x86_64-deb',
  };

  // latest.json → updater platform key (fallback only; macOS keys point at the
  // updater .app.tar.gz, not a .dmg, so this sits BELOW the REST .dmg).
  var UPDATER_KEY = {
    'macos-arm': 'darwin-aarch64',
    'macos-intel': 'darwin-x86_64',
    windows: 'windows-x86_64',
    'linux-appimage': 'linux-x86_64',
    'linux-deb': 'linux-x86_64',
  };

  var LATENCY = {
    native: 'Lowest latency — under 5 ms MIDI-to-audio (native desktop).',
    browser:
      'No install, plays in your browser — ~15–25 ms latency.',
  };

  // A baked URL that still points at the /releases/latest web alias is NOT a
  // real per-asset download yet (pre-first-release placeholder) — treat it as
  // "no asset" so that target falls through to the visible floor.
  function isRealAsset(url) {
    return (
      typeof url === 'string' &&
      url.length > 0 &&
      url.indexOf('/releases/latest') === -1
    );
  }

  /* ---------------------------------------------------------------- detect */

  function uaFallbackOs() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Windows NT/.test(ua)) return 'windows';
    if (/Mac OS X/.test(ua) && !/iPhone|iPad|iPod/.test(ua)) return 'macos';
    if (/Linux|X11/.test(ua)) return 'linux';
    return null;
  }

  function normalizePlatformString(p) {
    if (!p) return null;
    var s = String(p).toLowerCase();
    if (s.indexOf('mac') !== -1) return 'macos';
    if (s.indexOf('win') !== -1) return 'windows';
    if (s.indexOf('android') !== -1) return 'android';
    if (s.indexOf('ios') !== -1 || s.indexOf('iphone') !== -1) return 'ios';
    if (s.indexOf('linux') !== -1) return 'linux';
    return null;
  }

  // Returns a Promise<{ os, arch?, archIsTrustworthy }>.
  function detectPlatform() {
    var uaData = navigator.userAgentData;
    // Synchronous low-entropy platform first.
    var os = (uaData && normalizePlatformString(uaData.platform)) || null;
    if (!os) os = uaFallbackOs();

    // No async signal available, or os unknown: resolve now.
    if (!os || !uaData || typeof uaData.getHighEntropyValues !== 'function') {
      return Promise.resolve(finishDetect(os, null));
    }

    return uaData
      .getHighEntropyValues(['architecture', 'bitness'])
      .then(function (hv) {
        var arch = null;
        if (hv && hv.architecture) {
          // 'arm' → arm64; 'x86' + bitness 64 → x64.
          if (hv.architecture === 'arm') arch = 'arm64';
          else if (hv.architecture === 'x86') arch = 'x64';
        }
        return finishDetect(os, arch);
      })
      .catch(function () {
        return finishDetect(os, null);
      });
  }

  function finishDetect(os, arch) {
    var archIsTrustworthy = arch != null;
    // HARD RULE: macOS arch is never trustworthy (Safari freezes UA to Intel,
    // Chromium reports x86 on Apple Silicon). Show both, never auto-pick.
    if (os === 'macos') archIsTrustworthy = false;
    return { os: os, arch: arch, archIsTrustworthy: archIsTrustworthy };
  }

  /* ----------------------------------------------------------- resolution */

  // A resolution result is a map: target id → download URL (or null/absent).
  // Targets: 'macos-arm','macos-intel','windows','linux-deb','linux-appimage'.

  function fromBaked(baked) {
    var out = {};
    if (!baked || !baked.platforms) return out;
    Object.keys(BAKED_KEY).forEach(function (target) {
      var entry = baked.platforms[BAKED_KEY[target]];
      var url = entry && entry.browser_download_url;
      if (isRealAsset(url)) out[target] = url;
    });
    return out;
  }

  function fromRestAssets(assets) {
    var out = {};
    if (!Array.isArray(assets)) return out;
    Object.keys(SUFFIX).forEach(function (target) {
      var rx = SUFFIX[target];
      for (var i = 0; i < assets.length; i++) {
        var a = assets[i];
        if (a && typeof a.name === 'string' && rx.test(a.name)) {
          if (isRealAsset(a.browser_download_url)) {
            out[target] = a.browser_download_url;
          }
          break;
        }
      }
    });
    return out;
  }

  function fromLatestJson(latest) {
    var out = {};
    if (!latest || !latest.platforms) return out;
    Object.keys(UPDATER_KEY).forEach(function (target) {
      var entry = latest.platforms[UPDATER_KEY[target]];
      var url = entry && entry.url;
      if (isRealAsset(url)) out[target] = url;
    });
    return out;
  }

  function readBaked() {
    // releases.json is baked next to this script; fetch it relative so it works
    // at /download/ regardless of host. Same-origin, cheap, cached.
    return fetch('/download/releases.json', { cache: 'no-cache' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function readRest() {
    var cached = null;
    try {
      cached = sessionStorage.getItem(SESSION_KEY);
    } catch (e) {
      /* sessionStorage may be unavailable (privacy mode) */
    }
    if (cached) {
      try {
        return Promise.resolve(JSON.parse(cached));
      } catch (e) {
        /* fall through to a live fetch */
      }
    }
    return fetch(REST_LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(function (r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (json) {
        if (json) {
          try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(json));
          } catch (e) {
            /* ignore quota / unavailable */
          }
        }
        return json;
      })
      .catch(function () {
        return null;
      });
  }

  function readLatestJson() {
    return fetch(LATEST_JSON)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  /* ------------------------------------------------------------- render */

  function setAnchor(id, url) {
    var el = document.getElementById(id);
    if (!el) return false;
    if (isRealAsset(url)) {
      el.href = url;
      el.hidden = false;
      return true;
    }
    return false;
  }

  // Hide a button (and its parent platform block if every button is gone) when a
  // target has no real asset — never leave a dead/disabled button.
  function hideAnchor(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function tidyEmptyPlatforms() {
    var blocks = document.querySelectorAll('.oj-other-body .oj-plat');
    Array.prototype.forEach.call(blocks, function (block) {
      var anyVisible = block.querySelector('.oj-btn:not([hidden])');
      block.hidden = !anyVisible;
    });
  }

  // Apply resolved URLs to the always-present all-platforms buttons. Returns the
  // count of targets that got a real asset.
  function applyToAllPlatforms(urls) {
    var n = 0;
    if (setAnchor('dl-macos-arm', urls['macos-arm'])) n++;
    else hideAnchor('dl-macos-arm');
    if (setAnchor('dl-macos-intel', urls['macos-intel'])) n++;
    else hideAnchor('dl-macos-intel');
    if (setAnchor('dl-windows', urls['windows'])) n++;
    else hideAnchor('dl-windows');
    if (setAnchor('dl-linux-appimage', urls['linux-appimage'])) n++;
    else hideAnchor('dl-linux-appimage');
    if (setAnchor('dl-linux-deb', urls['linux-deb'])) n++;
    else hideAnchor('dl-linux-deb');
    tidyEmptyPlatforms();
    return n;
  }

  function btn(href, label, opts) {
    opts = opts || {};
    var a = document.createElement('a');
    a.className = 'oj-btn';
    a.href = href;
    a.appendChild(document.createTextNode(label));
    if (opts.recommended) {
      var chip = document.createElement('span');
      chip.className = 'oj-chip';
      chip.textContent = 'Recommended';
      a.appendChild(chip);
    }
    return a;
  }

  // Build the detected-OS primary card. Returns true if a card was rendered
  // (i.e. at least one real button for this OS exists).
  function renderPrimary(detected, urls, version) {
    var os = detected.os;
    var slot = document.getElementById('oj-primary-slot');
    var section = document.getElementById('oj-primary');
    if (!slot || !section) return false;

    var card = document.createElement('div');
    card.className = 'oj-card';

    var heading = document.createElement('h2');
    heading.className = 'oj-card-os';

    var note = document.createElement('p');
    note.className = 'oj-card-note';

    var row = document.createElement('div');
    row.className = 'oj-btn-row';

    var rendered = false;

    if (os === 'macos') {
      heading.textContent = 'Download for macOS';
      note.textContent = LATENCY.native;
      // NEVER auto-pick arch: two equal buttons, Apple-Silicon-then-Intel.
      if (isRealAsset(urls['macos-arm'])) {
        row.appendChild(
          btn(urls['macos-arm'], 'Apple Silicon (M1–M4)', {
            recommended: true,
          })
        );
        rendered = true;
      }
      if (isRealAsset(urls['macos-intel'])) {
        row.appendChild(btn(urls['macos-intel'], 'Intel'));
        rendered = true;
      }
    } else if (os === 'windows') {
      heading.textContent = 'Download for Windows';
      note.textContent = LATENCY.native;
      if (isRealAsset(urls['windows'])) {
        row.appendChild(btn(urls['windows'], 'Windows (x64 installer)'));
        rendered = true;
      }
    } else if (os === 'linux') {
      heading.textContent = 'Download for Linux';
      note.textContent = LATENCY.native;
      if (isRealAsset(urls['linux-appimage'])) {
        row.appendChild(btn(urls['linux-appimage'], 'AppImage (x86_64)'));
        rendered = true;
      }
      if (isRealAsset(urls['linux-deb'])) {
        row.appendChild(btn(urls['linux-deb'], '.deb (x86_64)'));
        rendered = true;
      }
    } else if (os === 'ios' || os === 'android') {
      // Mobile is never a dead end: browser PWA is the primary CTA.
      heading.textContent = 'Play in your browser';
      note.textContent = LATENCY.browser;
      var play = document.createElement('a');
      play.className = 'oj-btn';
      play.href = 'https://openjammer.app';
      play.textContent = 'Open OpenJammer →';
      row.appendChild(play);
      var quiet = document.createElement('p');
      quiet.className = 'oj-card-note';
      quiet.style.marginTop = '0.85rem';
      quiet.style.marginBottom = '0';
      quiet.textContent =
        'The downloads below are desktop builds — here for later.';
      card.appendChild(heading);
      card.appendChild(note);
      card.appendChild(row);
      card.appendChild(quiet);
      slot.appendChild(card);
      section.hidden = false;
      // Keep the desktop <details> open on mobile (no desktop OS to collapse to).
      setVersion(version);
      return true;
    } else {
      // Unknown OS: no primary card, leave the floor visible.
      return false;
    }

    if (!rendered) return false;
    card.appendChild(heading);
    card.appendChild(note);
    card.appendChild(row);
    slot.appendChild(card);
    section.hidden = false;
    setVersion(version);
    return true;
  }

  function setVersion(version) {
    var el = document.getElementById('oj-version');
    if (el && version && version !== 'alpha') {
      el.textContent = version;
    }
  }

  // After a clean DESKTOP detect, the detected OS is shown in the primary card —
  // drop its duplicate block from the always-visible "other platforms" list and
  // retitle. With no usable primary (mobile / regex miss / unknown / JS-off), the
  // list stays titled "All platforms" and shows every platform that has an asset.
  function updateOtherPlatforms(hideOs) {
    var title = document.getElementById('oj-other-title');
    if (title) title.textContent = hideOs ? 'Other platforms' : 'All platforms';
    var blocks = document.querySelectorAll('.oj-other-body .oj-plat');
    Array.prototype.forEach.call(blocks, function (block) {
      if (hideOs && block.getAttribute('data-os') === hideOs) {
        block.hidden = true; // it lives in the primary card above
      }
    });
  }

  /* --------------------------------------------------------------- main */

  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var src = arguments[i] || {};
      Object.keys(src).forEach(function (k) {
        if (isRealAsset(src[k])) out[k] = src[k];
      });
    }
    return out;
  }

  function run() {
    var detected;
    try {
      // Resolve sources in parallel; detect can run alongside.
      var pDetect = detectPlatform();
      var pBaked = readBaked();

      Promise.all([pDetect, pBaked])
        .then(function (res) {
          detected = res[0];
          var baked = res[1];
          var version = (baked && baked.version) || 'latest';

          // Instant default render from the baked JSON.
          var bakedUrls = fromBaked(baked);
          applyAndRender(detected, bakedUrls, version, baked);

          // Live upgrade: REST first (real .dmg for macOS), then latest.json.
          readRest()
            .then(function (rest) {
              if (rest) {
                var restUrls = fromRestAssets(rest.assets);
                var v = rest.tag_name || version;
                if (Object.keys(restUrls).length > 0) {
                  applyAndRender(detected, merge(bakedUrls, restUrls), v, rest);
                  return;
                }
              }
              // REST empty/down → latest.json fallback (rate-limit-free).
              return readLatestJson().then(function (latest) {
                if (latest) {
                  var ljUrls = fromLatestJson(latest);
                  var v2 = latest.version || version;
                  if (Object.keys(ljUrls).length > 0) {
                    applyAndRender(
                      detected,
                      merge(bakedUrls, ljUrls),
                      v2,
                      latest
                    );
                  }
                }
              });
            })
            .catch(function () {
              /* keep the baked render; floor stays intact */
            });
        })
        .catch(function () {
          /* detect or baked read threw: do nothing, floor is already shipped */
        });
    } catch (e) {
      /* synchronous throw: leave the JS-off floor exactly as shipped */
    }
  }

  // Idempotent: clears any prior primary card, re-applies URLs, re-renders.
  function applyAndRender(detected, urls, version, raw) {
    // Always refresh the all-platforms buttons with the freshest URLs.
    applyToAllPlatforms(urls);

    // Rebuild the primary card from scratch each upgrade.
    var slot = document.getElementById('oj-primary-slot');
    var section = document.getElementById('oj-primary');
    if (slot) slot.innerHTML = '';
    if (section) section.hidden = true;

    var hasPrimary = renderPrimary(detected, urls, version);

    // Desktop detect with a real card → hide that OS from the "other" list (it's
    // in the primary card). Mobile / unknown / regex miss → keep all listed.
    var isDesktop = hasPrimary && detected.os !== 'ios' && detected.os !== 'android';
    updateOtherPlatforms(isDesktop ? detected.os : null);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
