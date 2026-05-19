// Snippet: Listener Monitor Tab
//
// Injects a "Monitor" tab into the IQGeo myWorld app tab bar (next to Details,
// Layers, Help) using the tabControl.addTab() API.
//
// Tracks listener counts for:
//   - App events  (app._events)
//   - Map events  (app.map.listeners_ - OL internal API)
//   - Plugins     (app.plugins[id]._events - per-event-type sub-rows)
//
// Per event, stores:
//   { initial, peak, peakAt (ISO timestamp), milestones[] }
//
//   milestones: wall-clock timestamps recorded the first time a count crosses
//   +25%, +50%, +100%, +200%, +500%, or +1000% above its initial value
//   (minimum absolute increase of 2 required to qualify). Provides a growth
//   trajectory that is unaffected by idle time between interactions.
//
// Session persistence:
//   Completed sessions are written to localStorage['myw_monitor_sessions'] on
//   page unload - no user action required. Up to 50 sessions are retained.
//   The "All Sessions" column in the UI reflects peaks across all stored sessions.
//
// UI columns: Initial | Current (+ delta) | This Session | All Sessions (N)
//
// Usage:
//   Paste into DevTools console while the app is running.
//   Re-running the snippet while a monitor is already active switches to the
//   existing tab (no duplicate install).
//   Save Report button downloads myw-monitor-{date}-{time}.json with all
//   stored sessions and full milestone trajectories.
//   To remove: window._mywMonitor.destroy()

