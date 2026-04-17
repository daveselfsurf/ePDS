/**
 * Shared HTML snippets for the preview route index pages served by
 * pds-core and auth-service. Keeping these here avoids two copies that
 * would drift apart: the behaviour (live-bound client_id input, links
 * updated on input, localStorage persistence) should be identical on
 * both services.
 */

/**
 * <label> + <input> markup for the persisted client_id field. The
 * surrounding page is expected to have CSS that styles label/input — we
 * don't emit styles here so each index page can keep its own look.
 */
export const PREVIEW_CLIENT_ID_INPUT_HTML = `<label for="client-id-input">Client metadata URL (persisted in this browser):</label>
  <input id="client-id-input" type="url" placeholder="https://your-app.example/client-metadata.json" autocomplete="url" spellcheck="false">
  <div id="validation" class="validation" aria-live="polite"></div>`

/**
 * Block that surfaces the live state of the shared client-metadata
 * cache. Preview routes themselves always bypass this cache; what's
 * shown here is what real OAuth flows on this service are currently
 * seeing — useful for answering "has my branding.css change reached
 * real users yet?".
 *
 * Populated + kept fresh by PREVIEW_CACHE_STATUS_SCRIPT_HTML.
 */
export const PREVIEW_CACHE_STATUS_HTML = `<section id="cache-status" class="cache-status" aria-live="polite">
    <h2>Real-flow metadata cache</h2>
    <p class="cache-status-hint">Preview routes always re-fetch client metadata, so edits to your <code>branding.css</code> show up on the next refresh here. The list below reflects what real OAuth flows are still seeing — each entry is cached for 10 minutes from its last real fetch, so until it expires, real users won't pick up your changes yet.</p>
    <div id="cache-status-body"><em>Loading…</em></div>
  </section>`

/**
 * Inline <script> that wires the client_id input to every
 * `a[data-preview-link]` on the page: typing in the input rewrites each
 * link's `?client_id=...` param live, and the value is persisted to
 * localStorage under a shared key so the next visit starts with the
 * same value.
 *
 * The snippet is self-contained — no template placeholders, nothing
 * interpolated from user input — so it's safe to embed verbatim inside
 * a <script> tag.
 */
export const PREVIEW_CLIENT_ID_SCRIPT_HTML = `<script>
(function () {
  var STORAGE_KEY = 'epds:preview:client_id';
  var input = document.getElementById('client-id-input');
  if (input) wireClientIdInput(input);
  wireCacheStatus();

  function escape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function wireClientIdInput(input) {
    function applyToLinks(value) {
      var links = document.querySelectorAll('a[data-preview-link]');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var base = a.getAttribute('data-preview-href') || a.getAttribute('href');
        a.setAttribute('data-preview-href', base);
        var url = new URL(base, window.location.origin);
        if (value) {
          url.searchParams.set('client_id', value);
        } else {
          url.searchParams.delete('client_id');
        }
        a.setAttribute('href', url.pathname + url.search);
      }
    }

    var validationBox = document.getElementById('validation');
    var validateToken = 0; // invalidate stale in-flight results

    var ICONS = { ok: '✅', warn: '⚠️', error: '❌' };

    function renderValidation(payload) {
      if (!validationBox) return;
      if (!payload || !payload.url) {
        validationBox.innerHTML = '';
        return;
      }
      if (!payload.checks.length) {
        validationBox.innerHTML = '';
        return;
      }
      var rows = payload.checks.map(function (c) {
        var icon = ICONS[c.severity] || '•';
        return (
          '<li class="validation-row validation-' + c.severity + '" title="' +
          escape(c.detail) + '"><span class="validation-icon" aria-hidden="true">' +
          icon + '</span><span class="validation-label">' + escape(c.label) +
          '</span><span class="validation-detail">' + escape(c.detail) +
          '</span></li>'
        );
      }).join('');
      validationBox.innerHTML = '<ul class="validation-list">' + rows + '</ul>';
    }

    function runValidation(value) {
      if (!validationBox) return;
      var myToken = ++validateToken;
      if (!value) {
        renderValidation(null);
        return;
      }
      validationBox.innerHTML =
        '<p class="validation-loading"><em>Checking metadata…</em></p>';
      fetch('/preview/validate?client_id=' + encodeURIComponent(value), {
        cache: 'no-store',
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (payload) {
          if (myToken !== validateToken) return; // a newer input invalidated this
          renderValidation(payload);
        })
        .catch(function () {
          if (myToken !== validateToken) return;
          validationBox.innerHTML =
            '<p class="validation-error-inline">Validation request failed.</p>';
        });
    }

    var debounceTimer;
    function scheduleValidation(value) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { runValidation(value); }, 400);
    }

    try {
      var saved = window.localStorage.getItem(STORAGE_KEY) || '';
      input.value = saved;
      applyToLinks(saved);
      if (saved) runValidation(saved); // no debounce on initial load
    } catch (_) {
      applyToLinks('');
    }

    input.addEventListener('input', function () {
      var v = input.value.trim();
      try {
        if (v) window.localStorage.setItem(STORAGE_KEY, v);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch (_) { /* ignore */ }
      applyToLinks(v);
      scheduleValidation(v);
    });
  }

  function wireCacheStatus() {
    var body = document.getElementById('cache-status-body');
    if (!body) return;

    // Entries are refetched every 15s; the countdown ticks client-side
    // every second against the server's "now" captured at fetch time
    // (skewTo = serverNow - Date.now()), so clock drift between server
    // and client doesn't matter.
    var entries = [];
    var skewTo = 0;

    function fmt(ms) {
      if (ms <= 0) return 'expired';
      var s = Math.round(ms / 1000);
      var m = Math.floor(s / 60);
      s = s - m * 60;
      if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
      return s + 's';
    }

    function render() {
      if (!entries.length) {
        body.innerHTML = '<p><em>No entries currently cached.</em></p>';
        return;
      }
      var now = Date.now() + skewTo;
      var rows = entries
        .map(function (e) {
          var href = escape(e.clientId);
          return (
            '<li class="cache-entry">' +
            '<a class="cache-entry-url" href="' + href + '" target="_blank" rel="noopener">' +
            escape(e.clientId) +
            '</a>' +
            '<span class="cache-entry-ttl">' + fmt(e.expiresAt - now) + '</span>' +
            '<button type="button" class="cache-entry-preview" data-client-id="' +
            href + '" title="Copy this URL into the input above so you can preview it">Preview</button>' +
            '</li>'
          );
        })
        .join('');
      body.innerHTML = '<ul class="cache-entries">' + rows + '</ul>';
    }

    // Event delegation: the Preview buttons are re-rendered on every
    // refresh, so attach one listener on the static container instead of
    // re-wiring per-entry.
    body.addEventListener('click', function (ev) {
      var target = ev.target;
      if (!(target && target.classList && target.classList.contains('cache-entry-preview'))) return;
      var clientId = target.getAttribute('data-client-id');
      if (!clientId) return;
      var fieldInput = document.getElementById('client-id-input');
      if (!fieldInput) return;
      fieldInput.value = clientId;
      fieldInput.dispatchEvent(new Event('input', { bubbles: true }));
      fieldInput.focus();
      fieldInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    function refresh() {
      fetch('/preview/cache-status', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (payload) {
          if (!payload) return;
          skewTo = payload.now - Date.now();
          entries = payload.entries || [];
          render();
        })
        .catch(function () { /* ignore transient errors */ });
    }

    refresh();
    setInterval(refresh, 15000);
    setInterval(render, 1000);
  }
})();
</script>`