(async function installMonitor() {
    'use strict';

    function waitFor(predicate, timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                const val = predicate();
                if (val) return resolve(val);
                if (Date.now() - start >= timeoutMs) return reject(new Error('waitFor: timeout'));
                setTimeout(tick, 500);
            };
            tick();
        });
    }

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------
    const TAB_ID          = 'myw-monitor';
    const TAB_TITLE       = 'Monitor';
    const LS_KEY          = 'myw_monitor_sessions';
    const MAX_SESSIONS       = 50;
    const DISPLAY_TICK_MS    = 5000;
    const MILESTONE_PCTS     = [25, 50, 100, 200, 500, 1000]; // % above initial
    const MILESTONE_MIN_ABS  = 2;                             // minimum absolute increase to qualify

    const APP_EVENTS = [
        'change',
        'currentFeature-changed',
        'currentFeatureSet-changed',
        'currentFeature-deleted',
        'nativeAppMode-changed',
        'database-view-changed',
        'featureCollection-modified',
    ];

    const MAP_EVENTS = [
        'zoomend',
        'precompose',
        'postrender',
        'movestart',
        'moveend',
    ];

    // -------------------------------------------------------------------------
    // Guard: re-use existing monitor
    // -------------------------------------------------------------------------
    if (window._mywMonitor) {
        const tc = window.myw?.app?.layout?.controls?.tabControl;
        tc?.switchToTab(TAB_ID);
        console.info('[myw-monitor] Already active. Switched to Monitor tab.');
        return;
    }

    // -------------------------------------------------------------------------
    // App handles
    // -------------------------------------------------------------------------
    let app, tabControl;
    try {
        ({ app, tabControl } = await waitFor(() => {
            const a = window.myw?.app;
            const tc = a?.layout?.controls?.tabControl;
            return (a && tc) ? { app: a, tabControl: tc } : null;
        }));
    } catch (_) {
        console.error('[myw-monitor] App or tabControl not found after waiting - is this an IQGeo app page?');
        return;
    }

    // -------------------------------------------------------------------------
    // Snapshot helpers
    // -------------------------------------------------------------------------
    function countListeners(eventsObj, keys) {
        const result = {};
        if (!eventsObj) return result;
        for (const key of keys) {
            const arr = eventsObj[key];
            result[key] = Array.isArray(arr) ? arr.length : 0;
        }
        return result;
    }

    /** For OL map.listeners_ - counts may be arrays or numbers depending on OL version */
    function countMapListeners(listenersObj, keys) {
        const result = {};
        if (!listenersObj) {
            for (const k of keys) result[k] = null; // null = unavailable
            return result;
        }
        for (const key of keys) {
            const val = listenersObj[key];
            if (val === undefined) {
                result[key] = 0;
            } else if (Array.isArray(val)) {
                result[key] = val.length;
            } else {
                result[key] = null; // unexpected shape
            }
        }
        return result;
    }

    function snapshotPlugins() {
        const result = {};
        const plugins = app.plugins || {};
        for (const [id, plugin] of Object.entries(plugins)) {
            const events = plugin._events;
            if (!events || typeof events !== 'object') continue;
            const byEvent = {};
            let total = 0;
            for (const [eventType, listeners] of Object.entries(events)) {
                const count = Array.isArray(listeners) ? listeners.length : 0;
                if (count > 0) {
                    byEvent[eventType] = count;
                    total += count;
                }
            }
            if (total > 0) result[id] = { total, byEvent };
        }
        return result;
    }

    function takeSnapshot() {
        return {
            app: countListeners(app._events, APP_EVENTS),
            map: countMapListeners(app.map?.listeners_, MAP_EVENTS),
            plugins: snapshotPlugins(),
        };
    }

    // -------------------------------------------------------------------------
    // Session state
    // -------------------------------------------------------------------------
    const sessionStart = Date.now();
    const sessionId    = sessionStart;

    // events.app / events.map: { eventType: { initial, peak, peakAt } }
    // events.plugins:          { pluginId:  { initial, peak, peakAt, byEvent: { eventType: { initial, peak } } } }
    const session = {
        sessionId,
        sessionStart: new Date(sessionStart).toISOString(),
        events: { app: {}, map: {}, plugins: {} },
    };

    function elapsedSec() {
        return Math.round((Date.now() - sessionStart) / 1000);
    }

    function formatDuration(seconds) {
        if (seconds === 0) return '0s';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const parts = [];
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0 || parts.length === 0) parts.push(`${s}s`);
        return parts.join(' ');
    }

    /** Returns threshold counts that qualify as milestones above the initial value. */
    function getMilestoneThresholds(initial) {
        if (initial === 0) return [];
        return MILESTONE_PCTS
            .map(pct => ({ pct, threshold: Math.ceil(initial * (1 + pct / 100)) }))
            .filter(({ threshold }) => threshold - initial >= MILESTONE_MIN_ABS);
    }

    /** Records any newly crossed milestone thresholds for a peak entry. */
    function checkMilestones(entry, current, now) {
        const thresholdDefs = getMilestoneThresholds(entry.initial);
        const hitPcts = new Set(entry.milestones.map(m => m.pct));
        for (const { pct, threshold } of thresholdDefs) {
            if (!hitPcts.has(pct) && current >= threshold) {
                entry.milestones.push({ pct, count: current, at: now });
            }
        }
    }

    function updatePeak(store, key, current) {
        if (current === null) return; // unavailable (OL API mismatch)
        const now = new Date().toISOString();
        if (!store[key]) {
            store[key] = { initial: current, peak: current, peakAt: now, milestones: [] };
            return;
        }
        const entry = store[key];
        checkMilestones(entry, current, now);
        if (current > entry.peak) {
            entry.peak = current;
            entry.peakAt = now;
        }
    }

    function recordSnapshot(snap) {
        // App
        for (const [k, v] of Object.entries(snap.app)) updatePeak(session.events.app, k, v);

        // Map
        for (const [k, v] of Object.entries(snap.map)) updatePeak(session.events.map, k, v);

        // Plugins
        for (const [pluginId, data] of Object.entries(snap.plugins)) {
            const ps = session.events.plugins;
            const now = new Date().toISOString();
            if (!ps[pluginId]) {
                ps[pluginId] = {
                    initial: data.total,
                    peak: data.total,
                    peakAt: now,
                    milestones: [],
                    byEvent: {},
                };
            } else {
                const pe = ps[pluginId];
                checkMilestones(pe, data.total, now);
                if (data.total > pe.peak) {
                    pe.peak = data.total;
                    pe.peakAt = now;
                }
            }
            // Per-event breakdown
            for (const [evType, count] of Object.entries(data.byEvent)) {
                const bySrc = ps[pluginId].byEvent;
                const now2 = new Date().toISOString();
                if (!bySrc[evType]) {
                    bySrc[evType] = { initial: count, peak: count, peakAt: now2, milestones: [] };
                } else {
                    const be = bySrc[evType];
                    checkMilestones(be, count, now2);
                    if (count > be.peak) {
                        be.peak = count;
                        be.peakAt = now2;
                    }
                }
            }
        }
    }

    // Seed with initial snapshot
    recordSnapshot(takeSnapshot());

    // -------------------------------------------------------------------------
    // localStorage helpers
    // -------------------------------------------------------------------------
    function loadStoredSessions() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) {
            return [];
        }
    }

    function saveSession(sessionData) {
        try {
            const sessions = loadStoredSessions();
            sessions.push(sessionData);
            // Evict oldest if over limit
            while (sessions.length > MAX_SESSIONS) sessions.shift();
            localStorage.setItem(LS_KEY, JSON.stringify(sessions));
        } catch (e) {
            console.warn('[myw-monitor] Could not save to localStorage:', e.message);
        }
    }

    function clearStoredSessions() {
        try { localStorage.removeItem(LS_KEY); } catch (_) {}
    }

    // -------------------------------------------------------------------------
    // All-time peak (across stored sessions)
    // -------------------------------------------------------------------------
    function calcAllTimePeaks(storedSessions) {
        const peaks = { app: {}, map: {}, plugins: {} };
        for (const s of storedSessions) {
            for (const [k, v] of Object.entries(s.events?.app || {})) {
                if (!peaks.app[k] || v.peak > peaks.app[k].peak) peaks.app[k] = { peak: v.peak, peakAt: v.peakAt };
            }
            for (const [k, v] of Object.entries(s.events?.map || {})) {
                if (v !== null && (!peaks.map[k] || v.peak > peaks.map[k].peak)) peaks.map[k] = { peak: v.peak, peakAt: v.peakAt };
            }
            for (const [id, data] of Object.entries(s.events?.plugins || {})) {
                if (!peaks.plugins[id] || data.peak > peaks.plugins[id].peak) peaks.plugins[id] = { peak: data.peak, peakAt: data.peakAt };
            }
        }
        return peaks;
    }

    let storedSessions  = loadStoredSessions();
    let allTimePeaks    = calcAllTimePeaks(storedSessions);

    // -------------------------------------------------------------------------
    // UI rendering
    // -------------------------------------------------------------------------
    const STYLES = `
        #myw-monitor-root {
            font-family: sans-serif;
            font-size: 12px;
            padding: 6px;
            height: 100%;
            overflow-y: auto;
            box-sizing: border-box;
            color: #333;
        }
        #myw-monitor-root .mym-toolbar {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            margin-bottom: 8px;
        }
        #myw-monitor-root .mym-toolbar button {
            padding: 3px 8px;
            font-size: 11px;
            cursor: pointer;
            border: 1px solid #bbb;
            border-radius: 3px;
            background: #f5f5f5;
        }
        #myw-monitor-root .mym-toolbar button:hover { background: #e0e0e0; }
        #myw-monitor-root .mym-toolbar .mym-auto-on  { background: #d4edda; border-color: #4cae4c; }
        #myw-monitor-root .mym-toolbar .mym-auto-off { background: #f8d7da; border-color: #b94a48; }
        #myw-monitor-root .mym-status {
            font-size: 11px;
            color: #666;
            margin-bottom: 6px;
        }
        #myw-monitor-root h4 {
            margin: 8px 0 3px;
            font-size: 12px;
            font-weight: bold;
            border-bottom: 1px solid #ccc;
            padding-bottom: 2px;
        }
        #myw-monitor-root table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 4px;
        }
        #myw-monitor-root th {
            text-align: left;
            font-weight: bold;
            background: #eee;
            padding: 2px 5px;
            border: 1px solid #ccc;
            white-space: nowrap;
        }
        #myw-monitor-root td {
            padding: 2px 5px;
            border: 1px solid #ddd;
            vertical-align: top;
        }
        #myw-monitor-root .mym-num { text-align: right; }
        #myw-monitor-root .mym-grow-pos { color: #c00; font-weight: bold; }
        #myw-monitor-root .mym-grow-neg { color: #080; }
        #myw-monitor-root .mym-plugin-sub td:first-child { padding-left: 18px; color: #555; }
        #myw-monitor-root .mym-unavail { color: #aaa; font-style: italic; }
        #myw-monitor-root .mym-session-count { font-size: 11px; color: #666; margin-bottom: 4px; }
    `;

    function formatCurrentWithDelta(initial, current) {
        if (current === null) return '<span class="mym-unavail">N/A</span>';
        if (initial === undefined || initial === null) return String(current);
        const delta = current - initial;
        if (delta > 0) return `${current} <span class="mym-grow-pos">(+${delta})</span>`;
        if (delta < 0) return `${current} <span class="mym-grow-neg">(${delta})</span>`;
        return String(current);
    }

    /** Format a peakAt value for UI display. Handles ISO strings (current) and legacy elapsed-seconds numbers. */
    function formatPeakTime(peakAt) {
        if (peakAt === undefined || peakAt === null) return '';
        if (typeof peakAt === 'number') return `+${formatDuration(peakAt)}`;
        try { return new Date(peakAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch (_) { return ''; }
    }

    function formatPeak(peakEntry) {
        if (!peakEntry) return '-';
        const time = formatPeakTime(peakEntry.peakAt);
        const ms = peakEntry.milestones?.length ?? 0;
        const msLabel = ms > 0 ? ` <span style="color:#aaa;font-size:10px">${ms} milestone${ms > 1 ? 's' : ''}</span>` : '';
        return `${peakEntry.peak} <span style="color:#888">(at ${time})</span>${msLabel}`;
    }

    function formatAllTime(allTimeEntry) {
        if (!allTimeEntry) return '-';
        const time = formatPeakTime(allTimeEntry.peakAt);
        return `${allTimeEntry.peak} <span style="color:#888">(at ${time})</span>`;
    }

    function renderTable(headers, rows) {
        const thCells = headers.map(h => `<th>${h}</th>`).join('');
        const rowHtml = rows.join('');
        return `<table><thead><tr>${thCells}</tr></thead><tbody>${rowHtml}</tbody></table>`;
    }

    function buildUI(snap) {
        const headers = ['Source', 'Event', 'Initial', 'Current', 'This Session', `All Sessions (${storedSessions.length})`];

        // App rows
        const appRows = APP_EVENTS.map(ev => {
            const current = snap.app[ev] ?? 0;
            const entry   = session.events.app[ev];
            const atPeak  = allTimePeaks.app[ev];
            return `<tr>
                <td>App</td>
                <td>${ev}</td>
                <td class="mym-num">${entry ? entry.initial : current}</td>
                <td class="mym-num">${entry ? formatCurrentWithDelta(entry.initial, current) : String(current)}</td>
                <td class="mym-num">${entry ? formatPeak(entry) : '-'}</td>
                <td class="mym-num">${formatAllTime(atPeak)}</td>
            </tr>`;
        });

        // Map rows
        const mapRows = MAP_EVENTS.map(ev => {
            const current = snap.map[ev];
            const entry   = session.events.map[ev];
            const atPeak  = allTimePeaks.map[ev];
            return `<tr>
                <td>Map</td>
                <td>${ev}</td>
                <td class="mym-num">${entry ? entry.initial : (current === null ? '<span class="mym-unavail">N/A</span>' : String(current))}</td>
                <td class="mym-num">${entry ? formatCurrentWithDelta(entry.initial, current) : (current === null ? '<span class="mym-unavail">N/A</span>' : String(current))}</td>
                <td class="mym-num">${entry ? formatPeak(entry) : '-'}</td>
                <td class="mym-num">${formatAllTime(atPeak)}</td>
            </tr>`;
        });

        // Plugin rows - sorted by current total desc
        const pluginSnap   = snap.plugins;
        const sortedPlugins = Object.entries(pluginSnap).sort((a, b) => b[1].total - a[1].total);
        const pluginRows   = [];
        for (const [id, data] of sortedPlugins) {
            const entry  = session.events.plugins[id];
            const atPeak = allTimePeaks.plugins[id];
            pluginRows.push(`<tr>
                <td>Plugin</td>
                <td><strong>${id}</strong></td>
                <td class="mym-num">${entry ? entry.initial : data.total}</td>
                <td class="mym-num">${entry ? formatCurrentWithDelta(entry.initial, data.total) : String(data.total)}</td>
                <td class="mym-num">${entry ? formatPeak(entry) : '-'}</td>
                <td class="mym-num">${formatAllTime(atPeak)}</td>
            </tr>`);
            // Sub-rows per event type, sorted descending
            const sortedEvents = Object.entries(data.byEvent).sort((a, b) => b[1] - a[1]);
            for (const [evType, count] of sortedEvents) {
                const byEv = entry?.byEvent?.[evType];
                pluginRows.push(`<tr class="mym-plugin-sub">
                    <td></td>
                    <td>${evType}</td>
                    <td class="mym-num">${byEv ? byEv.initial : count}</td>
                    <td class="mym-num">${formatCurrentWithDelta(byEv?.initial, count)}</td>
                    <td></td>
                    <td></td>
                </tr>`);
            }
        }

        const now = new Date().toLocaleTimeString();
        const elapsedStr = formatDuration(elapsedSec());

        return `
            <div id="myw-monitor-root">
                <style>${STYLES}</style>
                <div class="mym-toolbar">
                    <button id="mym-btn-refresh">Refresh Now</button>
                    <button id="mym-btn-auto" class="mym-auto-on">Auto: ON</button>
                    <button id="mym-btn-save">Save Report</button>
                    <button id="mym-btn-clear">Clear All History</button>
                </div>
                <div class="mym-status">Last updated: ${now} &nbsp;|&nbsp; Session elapsed: ${elapsedStr}</div>
                <div class="mym-session-count">Stored sessions in history: ${storedSessions.length} (max ${MAX_SESSIONS})</div>
                <h4>App Events</h4>
                ${renderTable(headers, appRows)}
                <h4>Map Events</h4>
                ${renderTable(headers, mapRows)}
                <h4>Plugins</h4>
                ${pluginRows.length ? renderTable(headers, pluginRows) : '<em style="color:#888">No plugin listeners detected yet.</em>'}
            </div>`;
    }

    // -------------------------------------------------------------------------
    // Monitor state
    // -------------------------------------------------------------------------
    let autoOn        = true;
    let displayTimer  = null;
    let lastSnap      = takeSnapshot();
    let $container    = null; // set after tab is created

    function refresh() {
        if (!$container) return;
        lastSnap = takeSnapshot();
        recordSnapshot(lastSnap);
        $container.html(buildUI(lastSnap));
        bindButtons();
    }

    function bindButtons() {
        $container.find('#mym-btn-refresh').on('click', function () {
            refresh();
        });

        $container.find('#mym-btn-auto').on('click', function () {
            autoOn = !autoOn;
            $(this).text(autoOn ? 'Auto: ON' : 'Auto: OFF')
                   .removeClass('mym-auto-on mym-auto-off')
                   .addClass(autoOn ? 'mym-auto-on' : 'mym-auto-off');
            if (autoOn) startTimer();
            else stopTimer();
        });

        $container.find('#mym-btn-save').on('click', function () {
            saveReport();
        });

        $container.find('#mym-btn-clear').on('click', function () {
            if (!confirm('Clear all stored monitor history from this browser? This cannot be undone.')) return;
            clearStoredSessions();
            storedSessions = [];
            allTimePeaks   = { app: {}, map: {}, plugins: {} };
            refresh();
        });
    }

    function startTimer() {
        if (displayTimer) return;
        displayTimer = setInterval(refresh, DISPLAY_TICK_MS);
    }

    function stopTimer() {
        if (displayTimer) {
            clearInterval(displayTimer);
            displayTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Save report
    // -------------------------------------------------------------------------
    function saveReport() {
        const finalSnap = takeSnapshot();
        recordSnapshot(finalSnap);

        const allSessions = loadStoredSessions();

        const report = {
            exportedAt:    new Date().toISOString(),
            url:           window.location.href,
            appVersion:    app.version ?? app.options?.version ?? 'unknown',
            sessionCount:  allSessions.length + 1, // +1 for current (not yet persisted)
            sessions:      [
                ...allSessions,
                {
                    ...session,
                    sessionEnd: new Date().toISOString(),
                },
            ],
        };

        const json = JSON.stringify(report, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        const dlNow   = new Date();
        const dlDate  = dlNow.toISOString().slice(0, 10);
        const dlTime  = dlNow.toTimeString().slice(0, 8).replace(/:/g, '');
        a.href        = url;
        a.download    = `myw-monitor-${dlDate}-${dlTime}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // -------------------------------------------------------------------------
    // beforeunload: persist session passively
    // -------------------------------------------------------------------------
    function onBeforeUnload() {
        const finalSnap = takeSnapshot();
        recordSnapshot(finalSnap);
        saveSession({
            ...session,
            sessionEnd: new Date().toISOString(),
        });
    }
    window.addEventListener('beforeunload', onBeforeUnload);

    // -------------------------------------------------------------------------
    // Tab object (interface required by TabControl)
    // -------------------------------------------------------------------------
    const tabObject = {
        visibilityChanged(visible) {
            if (visible) {
                refresh();
                if (autoOn) startTimer();
            } else {
                stopTimer();
            }
        },
        invalidateSize() {}, // no-op
        remove() {
            stopTimer();
            window.removeEventListener('beforeunload', onBeforeUnload);
            delete window._mywMonitor;
        },
    };

    // -------------------------------------------------------------------------
    // Inject tab
    // -------------------------------------------------------------------------
    tabControl.addTab({
        id:     TAB_ID,
        title:  TAB_TITLE,
        object: tabObject,
    });

    // Retrieve the container div TabControl created for us and render into it
    $container = tabControl.tabs[TAB_ID]?.div;
    if (!$container) {
        console.error('[myw-monitor] Could not find tab container div after addTab.');
        return;
    }

    // Initial render
    refresh();
    startTimer();

    // -------------------------------------------------------------------------
    // Public handle
    // -------------------------------------------------------------------------
    window._mywMonitor = {
        refresh,
        saveReport,
        destroy() {
            stopTimer();
            window.removeEventListener('beforeunload', onBeforeUnload);
            $container?.empty();
            delete window._mywMonitor;
            console.info('[myw-monitor] Destroyed. Reload the page to remove the tab.');
        },
    };

    console.info('[myw-monitor] Monitor tab installed. Access via window._mywMonitor.');
})();
