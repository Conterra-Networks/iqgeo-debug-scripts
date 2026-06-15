(function installPerfMetricsCollector() {
    'use strict';

    // Storage and payload config
    const STORAGE_KEY = 'myw_perf_metrics_sessions';
    const STORAGE_VERSION_KEY = 'myw_perf_metrics_payload_version';
    const AUTO_OPEN_PERFORMANCE_KEY = 'myw_perf_metrics_auto_open';
    const PAYLOAD_VERSION = 6;
    const MAX_SESSIONS = 20;

    // UI and timers
    const TAB_ID = 'myw-performance';
    const TAB_TITLE = 'Performance';
    const SAMPLE_MS = 5000;
    const UI_REFRESH_MS = 5000;
    const DOCUMENT_HIDDEN_GRACE_MS = 2000;

    // Retention and ranking limits
    const MAX_SESSION_SAMPLES = 360; // 30 mins at 5s intervals
    const MAX_REQUEST_DURATION_SAMPLES = 512;
    const MAX_ENDPOINT_DURATION_SAMPLES = 64;
    const MAX_TRACKED_ENDPOINTS = 200;
    const TOP_ENDPOINT_LIMIT = 12;
    const TOP_LAYER_LIMIT = 12;

    // Network and hashing thresholds
    const SLOW_REQUEST_MS = 1000;
    const DUP_LOOKBACK_LIMIT = 5;
    const HASH_TEXT_LIMIT = 2048;

    // Event/status keys
    const LISTENER_KEYS = [
        'change',
        'currentFeature-changed',
        'currentFeatureSet-changed',
        'currentFeature-deleted',
        'nativeAppMode-changed',
        'database-view-changed',
        'featureCollection-modified',
    ];
    const MAP_LISTENER_KEYS = ['rendercomplete', 'movestart', 'moveend', 'prerender', 'postrender'];

    const STATUS_CLASS_KEYS = ['2xx', '3xx', '4xx', '5xx', 'error', 'other'];

    const STYLES = `
        #myw-performance-root {
            font-family: sans-serif;
            font-size: 12px;
            padding: 8px;
            height: 100%;
            overflow-y: auto;
            overflow-x: hidden;
            box-sizing: border-box;
            color: #2f2f2f;
            background: #fafafa;
        }
        #myw-performance-root .myw-perf-toolbar {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-bottom: 8px;
        }
        #myw-performance-root .myw-perf-toolbar button {
            border: 1px solid #b8c2cc;
            border-radius: 4px;
            background: #f2f5f8;
            color: #2f2f2f;
            cursor: pointer;
            padding: 4px 9px;
            font-size: 11px;
        }
        #myw-performance-root .myw-perf-toolbar button:hover {
            background: #e8edf2;
        }
        #myw-performance-root .myw-perf-toolbar .myw-on {
            background: #d8efe0;
            border-color: #66a57a;
        }
        #myw-performance-root .myw-perf-toolbar .myw-off {
            background: #f7dfe2;
            border-color: #c66b76;
        }
        #myw-performance-root .myw-perf-status {
            color: #57606a;
            margin-bottom: 8px;
        }
        #myw-performance-root .myw-perf-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 8px;
            margin-bottom: 10px;
        }
        #myw-performance-root .myw-perf-card {
            border: 1px solid #d0d7de;
            border-radius: 6px;
            background: #fff;
            padding: 7px;
        }
        #myw-performance-root .myw-perf-card h4 {
            margin: 0 0 6px;
            font-size: 12px;
            border-bottom: 1px solid #e5e9ee;
            padding-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        #myw-performance-root .myw-help {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 1px solid #9aa4af;
            color: #57606a;
            font-size: 10px;
            line-height: 1;
            cursor: help;
            flex: 0 0 auto;
            background: #fff;
        }
        #myw-performance-root .myw-help:focus {
            outline: 2px solid #8cb4ff;
            outline-offset: 1px;
        }
        #myw-performance-root .myw-help-tip {
            position: absolute;
            left: calc(100% + 8px);
            right: auto;
            top: calc(100% + 6px);
            z-index: 20;
            min-width: 220px;
            max-width: min(340px, calc(100vw - 32px));
            padding: 6px 8px;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            background: #111827;
            color: #f9fafb;
            font-size: 11px;
            line-height: 1.35;
            box-shadow: 0 8px 20px rgba(17, 24, 39, 0.18);
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transform: translateY(-2px);
            transition: opacity 0.12s ease, transform 0.12s ease, visibility 0.12s ease;
        }
        #myw-performance-root .myw-help-tip.myw-help-tip-left {
            left: auto;
            right: calc(100% + 8px);
        }
        #myw-performance-root .myw-help:hover .myw-help-tip,
        #myw-performance-root .myw-help:focus .myw-help-tip,
        #myw-performance-root .myw-help:focus-within .myw-help-tip {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        #myw-performance-root .myw-help-tip::before {
            content: '';
            position: absolute;
            left: -5px;
            top: -5px;
            width: 8px;
            height: 8px;
            background: #111827;
            border-left: 1px solid #d0d7de;
            border-top: 1px solid #d0d7de;
            transform: rotate(45deg);
        }
        #myw-performance-root .myw-help-tip.myw-help-tip-left::before {
            left: auto;
            right: -5px;
        }
        #myw-performance-root .myw-section-gap {
            margin-top: 14px;
        }
        #myw-performance-root .myw-toolbar-spacer {
            flex: 1 1 auto;
        }
        #myw-performance-root .myw-toolbar-toggle {
            margin-left: auto;
        }
        #myw-performance-root .myw-toolbar-toggle.myw-on {
            background: #edf7ff;
            border-color: #5b9bd5;
        }
        #myw-performance-root .myw-perf-list {
            margin: 0;
            padding: 0;
            list-style: none;
            line-height: 1.45;
        }
        #myw-performance-root .myw-perf-list li {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            align-items: baseline;
        }
        #myw-performance-root .myw-perf-list li.myw-perf-breakdown .myw-perf-k {
            padding-left: 16px;
            color: #67727d;
            position: relative;
        }
        #myw-performance-root .myw-perf-list li.myw-perf-breakdown .myw-perf-k::before {
            content: '-';
            position: absolute;
            left: 4px;
            color: #9aa4af;
        }
        #myw-performance-root .myw-perf-k {
            color: #57606a;
            flex: 1 1 auto;
            min-width: 0;
        }
        #myw-performance-root .myw-perf-v {
            float: none;
            font-variant-numeric: tabular-nums;
            color: #24292f;
            white-space: nowrap;
            flex: 0 0 auto;
        }
        #myw-performance-root .myw-perf-flag-high { color: #b02a37; font-weight: 700; }
        #myw-performance-root .myw-perf-flag-ok { color: #1f7a3d; font-weight: 700; }
        #myw-performance-root table {
            width: 100%;
            table-layout: auto;
            border-collapse: collapse;
            background: #fff;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            overflow: hidden;
        }
        #myw-performance-root .myw-table-wrap {
            margin-top: 6px;
            overflow-x: auto;
            overflow-y: hidden;
        }
        #myw-performance-root table.myw-perf-endpoints col.myw-col-endpoint-path,
        #myw-performance-root table.myw-perf-layers col.myw-col-layer-name {
            width: auto;
        }
        #myw-performance-root table.myw-perf-endpoints col.myw-col-num,
        #myw-performance-root table.myw-perf-layers col.myw-col-num,
        #myw-performance-root table.myw-perf-layers col.myw-col-type {
            width: 94px;
        }
        #myw-performance-root table.myw-perf-endpoints th:first-child,
        #myw-performance-root table.myw-perf-endpoints td:first-child,
        #myw-performance-root table.myw-perf-layers th:first-child,
        #myw-performance-root table.myw-perf-layers td:first-child {
            word-break: break-word;
        }
        #myw-performance-root .myw-col-type-cell,
        #myw-performance-root .myw-num {
            white-space: nowrap;
        }
        #myw-performance-root th,
        #myw-performance-root td {
            border-bottom: 1px solid #e5e9ee;
            padding: 4px 6px;
            text-align: left;
            font-size: 11px;
        }
        #myw-performance-root th {
            background: #f5f8fa;
            color: #46515c;
            font-weight: 700;
        }
        #myw-performance-root th.myw-num,
        #myw-performance-root td.myw-num {
            text-align: center;
            font-variant-numeric: tabular-nums;
        }
        #myw-performance-root .myw-note {
            color: #57606a;
            margin-top: 6px;
            font-size: 11px;
        }
    `;

    if (window._mywPerfMetrics) {
        const tabControl = window.myw?.app?.layout?.controls?.tabControl;
        if (tabControl?.tabs?.[TAB_ID] && getAutoOpenPerformancePref()) tabControl.switchToTab(TAB_ID);
        console.info('[myw-perf] already active. Reusing existing instance.');
        return;
    }

    function waitFor(predicate, timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                const value = predicate();
                if (value) return resolve(value);
                if (Date.now() - start >= timeoutMs) return reject(new Error('waitFor: timeout'));
                setTimeout(tick, 500);
            };
            tick();
        });
    }

    function safeJsonParse(value, fallback) {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function loadSessions() {
        return safeJsonParse(localStorage.getItem(STORAGE_KEY), []);
    }

    function getAutoOpenPerformancePref() {
        return localStorage.getItem(AUTO_OPEN_PERFORMANCE_KEY) === 'true';
    }

    function setAutoOpenPerformancePref(enabled) {
        localStorage.setItem(AUTO_OPEN_PERFORMANCE_KEY, enabled ? 'true' : 'false');
    }

    function clearStoredSessions() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function clearIfPayloadVersionChanged() {
        const savedVersion = Number(localStorage.getItem(STORAGE_VERSION_KEY) || 0);
        if (savedVersion !== PAYLOAD_VERSION) {
            clearStoredSessions();
            localStorage.setItem(STORAGE_VERSION_KEY, String(PAYLOAD_VERSION));
        }
    }

    function stripSamplesForStorage(session) {
        const { samples, ...rest } = session;
        return { ...rest, sampleCount: (samples || []).length };
    }

    function saveSessions(sessions) {
        let toSave = sessions.slice(-MAX_SESSIONS);
        while (toSave.length > 0) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
                return;
            } catch (_) {
                toSave = toSave.slice(1);
            }
        }
        console.warn('[myw-perf] Could not persist session to localStorage (quota full). Use Export JSON to save your data.');
    }

    clearIfPayloadVersionChanged();

    function countListeners(eventsObj, keys) {
        const counts = {};
        for (const key of keys) {
            counts[key] = Array.isArray(eventsObj?.[key]) ? eventsObj[key].length : 0;
        }
        return counts;
    }

    function countMapListeners(listenersObj, keys) {
        const counts = {};
        for (const key of keys) {
            const value = listenersObj?.[key];
            counts[key] = Array.isArray(value) ? value.length : 0;
        }
        return counts;
    }

    function toMB(bytes) {
        return Number.isFinite(bytes) ? Number((bytes / 1048576).toFixed(1)) : null;
    }

    function getBrowserMemoryStats() {
        const memory = performance?.memory;
        if (!memory) {
            return {
                usedMB: null,
                totalMB: null,
                limitMB: null,
                source: 'unavailable',
            };
        }
        return {
            usedMB: toMB(memory.usedJSHeapSize),
            totalMB: toMB(memory.totalJSHeapSize),
            limitMB: toMB(memory.jsHeapSizeLimit),
            source: 'performance.memory',
        };
    }

    function getCanvasCount() {
        return document.querySelectorAll('canvas').length;
    }

    function getDomNodeCount() {
        return document.querySelectorAll('*').length;
    }

    function getBasemapCacheTiles(map) {
        return map?._currentBaseMap?.maplibLayer?.getSource?.()?.tileCache?.getCount?.() ?? null;
    }

    function getMapLayerSummary(map) {
        const backgroundLayerCount = map?.getCurrentBaseMap?.() || map?._currentBaseMap ? 1 : 0;
        const userLayerIds = map?.getVisibleLayerIds?.() ?? [];
        const userLayerCount = Array.isArray(userLayerIds) ? userLayerIds.length : 0;
        return {
            totalLayerCount: backgroundLayerCount + userLayerCount,
            userLayerCount,
            backgroundLayerCount,
        };
    }

    function getVectorCacheSummary(map) {
        let sharedVectorFeatures = 0;
        let markerFeatures = 0;
        let featureRepUrns = 0;
        let featureRepInstances = 0;
        let layerCount = 0;

        for (const layer of map?.getLayers?.().getArray?.() ?? []) {
            if (layer._features instanceof Map) {
                sharedVectorFeatures += layer._features.size;
                layerCount += 1;
            }

            if (layer.markersSource?.getFeatures) {
                markerFeatures += layer.markersSource.getFeatures().length || 0;
            }

            if (layer.featureRepresentations) {
                const urnKeys = Object.keys(layer.featureRepresentations);
                featureRepUrns += urnKeys.length;
                featureRepInstances += urnKeys.reduce((sum, urn) => {
                    const reps = layer.featureRepresentations[urn];
                    return sum + (Array.isArray(reps) ? reps.length : 0);
                }, 0);
            }
        }

        const totalCachedFeatures = sharedVectorFeatures + markerFeatures;
        const representationCoveragePct = totalCachedFeatures > 0
            ? Number(((featureRepInstances / totalCachedFeatures) * 100).toFixed(1))
            : null;
        const cachePressureRatio = featureRepInstances > 0
            ? Number((totalCachedFeatures / featureRepInstances).toFixed(2))
            : null;

        return {
            // Keep existing field for export compatibility.
            featureCount: sharedVectorFeatures,
            sharedVectorFeatures,
            markerFeatures,
            totalCachedFeatures,
            featureRepUrns,
            featureRepInstances,
            representationCoveragePct,
            cachePressureRatio,
            layerCount,
            estimatedMemoryMB: Number(((totalCachedFeatures * 2) / 1024).toFixed(1)),
        };
    }

    function percentile(sorted, ratio) {
        if (!sorted.length) return null;
        const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
        return sorted[index];
    }

    function classifyStatus(status, hadNetworkError) {
        if (hadNetworkError) return 'error';
        if (status >= 200 && status < 300) return '2xx';
        if (status >= 300 && status < 400) return '3xx';
        if (status >= 400 && status < 500) return '4xx';
        if (status >= 500 && status < 600) return '5xx';
        return 'other';
    }

    function normalizeEndpoint(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return null;
        try {
            const url = new URL(rawUrl, location.href);
            const path = (url.pathname || '/').replace(/\/$/, '') || '/';
            return path;
        } catch (_) {
            return null;
        }
    }

    function truncateForHash(value) {
        if (typeof value !== 'string') return null;
        if (!value) return null;
        return value.length > HASH_TEXT_LIMIT ? value.slice(0, HASH_TEXT_LIMIT) : value;
    }

    async function hashText(value) {
        const text = truncateForHash(value);
        if (!text || !window.crypto?.subtle) return null;
        try {
            const data = new TextEncoder().encode(text);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
            const bytes = Array.from(new Uint8Array(hashBuffer));
            return bytes.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
        } catch (_) {
            return null;
        }
    }

    function normalizeBodyValue(value) {
        if (value == null) return null;
        if (typeof value === 'string') return value;
        if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return value.toString();
        if (typeof FormData !== 'undefined' && value instanceof FormData) {
            const entries = [];
            value.forEach((entryValue, entryKey) => {
                if (typeof entryValue === 'string') entries.push(`${entryKey}=${entryValue}`);
                else entries.push(`${entryKey}=[blob]`);
            });
            return entries.join('&');
        }
        if (value instanceof ArrayBuffer) return `[arraybuffer:${value.byteLength}]`;
        if (typeof Blob !== 'undefined' && value instanceof Blob) return `[blob:${value.size}]`;
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (_) {
                return String(value);
            }
        }
        return String(value);
    }

    async function getFetchRequestHash(input, init) {
        if (init?.body != null) return hashText(normalizeBodyValue(init.body));
        if (typeof Request !== 'undefined' && input instanceof Request) {
            try {
                const requestText = await input.clone().text();
                return hashText(requestText);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    async function getFetchResponseHash(response) {
        if (!response?.clone) return null;
        try {
            const responseText = await response.clone().text();
            return hashText(responseText);
        } catch (_) {
            return null;
        }
    }

    async function getXhrRequestHash(body) {
        return hashText(normalizeBodyValue(body));
    }

    async function getXhrResponseHash(xhr) {
        try {
            if (xhr.responseType && xhr.responseType !== 'text' && xhr.responseType !== '') return null;
            return hashText(typeof xhr.responseText === 'string' ? xhr.responseText : null);
        } catch (_) {
            return null;
        }
    }

    function toTopEndpoints(endpointCounts) {
        return Object.entries(endpointCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, TOP_ENDPOINT_LIMIT)
            .map(([endpoint, count]) => ({ endpoint, count }));
    }

    function toTopEndpointPerformance(endpointStats) {
        return Object.entries(endpointStats)
            .map(([endpoint, stats]) => {
                const sorted = [...stats.durationsMs].sort((a, b) => a - b);
                const avgMs = stats.count > 0 ? Number((stats.totalMs / stats.count).toFixed(1)) : null;
                const p95Ms = percentile(sorted, 0.95);
                const failedRate = stats.count > 0 ? Number(((stats.failed / stats.count) * 100).toFixed(1)) : 0;
                return {
                    endpoint,
                    count: stats.count,
                    avgMs,
                    p95Ms,
                    failed: stats.failed,
                    failedRate,
                    slow: stats.slow,
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, TOP_ENDPOINT_LIMIT);
    }

    function toTopLayerRenders(layerRenderStats) {
        return Object.entries(layerRenderStats)
            .map(([layerKey, stats]) => ({
                layerKey,
                label: stats.label,
                displayLabel: stats.displayLabel || stats.label,
                type: stats.type,
                count: stats.count,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, TOP_LAYER_LIMIT);
    }

    function pushCapped(list, value, limit) {
        list.push(value);
        if (list.length > limit) {
            list.splice(0, list.length - limit);
        }
    }

    function formatDurationMs(ms) {
        return `${Math.round(ms)}ms`;
    }

    function elapsedSeconds(startMs) {
        return Math.max(0, Math.round((Date.now() - startMs) / 1000));
    }

    function formatElapsed(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function computeFlagClass(isHighRisk) {
        return isHighRisk ? 'myw-perf-flag-high' : 'myw-perf-flag-ok';
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sectionHeader(title, description) {
        return `<h4>${escapeHtml(title)}<span class="myw-help" tabindex="0" aria-label="${escapeHtml(description)}">?<span class="myw-help-tip">${escapeHtml(description)}</span></span></h4>`;
    }

    function metricRow(label, value, options = {}) {
        const classes = options.breakdown ? ' class="myw-perf-breakdown"' : '';
        return `<li${classes}><span class="myw-perf-k">${label}</span><span class="myw-perf-v${options.valueClass ? ` ${options.valueClass}` : ''}">${value}</span></li>`;
    }

    function getDomContainer(tabDiv) {
        if (!tabDiv) return null;
        if (tabDiv.nodeType === 1) return tabDiv;
        if (tabDiv[0] && tabDiv[0].nodeType === 1) return tabDiv[0];
        return null;
    }

    function sanitizeIdentity(value) {
        if (typeof value !== 'string') return null;
        const cleaned = value.trim();
        if (!cleaned) return null;
        const lowered = cleaned.toLowerCase();
        if (lowered === 'none' || lowered === 'unknown' || lowered === 'anonymous') return null;
        return cleaned;
    }

    function toFilenameToken(value) {
        const normalized = (value || 'unknown-user').toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
        const compact = normalized.replace(/^_+|_+$/g, '').slice(0, 48);
        return compact || 'unknown-user';
    }

    function resolveUserIdentity(app) {
        const candidates = [
            { value: window.myw?.currentUser?.username, source: 'myw.currentUser.username' },
            { value: document.body?.dataset?.mywUser, source: 'body[data-myw-user]' },
            { value: app?.options?.user, source: 'app.options.user' },
        ];

        for (const candidate of candidates) {
            const resolved = sanitizeIdentity(candidate.value);
            if (resolved) {
                const atIdx = resolved.indexOf('@');
                const localPart = atIdx > 0 ? resolved.slice(0, atIdx) : resolved;
                const fileToken = toFilenameToken(localPart);
                return {
                    username: resolved,
                    localPart,
                    fileToken,
                    source: candidate.source,
                };
            }
        }

        return {
            username: null,
            localPart: null,
            fileToken: 'unknown-user',
            source: 'fallback',
        };
    }

    function sampleSessionState(app, map, counters, networkState, longTaskState, layerRenderState) {
        const durationsSorted = [...networkState.requestDurationsMs].sort((a, b) => a - b);
        const totalRequests = counters.requestTotal;
        const avgRequestMs = totalRequests > 0
            ? Number((networkState.requestDurationsTotalMs / totalRequests).toFixed(1))
            : null;

        const browserMemory = getBrowserMemoryStats();

        return {
            at: new Date().toISOString(),
            counters: { ...counters },
            browserMemory,
            canvasCount: getCanvasCount(),
            domNodeCount: getDomNodeCount(),
            basemapCacheTiles: getBasemapCacheTiles(map),
            layerSummary: getMapLayerSummary(map),
            vectorCache: getVectorCacheSummary(map),
            appListeners: countListeners(app._events, LISTENER_KEYS),
            mapListeners: countMapListeners(map.listeners_, MAP_LISTENER_KEYS),
            network: {
                inFlight: networkState.inFlight,
                maxInFlight: networkState.maxInFlight,
                uniqueEndpointCount: Object.keys(networkState.endpointCounts).length,
                topEndpoints: toTopEndpoints(networkState.endpointCounts),
                topEndpointPerformance: toTopEndpointPerformance(networkState.endpointStats),
                avgRequestMs,
                p95RequestMs: percentile(durationsSorted, 0.95),
                requestsByStatusClass: { ...networkState.requestsByStatusClass },
                nearConsecutiveRepeats: {
                    lookback: DUP_LOOKBACK_LIMIT,
                    checked: networkState.nearConsecutiveRepeats.checked,
                    endpointMethod: networkState.nearConsecutiveRepeats.endpointMethod,
                    exactPayloadAndResponse: networkState.nearConsecutiveRepeats.exactPayloadAndResponse,
                    endpointMethodPct: networkState.nearConsecutiveRepeats.checked > 0
                        ? Number(((networkState.nearConsecutiveRepeats.endpointMethod / networkState.nearConsecutiveRepeats.checked) * 100).toFixed(1))
                        : 0,
                    exactPayloadAndResponsePct: networkState.nearConsecutiveRepeats.checked > 0
                        ? Number(((networkState.nearConsecutiveRepeats.exactPayloadAndResponse / networkState.nearConsecutiveRepeats.checked) * 100).toFixed(1))
                        : 0,
                },
            },
            longTasks: {
                count: longTaskState.count,
                totalMs: longTaskState.totalMs,
                maxMs: longTaskState.maxMs,
            },
            layerRenders: toTopLayerRenders(layerRenderState.stats),
        };
    }

    function buildPerformanceUI(snapshot, sessionStartMs, storedSessionCount, session) {
        const counters = snapshot.counters;
        const network = snapshot.network;
        const longTasks = snapshot.longTasks;
        const layerSummary = snapshot.layerSummary;
        const vectorCache = snapshot.vectorCache;
        const nearConsecutive = network.nearConsecutiveRepeats;
        const layerRenders = snapshot.layerRenders || [];
        const statusPerMove = counters.moveend > 0 ? counters.statusBusy / counters.moveend : null;
        const renderPerMove = counters.moveend > 0 ? counters.rendercomplete / counters.moveend : null;
        const failedRate = counters.requestTotal > 0
            ? Number(((counters.requestFailed / counters.requestTotal) * 100).toFixed(1))
            : 0;

        const firstSample = Array.isArray(session?.samples) && session.samples.length ? session.samples[0] : null;
        const elapsedMin = Math.max(0, (Date.now() - sessionStartMs) / 60000);
        const vectorGrowthRatePerMin = firstSample && elapsedMin >= 1
            ? Number(((vectorCache.totalCachedFeatures - firstSample.vectorCache.totalCachedFeatures) / elapsedMin).toFixed(1))
            : null;

        const statusRisk = statusPerMove !== null && statusPerMove > 3;
        const renderRisk = renderPerMove !== null && renderPerMove > 2.5;
        const slowRisk = counters.requestSlow > 0;

        const sectionHelp = {
            mapActivity: 'Move start fires when map movement begins; move end fires when it settles. They are often equal, but can differ while movement is still in progress or if an interaction is interrupted. Render counts are layer postrender events: user layers, background basemap, and total.',
            statusChurn: 'Tracks app loading-status calls (statusBusy, showStatus, hideStatus) triggered during work such as render/data updates. They are often equal in steady flows; differences can indicate overlapping operations, delayed clears, or paths that show status but do not clear it yet. Keep this section when diagnosing spinner churn.',
            memoryCaches: 'JS heap is browser memory from performance.memory (usedJSHeapSize / totalJSHeapSize). Vector features are cached map features. Shared vectors are features kept in shared vector-layer caches. Marker features are marker/pin-style features from markersSource (for example location pins and marker overlays). Feature reps are rendered representation objects for cached vector features, not the raw features themselves.',
            network: 'Request volume, failures, latency, and near-repeat checks. p95 is the latency value that 95% of requests are at or below. Recent repeats counts same method+endpoint seen in the last 5 requests; recent exact repeats requires endpoint plus matching request and response hashes.',
            longTasks: 'Main-thread work over 50 ms observed through PerformanceObserver longtask entries.',
            listeners: 'Active event listeners on the app and map at sample time.',
            topEndpoints: 'Requests grouped by endpoint path. Avg and p95 are computed from the request durations seen in this session.',
            topLayers: 'Rendered layers grouped by resolved layer name or basemap name. Share is each layer count divided by total rendercomplete events.',
        };

        const endpointRows = network.topEndpointPerformance.length
            ? network.topEndpointPerformance.map(item => `
                <tr>
                    <td>${item.endpoint}</td>
                    <td class="myw-num">${item.count}</td>
                    <td class="myw-num">${item.avgMs === null ? '-' : item.avgMs}</td>
                    <td class="myw-num">${item.p95Ms === null ? '-' : item.p95Ms}</td>
                    <td class="myw-num">${item.failed} (${item.failedRate}%)</td>
                </tr>`).join('')
            : '<tr><td colspan="5">No requests captured yet.</td></tr>';

        const layerRows = layerRenders.length
            ? layerRenders.map(item => {
                const sharePct = counters.rendercomplete > 0
                    ? Number(((item.count / counters.rendercomplete) * 100).toFixed(1))
                    : 0;
                const layerLabel = item.displayLabel && item.label && item.displayLabel !== item.label
                    ? `${item.displayLabel} (${item.label})`
                    : (item.displayLabel || item.label);
                return `
                <tr>
                    <td>${layerLabel}</td>
                    <td class="myw-col-type-cell">${item.type}</td>
                    <td class="myw-num">${item.count}</td>
                    <td class="myw-num">${sharePct}%</td>
                </tr>`;
            }).join('')
            : '<tr><td colspan="4">No layer postrender events captured yet.</td></tr>';

        return `
            <div id="myw-performance-root">
                <style>${STYLES}</style>
                <div class="myw-perf-toolbar">
                    <button id="myw-btn-refresh">Refresh</button>
                    <button id="myw-btn-export">Export JSON</button>
                    <button id="myw-btn-clear">Clear Stored</button>
                    <span class="myw-toolbar-spacer"></span>
                    <button id="myw-btn-default-tab" class="myw-toolbar-toggle" title="Toggle whether the Performance tab opens automatically when the app loads."></button>
                </div>
                <div class="myw-perf-status">
                    Last updated: ${new Date(snapshot.at).toLocaleTimeString()} | Session elapsed: ${formatElapsed(elapsedSeconds(sessionStartMs))} | Stored sessions: ${storedSessionCount}
                </div>
                <div class="myw-perf-grid">
                    <div class="myw-perf-card">
                        ${sectionHeader('Map Activity', sectionHelp.mapActivity)}
                        <ul class="myw-perf-list">
                            ${metricRow('Move start', counters.movestart)}
                            ${metricRow('Move end', counters.moveend)}
                            ${metricRow('Layer renders', counters.rendercomplete)}
                            ${metricRow('User', counters.rendercompleteUser, { breakdown: true })}
                            ${metricRow('Background', counters.rendercompleteBackground, { breakdown: true })}
                            ${metricRow('Render per move', renderPerMove === null ? '-' : renderPerMove.toFixed(2), { valueClass: computeFlagClass(renderRisk) })}
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        ${sectionHeader('Status Churn', sectionHelp.statusChurn)}
                        <ul class="myw-perf-list">
                            ${metricRow('statusBusy', counters.statusBusy)}
                            ${metricRow('showStatus', counters.showStatus)}
                            ${metricRow('hideStatus', counters.hideStatus)}
                            ${metricRow('statusBusy per move', statusPerMove === null ? '-' : statusPerMove.toFixed(2), { valueClass: computeFlagClass(statusRisk) })}
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        ${sectionHeader('Memory and Caches', sectionHelp.memoryCaches)}
                        <ul class="myw-perf-list">
                            ${metricRow('JS heap used / total', snapshot.browserMemory.usedMB === null ? 'n/a' : `${snapshot.browserMemory.usedMB} / ${snapshot.browserMemory.totalMB === null ? '-' : snapshot.browserMemory.totalMB} MB`)}
                            ${metricRow('Canvas count', snapshot.canvasCount)}
                            ${metricRow('DOM nodes', snapshot.domNodeCount)}
                            ${metricRow('Basemap cache tiles', snapshot.basemapCacheTiles === null ? 'n/a' : snapshot.basemapCacheTiles)}
                            ${metricRow('Layers', layerSummary.totalLayerCount)}
                            ${metricRow('User', layerSummary.userLayerCount, { breakdown: true })}
                            ${metricRow('Background', layerSummary.backgroundLayerCount, { breakdown: true })}
                            ${metricRow('Vector features', vectorCache.totalCachedFeatures)}
                            ${metricRow('Shared', vectorCache.sharedVectorFeatures, { breakdown: true })}
                            ${metricRow('Markers', vectorCache.markerFeatures, { breakdown: true })}
                            ${metricRow('Feature reps', vectorCache.featureRepInstances)}
                            ${metricRow('Rep fit / pressure', `${vectorCache.representationCoveragePct === null ? '-' : `${vectorCache.representationCoveragePct}%`} / ${vectorCache.cachePressureRatio === null ? '-' : vectorCache.cachePressureRatio}`)}
                            ${metricRow('Vector growth rate', vectorGrowthRatePerMin === null ? '-' : `${vectorGrowthRatePerMin > 0 ? '+' : ''}${vectorGrowthRatePerMin} features/min`)}
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        ${sectionHeader('Network', sectionHelp.network)}
                        <ul class="myw-perf-list">
                            ${metricRow('Requests', counters.requestTotal)}
                            ${metricRow('Failed', `${counters.requestFailed} (${failedRate}%)`)}
                            ${metricRow(`Slow > ${SLOW_REQUEST_MS}ms`, counters.requestSlow, { valueClass: computeFlagClass(slowRisk) })}
                            ${metricRow('Unique endpoints', network.uniqueEndpointCount)}
                            ${metricRow('In-flight / max', `${network.inFlight} / ${network.maxInFlight}`)}
                            ${metricRow('Avg / p95 request', network.avgRequestMs === null ? '-' : `${network.avgRequestMs} / ${network.p95RequestMs === null ? '-' : network.p95RequestMs} ms`)}
                            ${metricRow(`Recent repeats (${nearConsecutive.lookback})`, `${nearConsecutive.endpointMethod} (${nearConsecutive.endpointMethodPct}%)`)}
                            ${metricRow('Recent exact repeats', `${nearConsecutive.exactPayloadAndResponse} (${nearConsecutive.exactPayloadAndResponsePct}%)`)}
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        ${sectionHeader('Long Tasks', sectionHelp.longTasks)}
                        <ul class="myw-perf-list">
                            ${metricRow('Count', longTasks.count)}
                            ${metricRow('Total blocked time', formatDurationMs(longTasks.totalMs))}
                            ${metricRow('Longest task', formatDurationMs(longTasks.maxMs))}
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        ${sectionHeader('Listener Snapshot', sectionHelp.listeners)}
                        <ul class="myw-perf-list">
                            ${metricRow('App listeners', Object.values(snapshot.appListeners).reduce((sum, value) => sum + value, 0))}
                            ${metricRow('Map listeners', Object.values(snapshot.mapListeners).reduce((sum, value) => sum + value, 0))}
                            ${metricRow('featureCollection-modified', snapshot.appListeners['featureCollection-modified'])}
                            ${metricRow('currentFeature-changed', snapshot.appListeners['currentFeature-changed'])}
                        </ul>
                    </div>
                </div>
                <div class="myw-section-gap">${sectionHeader('Top Endpoints This Session', sectionHelp.topEndpoints)}</div>
                <div class="myw-table-wrap">
                    <table class="myw-perf-endpoints">
                        <colgroup>
                            <col class="myw-col-endpoint-path" />
                            <col class="myw-col-num" />
                            <col class="myw-col-num" />
                            <col class="myw-col-num" />
                            <col class="myw-col-num" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th>Endpoint path</th>
                                <th class="myw-num">Requests</th>
                                <th class="myw-num">Avg ms</th>
                                <th class="myw-num">P95 ms</th>
                                <th class="myw-num">Failed</th>
                            </tr>
                        </thead>
                        <tbody>${endpointRows}</tbody>
                    </table>
                </div>
                <div class="myw-section-gap">${sectionHeader('Top Layers This Session', sectionHelp.topLayers)}</div>
                <div class="myw-table-wrap">
                    <table class="myw-perf-layers">
                        <colgroup>
                            <col class="myw-col-layer-name" />
                            <col class="myw-col-type" />
                            <col class="myw-col-num" />
                            <col class="myw-col-num" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th>Layer</th>
                                <th class="myw-col-type-cell">Type</th>
                                <th class="myw-num">Renders</th>
                                <th class="myw-num">Share</th>
                            </tr>
                        </thead>
                        <tbody>${layerRows}</tbody>
                    </table>
                </div>
            </div>`;
    }

    async function main() {
        const app = await waitFor(() => window.myw?.app);
        const map = await waitFor(() => app?.map);
        const layout = app.layout;
        const tabControl = await waitFor(() => app?.layout?.controls?.tabControl);
        const userIdentity = resolveUserIdentity(app);

        const counters = {
            rendercomplete: 0,
            rendercompleteUser: 0,
            rendercompleteBackground: 0,
            movestart: 0,
            moveend: 0,
            statusBusy: 0,
            showStatus: 0,
            hideStatus: 0,
            requestTotal: 0,
            requestFailed: 0,
            requestSlow: 0,
        };

        const networkState = {
            endpointCounts: {},
            endpointStats: {},
            requestDurationsMs: [],
            requestDurationsTotalMs: 0,
            inFlight: 0,
            maxInFlight: 0,
            requestsByStatusClass: {
                '2xx': 0,
                '3xx': 0,
                '4xx': 0,
                '5xx': 0,
                error: 0,
                other: 0,
            },
            nearConsecutiveRepeats: {
                checked: 0,
                endpointMethod: 0,
                exactPayloadAndResponse: 0,
            },
            recentRequests: [],
        };

        const longTaskState = {
            count: 0,
            totalMs: 0,
            maxMs: 0,
        };

        const layerRenderState = {
            stats: {},
            layerObjectIds: new WeakMap(),
            nextLayerObjectId: 1,
        };

        const renderLayerHooks = new Map();
        const renderHookState = {
            targets: [],
        };

        const session = {
            startedAt: new Date().toISOString(),
            samples: [],
            final: null,
        };

        const sessionStartMs = Date.now();

        let stopped = false;
        let tabContainer = null;
        let uiTimer = null;
        let sampleTimer = null;
        let hiddenPauseTimer = null;
        let samplingPausedForHiddenDocument = false;
        const scrollState = {
            tabTop: 0,
            tabLeft: 0,
            rootTop: 0,
            rootLeft: 0,
        };

        const original = {
            statusBusy: typeof app.statusBusy === 'function' ? app.statusBusy.bind(app) : null,
            showStatus: typeof layout?.showStatus === 'function' ? layout.showStatus.bind(layout) : null,
            hideStatus: typeof layout?.hideStatus === 'function' ? layout.hideStatus.bind(layout) : null,
            fetch: typeof window.fetch === 'function' ? window.fetch.bind(window) : null,
            xhrOpen: XMLHttpRequest.prototype.open,
            xhrSend: XMLHttpRequest.prototype.send,
        };

        const longTaskObserver = (() => {
            if (typeof PerformanceObserver !== 'function') return null;
            if (!Array.isArray(PerformanceObserver.supportedEntryTypes)) return null;
            if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return null;

            const observer = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                for (const entry of entries) {
                    const duration = Math.round(entry.duration || 0);
                    longTaskState.count += 1;
                    longTaskState.totalMs += duration;
                    longTaskState.maxMs = Math.max(longTaskState.maxMs, duration);
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
            return observer;
        })();

        function getLayerSource(layer) {
            return layer?.getSource?.() || null;
        }

        function getSourceLabel(source) {
            if (!source) return 'no-source';
            try {
                if (typeof source.getUrls === 'function') {
                    const urls = source.getUrls() || [];
                    if (urls.length) return `urls:${urls[0]}`;
                }
                if (typeof source.getUrl === 'function') {
                    const url = source.getUrl();
                    if (url) return `url:${url}`;
                }
                if (typeof source.getTileUrlFunction === 'function') return 'tileUrlFunction';
                if (typeof source.getFeatures === 'function') return 'unresolved-vector-source';
            } catch (_) {
                return source?.constructor?.name || 'unknown-source';
            }
            return source?.constructor?.name || 'unknown-source';
        }

        function getVisibleLayerMatch(layer) {
            const visibleLayers = map?.getVisibleLayers?.() ?? [];
            const source = getLayerSource(layer);
            return visibleLayers.find(item => {
                if (item?.maplibLayer === layer) return true;
                const itemSource = item?.maplibLayer?.getSource?.();
                return !!source && itemSource === source;
            }) || null;
        }

        function getBaseMapName(layer) {
            const source = getLayerSource(layer);
            for (const [name, baseMap] of Object.entries(map?.baseMaps ?? {})) {
                if (baseMap?.maplibLayer === layer) return name;
                const baseSource = baseMap?.maplibLayer?.getSource?.();
                if (source && baseSource === source) return name;
            }
            if (layer === map?.getCurrentBaseMap?.()?.maplibLayer || layer === map?._currentBaseMap?.maplibLayer) {
                return map?.getCurrentBaseMap?.()?.display_name || map?._currentBaseMap?.display_name || 'background';
            }
            return null;
        }

        function isBackgroundLayer(layer) {
            return !!getBaseMapName(layer);
        }

        function getBackgroundLayerName(layer) {
            return getBaseMapName(layer) || 'background';
        }

        function getUserLayerName(layer) {
            const matched = getVisibleLayerMatch(layer);
            if (matched?.layerDef?.name) return matched.layerDef.name;
            const sourceLabel = getSourceLabel(getLayerSource(layer));
            if (sourceLabel !== 'unresolved-vector-source') return sourceLabel;
            const sourceType = getLayerSource(layer)?.constructor?.name || 'unknown-source';
            return `unresolved-vector-source#${getLayerObjectId(layer)}:${sourceType}`;
        }

        function getUserLayerDisplayName(layer) {
            const matched = getVisibleLayerMatch(layer);
            if (matched?.layerDef?.display_name) return matched.layerDef.display_name;
            if (matched?.layerDef?.name) return matched.layerDef.name;
            return getUserLayerName(layer);
        }

        function getLayerObjectId(layer) {
            if (!layer || typeof layer !== 'object') return 0;
            if (!layerRenderState.layerObjectIds.has(layer)) {
                layerRenderState.layerObjectIds.set(layer, layerRenderState.nextLayerObjectId);
                layerRenderState.nextLayerObjectId += 1;
            }
            return layerRenderState.layerObjectIds.get(layer);
        }

        function trackLayerRender(layer) {
            const isBackground = isBackgroundLayer(layer);
            const type = isBackground ? 'background' : 'user';
            const label = isBackground ? getBackgroundLayerName(layer) : getUserLayerName(layer);
            const displayLabel = isBackground ? label : getUserLayerDisplayName(layer);
            const key = `${type}:${label}`;
            if (!layerRenderState.stats[key]) {
                layerRenderState.stats[key] = { label, displayLabel, type, count: 0 };
            }
            if (!layerRenderState.stats[key].displayLabel) {
                layerRenderState.stats[key].displayLabel = displayLabel;
            }
            layerRenderState.stats[key].count += 1;
        }

        function getRenderHookTargets() {
            const targets = [];
            const seen = new Set();

            const addTarget = (layer) => {
                if (!layer || typeof layer.on !== 'function') return;
                if (seen.has(layer)) return;
                seen.add(layer);
                targets.push(layer);
            };

            for (const layer of map?.getLayers?.().getArray?.() ?? []) addTarget(layer);
            for (const baseMap of Object.values(map?.baseMaps ?? {})) addTarget(baseMap?.maplibLayer);
            addTarget(map?.getCurrentBaseMap?.()?.maplibLayer);
            addTarget(map?._currentBaseMap?.maplibLayer);

            return targets;
        }

        function bindRenderLayerHooks() {
            const targets = getRenderHookTargets();
            if (targets.length === renderHookState.targets.length && targets.every((layer, index) => layer === renderHookState.targets[index])) {
                return;
            }

            renderHookState.targets = targets.slice();

            for (const layer of targets) {
                if (!layer || renderLayerHooks.has(layer) || typeof layer.on !== 'function') continue;
                const onPostRender = () => {
                    counters.rendercomplete += 1;
                    if (isBackgroundLayer(layer)) counters.rendercompleteBackground += 1;
                    else counters.rendercompleteUser += 1;
                    trackLayerRender(layer);
                };
                layer.on('postrender', onPostRender);
                renderLayerHooks.set(layer, onPostRender);
            }
        }

        function trackRequest(method, rawUrl, status, durationMs, hadNetworkError, requestHash = null, responseHash = null) {
            counters.requestTotal += 1;
            if (hadNetworkError || status >= 400) counters.requestFailed += 1;
            if (durationMs >= SLOW_REQUEST_MS) counters.requestSlow += 1;

            pushCapped(networkState.requestDurationsMs, Math.round(durationMs), MAX_REQUEST_DURATION_SAMPLES);
            networkState.requestDurationsTotalMs += durationMs;

            const endpoint = normalizeEndpoint(rawUrl);
            const methodPrefix = method ? method.toUpperCase() : 'GET';
            if (endpoint) {
                const key = `${methodPrefix} ${endpoint}`;
                const fullKey = `${key}|rq:${requestHash || '-'}|rs:${responseHash || '-'}|st:${status || 0}`;
                const recent = networkState.recentRequests;
                networkState.nearConsecutiveRepeats.checked += 1;
                if (recent.some(item => item.endpointKey === key)) {
                    networkState.nearConsecutiveRepeats.endpointMethod += 1;
                }
                if (recent.some(item => item.fullKey === fullKey)) {
                    networkState.nearConsecutiveRepeats.exactPayloadAndResponse += 1;
                }
                recent.push({ endpointKey: key, fullKey });
                if (recent.length > DUP_LOOKBACK_LIMIT) recent.shift();

                const existingEndpoint = Object.prototype.hasOwnProperty.call(networkState.endpointCounts, key);
                networkState.endpointCounts[key] = (networkState.endpointCounts[key] || 0) + 1;
                if (!networkState.endpointStats[key]) {
                    networkState.endpointStats[key] = {
                        count: 0,
                        totalMs: 0,
                        durationsMs: [],
                        failed: 0,
                        slow: 0,
                    };
                }
                const endpointEntry = networkState.endpointStats[key];
                endpointEntry.count += 1;
                endpointEntry.totalMs += durationMs;
                pushCapped(endpointEntry.durationsMs, Math.round(durationMs), MAX_ENDPOINT_DURATION_SAMPLES);
                if (hadNetworkError || status >= 400) endpointEntry.failed += 1;
                if (durationMs >= SLOW_REQUEST_MS) endpointEntry.slow += 1;

                if (!existingEndpoint && Object.keys(networkState.endpointCounts).length > MAX_TRACKED_ENDPOINTS) {
                    const evictionCandidate = Object.entries(networkState.endpointCounts)
                        .filter(([candidateKey]) => candidateKey !== key)
                        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
                    if (evictionCandidate) {
                        delete networkState.endpointCounts[evictionCandidate[0]];
                        delete networkState.endpointStats[evictionCandidate[0]];
                    }
                }
            }

            const statusClass = classifyStatus(status, hadNetworkError);
            if (!STATUS_CLASS_KEYS.includes(statusClass)) {
                networkState.requestsByStatusClass.other += 1;
            } else {
                networkState.requestsByStatusClass[statusClass] += 1;
            }
        }

        function onRequestStart() {
            networkState.inFlight += 1;
            networkState.maxInFlight = Math.max(networkState.maxInFlight, networkState.inFlight);
        }

        function onRequestEnd() {
            networkState.inFlight = Math.max(0, networkState.inFlight - 1);
        }

        if (original.statusBusy) {
            app.statusBusy = function patchedStatusBusy(...args) {
                counters.statusBusy += 1;
                return original.statusBusy(...args);
            };
        }
        if (original.showStatus) {
            layout.showStatus = function patchedShowStatus(...args) {
                counters.showStatus += 1;
                return original.showStatus(...args);
            };
        }
        if (original.hideStatus) {
            layout.hideStatus = function patchedHideStatus(...args) {
                counters.hideStatus += 1;
                return original.hideStatus(...args);
            };
        }

        if (original.fetch) {
            window.fetch = async function patchedFetch(input, init) {
                const start = performance.now();
                const method = init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET') || 'GET';
                const rawUrl = typeof input === 'string'
                    ? input
                    : (typeof Request !== 'undefined' && input instanceof Request ? input.url : null);
                const requestHashPromise = getFetchRequestHash(input, init);

                onRequestStart();
                try {
                    const response = await original.fetch(input, init);
                    const durationMs = performance.now() - start;
                    Promise.resolve().then(async () => {
                        const [requestHash, responseHash] = await Promise.all([
                            requestHashPromise,
                            getFetchResponseHash(response),
                        ]);
                        trackRequest(method, rawUrl, response.status, durationMs, false, requestHash, responseHash);
                    }).catch(() => {
                        trackRequest(method, rawUrl, response.status, durationMs, false, null, null);
                    });
                    return response;
                } catch (error) {
                    const durationMs = performance.now() - start;
                    Promise.resolve().then(async () => {
                        const requestHash = await requestHashPromise;
                        trackRequest(method, rawUrl, 0, durationMs, true, requestHash, null);
                    }).catch(() => {
                        trackRequest(method, rawUrl, 0, durationMs, true, null, null);
                    });
                    throw error;
                } finally {
                    onRequestEnd();
                }
            };
        }

        XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
            this.__mywPerfMethod = method || 'GET';
            this.__mywPerfUrl = url;
            return original.xhrOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function patchedSend(...args) {
            const xhr = this;
            const start = performance.now();
            const requestBody = args[0];
            let hadNetworkError = false;
            const requestErrorEvents = ['error', 'abort', 'timeout'];
            const markNetworkError = () => {
                hadNetworkError = true;
            };
            onRequestStart();

            const onDone = async function onDone() {
                xhr.removeEventListener('loadend', onDone);
                for (const eventName of requestErrorEvents) {
                    xhr.removeEventListener(eventName, markNetworkError);
                }
                const durationMs = performance.now() - start;
                const completedStatus = Number.isFinite(xhr.status) ? xhr.status : 0;
                const failed = hadNetworkError || completedStatus === 0;
                Promise.resolve().then(async () => {
                    const [requestHash, responseHash] = await Promise.all([
                        getXhrRequestHash(requestBody),
                        getXhrResponseHash(xhr),
                    ]);
                    trackRequest(
                        xhr.__mywPerfMethod || 'GET',
                        xhr.__mywPerfUrl,
                        completedStatus,
                        durationMs,
                        failed,
                        requestHash,
                        responseHash
                    );
                }).catch(() => {
                    trackRequest(
                        xhr.__mywPerfMethod || 'GET',
                        xhr.__mywPerfUrl,
                        completedStatus,
                        durationMs,
                        failed,
                        null,
                        null
                    );
                });
                onRequestEnd();
            };

            xhr.addEventListener('loadend', onDone);
            for (const eventName of requestErrorEvents) {
                xhr.addEventListener(eventName, markNetworkError);
            }

            try {
                return original.xhrSend.call(xhr, ...args);
            } catch (error) {
                xhr.removeEventListener('loadend', onDone);
                trackRequest(
                    xhr.__mywPerfMethod || 'GET',
                    xhr.__mywPerfUrl,
                    0,
                    performance.now() - start,
                    true,
                    null,
                    null
                );
                onRequestEnd();
                throw error;
            }
        };

        const onMoveStart = () => { counters.movestart += 1; };
        const onMoveEnd = () => { counters.moveend += 1; };

        map.on('movestart', onMoveStart);
        map.on('moveend', onMoveEnd);
        bindRenderLayerHooks();

        function takeSample() {
            bindRenderLayerHooks();
            const sample = sampleSessionState(app, map, counters, networkState, longTaskState, layerRenderState);
            pushCapped(session.samples, sample, MAX_SESSION_SAMPLES);
            return sample;
        }

        function getCurrentSnapshot() {
            bindRenderLayerHooks();
            return sampleSessionState(app, map, counters, networkState, longTaskState, layerRenderState);
        }

        function renderTab() {
            if (!tabContainer) return;
            const previousRoot = tabContainer.querySelector('#myw-performance-root');
            scrollState.tabTop = tabContainer.scrollTop;
            scrollState.tabLeft = tabContainer.scrollLeft;
            if (previousRoot) {
                scrollState.rootTop = previousRoot.scrollTop;
                scrollState.rootLeft = previousRoot.scrollLeft;
            }
            const snapshot = getCurrentSnapshot();
            const html = buildPerformanceUI(snapshot, sessionStartMs, loadSessions().length, session);
            tabContainer.innerHTML = html;
            tabContainer.scrollTop = scrollState.tabTop;
            tabContainer.scrollLeft = scrollState.tabLeft;
            const newRoot = tabContainer.querySelector('#myw-performance-root');
            if (newRoot) {
                newRoot.scrollTop = scrollState.rootTop;
                newRoot.scrollLeft = scrollState.rootLeft;
                requestAnimationFrame(() => {
                    newRoot.scrollTop = scrollState.rootTop;
                    newRoot.scrollLeft = scrollState.rootLeft;
                });
            }
            bindTabButtons();
        }

        function startSampleTimer() {
            if (sampleTimer) return;
            sampleTimer = setInterval(takeSample, SAMPLE_MS);
        }

        function stopSampleTimer() {
            if (!sampleTimer) return;
            clearInterval(sampleTimer);
            sampleTimer = null;
        }

        function cancelHiddenPause() {
            if (!hiddenPauseTimer) return;
            clearTimeout(hiddenPauseTimer);
            hiddenPauseTimer = null;
        }

        function pauseSamplingForHiddenDocument() {
            hiddenPauseTimer = null;
            if (!document.hidden || samplingPausedForHiddenDocument) return;
            samplingPausedForHiddenDocument = true;
            stopSampleTimer();
        }

        function handleDocumentVisibilityChange() {
            if (document.hidden) {
                cancelHiddenPause();
                if (!samplingPausedForHiddenDocument) {
                    hiddenPauseTimer = setTimeout(pauseSamplingForHiddenDocument, DOCUMENT_HIDDEN_GRACE_MS);
                }
                return;
            }

            cancelHiddenPause();
            if (samplingPausedForHiddenDocument) {
                samplingPausedForHiddenDocument = false;
                startSampleTimer();
                takeSample();
                renderTab();
            }
        }

        function startUiTimer() {
            if (uiTimer) return;
            uiTimer = setInterval(renderTab, UI_REFRESH_MS);
        }

        function stopUiTimer() {
            if (uiTimer) {
                clearInterval(uiTimer);
                uiTimer = null;
            }
        }

        function bindTabButtons() {
            const refreshBtn = tabContainer.querySelector('#myw-btn-refresh');
            const exportBtn = tabContainer.querySelector('#myw-btn-export');
            const clearBtn = tabContainer.querySelector('#myw-btn-clear');
            const defaultTabBtn = tabContainer.querySelector('#myw-btn-default-tab');
            const autoOpenPerf = getAutoOpenPerformancePref();

            if (refreshBtn) refreshBtn.onclick = () => renderTab();
            if (exportBtn) exportBtn.onclick = async () => { await exportReport(); };
            if (clearBtn) {
                clearBtn.onclick = () => {
                    if (!window.confirm('Clear all stored performance sessions?')) return;
                    clearStoredSessions();
                    renderTab();
                };
            }

            if (defaultTabBtn) {
                defaultTabBtn.textContent = autoOpenPerf ? 'Auto open: On' : 'Auto open: Off';
                defaultTabBtn.classList.toggle('myw-on', autoOpenPerf);
                defaultTabBtn.classList.toggle('myw-off', !autoOpenPerf);
                defaultTabBtn.onclick = () => {
                    setAutoOpenPerformancePref(!getAutoOpenPerformancePref());
                    renderTab();
                };
            }

            bindHelpTips();
        }

        function positionHelpTip(helpEl) {
            const tip = helpEl?.querySelector?.('.myw-help-tip');
            if (!tip) return;

            const margin = 8;
            const rootEl = helpEl.closest('#myw-performance-root') || tabContainer;
            const rootRect = rootEl?.getBoundingClientRect?.() || { left: 0, right: window.innerWidth, width: window.innerWidth };
            const maxWidth = Math.max(180, Math.min(340, Math.floor(rootRect.width - margin * 2)));

            tip.style.maxWidth = `${maxWidth}px`;
            tip.classList.remove('myw-help-tip-left');
            tip.style.left = 'calc(100% + 8px)';
            tip.style.right = 'auto';

            let rect = tip.getBoundingClientRect();
            if (rect.right > rootRect.right - margin) {
                tip.classList.add('myw-help-tip-left');
                tip.style.left = 'auto';
                tip.style.right = 'calc(100% + 8px)';
                rect = tip.getBoundingClientRect();
            }

            if (rect.left < rootRect.left + margin) {
                tip.classList.remove('myw-help-tip-left');
                tip.style.left = 'calc(100% + 8px)';
                tip.style.right = 'auto';
                rect = tip.getBoundingClientRect();
            }

            if (rect.right > rootRect.right - margin) {
                tip.classList.add('myw-help-tip-left');
                tip.style.left = 'auto';
                tip.style.right = 'calc(100% + 8px)';
            }
        }

        function bindHelpTips() {
            for (const helpEl of tabContainer.querySelectorAll('.myw-help')) {
                const handler = () => positionHelpTip(helpEl);
                helpEl.onmouseenter = handler;
                helpEl.onmouseover = handler;
                helpEl.onfocus = handler;
                helpEl.onblur = () => {
                    const tip = helpEl.querySelector('.myw-help-tip');
                    if (tip) {
                        tip.classList.remove('myw-help-tip-left');
                        tip.style.left = 'calc(100% + 8px)';
                        tip.style.right = 'auto';
                    }
                };
            }
        }

        function saveCurrentSession() {
            const sessions = loadSessions();
            sessions.push(stripSamplesForStorage(session));
            saveSessions(sessions);
        }

        document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
        startSampleTimer();
        const current = takeSample();

        function stop() {
            if (stopped) return session;
            stopped = true;

            cancelHiddenPause();
            stopSampleTimer();
            stopUiTimer();
            map.un('movestart', onMoveStart);
            map.un('moveend', onMoveEnd);
            document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);

            for (const [layer, onPostRender] of renderLayerHooks.entries()) {
                layer.un?.('postrender', onPostRender);
            }
            renderLayerHooks.clear();

            if (original.statusBusy) app.statusBusy = original.statusBusy;
            if (original.showStatus) layout.showStatus = original.showStatus;
            if (original.hideStatus) layout.hideStatus = original.hideStatus;
            if (original.fetch) window.fetch = original.fetch;
            XMLHttpRequest.prototype.open = original.xhrOpen;
            XMLHttpRequest.prototype.send = original.xhrSend;

            if (longTaskObserver) longTaskObserver.disconnect();

            window.removeEventListener('beforeunload', onBeforeUnload);

            session.final = getCurrentSnapshot();
            saveCurrentSession();

            console.log('[myw-perf] saved session', session);
            return session;
        }

        async function savePayloadToFile(payload, suggestedName) {
            const payloadJson = JSON.stringify(payload, null, 2);

            if (typeof window.showSaveFilePicker === 'function') {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName,
                        types: [{
                            description: 'JSON Files',
                            accept: { 'application/json': ['.json'] },
                        }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(payloadJson);
                    await writable.close();
                    return 'saved';
                } catch (error) {
                    if (error?.name === 'AbortError') return 'cancelled';
                    console.warn('[myw-perf] Export save failed:', error);
                    return 'failed';
                }
            }

            try {
                const blob = new Blob([payloadJson], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = suggestedName;
                anchor.click();
                URL.revokeObjectURL(url);
                return 'triggered';
            } catch (error) {
                console.warn('[myw-perf] Export trigger failed:', error);
                return 'failed';
            }
        }

        async function exportReport() {
            const payload = {
                version: PAYLOAD_VERSION,
                exportedAt: new Date().toISOString(),
                exportedBy: userIdentity,
                session,
                current: getCurrentSnapshot(),
            };

            const fileName = `iqgeo-perf-metrics-${userIdentity.fileToken}-${Date.now()}.json`;
            const saveState = await savePayloadToFile(payload, fileName);

            if (saveState === 'saved') {
                clearStoredSessions();
                renderTab();
            } else if (saveState === 'triggered') {
                console.info('[myw-perf] Export was triggered with browser download flow. Stored sessions were kept to avoid accidental loss if save is cancelled.');
            }

            return payload;
        }

        const tabObject = {
            visibilityChanged(visible) {
                if (visible) {
                    renderTab();
                    startUiTimer();
                } else {
                    stopUiTimer();
                }
            },
            invalidateSize() {},
            remove() {
                stopUiTimer();
            },
        };

        const autoOpenPerformance = getAutoOpenPerformancePref();

        if (tabControl.tabs?.[TAB_ID]) {
            tabContainer = getDomContainer(tabControl.tabs[TAB_ID].div);
        } else {
            const previousTabId = tabControl.currentTabId;
            tabControl.addTab({
                id: TAB_ID,
                title: TAB_TITLE,
                object: tabObject,
            });
            tabContainer = getDomContainer(tabControl.tabs?.[TAB_ID]?.div);

            if (!autoOpenPerformance) {
                const fallbackTabId = previousTabId || tabControl.options?.initialTab;
                if (fallbackTabId && fallbackTabId !== TAB_ID && tabControl.tabs?.[fallbackTabId]) {
                    tabControl.switchToTab(fallbackTabId);
                }
            }
        }

        function onBeforeUnload() {
            if (stopped) return;
            session.final = getCurrentSnapshot();
            saveCurrentSession();
        }

        window.addEventListener('beforeunload', onBeforeUnload);

        if (tabContainer) {
            renderTab();
            startUiTimer();
        }

        window._mywPerfMetrics = {
            session,
            current,
            user: userIdentity,
            exportReport,
            clearStoredSessions,
            dump() {
                console.table(session.samples.map(sample => ({
                    at: sample.at,
                    rendercomplete: sample.counters.rendercomplete,
                    rendercompleteUser: sample.counters.rendercompleteUser,
                    rendercompleteBackground: sample.counters.rendercompleteBackground,
                    movestart: sample.counters.movestart,
                    moveend: sample.counters.moveend,
                    statusBusy: sample.counters.statusBusy,
                    showStatus: sample.counters.showStatus,
                    hideStatus: sample.counters.hideStatus,
                    browserMemoryUsedMB: sample.browserMemory?.usedMB ?? null,
                    browserMemoryTotalMB: sample.browserMemory?.totalMB ?? null,
                    browserMemoryLimitMB: sample.browserMemory?.limitMB ?? null,
                    domNodeCount: sample.domNodeCount,
                    canvasCount: sample.canvasCount,
                    basemapCacheTiles: sample.basemapCacheTiles,
                    layerCountTotal: sample.layerSummary?.totalLayerCount ?? null,
                    layerCountUser: sample.layerSummary?.userLayerCount ?? null,
                    layerCountBackground: sample.layerSummary?.backgroundLayerCount ?? null,
                    vectorCacheFeatures: sample.vectorCache.featureCount,
                    vectorSharedFeatures: sample.vectorCache.sharedVectorFeatures,
                    vectorMarkerFeatures: sample.vectorCache.markerFeatures,
                    vectorTotalCached: sample.vectorCache.totalCachedFeatures,
                    featureRepUrns: sample.vectorCache.featureRepUrns,
                    featureRepInstances: sample.vectorCache.featureRepInstances,
                    repCoveragePct: sample.vectorCache.representationCoveragePct,
                    cachePressureRatio: sample.vectorCache.cachePressureRatio,
                    vectorCacheLayers: sample.vectorCache.layerCount,
                    requestTotal: sample.counters.requestTotal,
                    requestFailed: sample.counters.requestFailed,
                    requestSlow: sample.counters.requestSlow,
                    uniqueEndpointCount: sample.network.uniqueEndpointCount,
                    p95RequestMs: sample.network.p95RequestMs,
                    topEndpointP95: sample.network.topEndpointPerformance[0]?.p95Ms ?? null,
                    nearRepeatChecked: sample.network.nearConsecutiveRepeats.checked,
                    nearRepeatEndpoint: sample.network.nearConsecutiveRepeats.endpointMethod,
                    nearRepeatEndpointPct: sample.network.nearConsecutiveRepeats.endpointMethodPct,
                    nearRepeatExact: sample.network.nearConsecutiveRepeats.exactPayloadAndResponse,
                    nearRepeatExactPct: sample.network.nearConsecutiveRepeats.exactPayloadAndResponsePct,
                    topRenderLayer: sample.layerRenders?.[0]?.label ?? null,
                    topRenderLayerType: sample.layerRenders?.[0]?.type ?? null,
                    topRenderLayerCount: sample.layerRenders?.[0]?.count ?? null,
                    longTaskCount: sample.longTasks.count,
                })));
                return session;
            },
        };

        console.log(`[myw-perf] installed for ${userIdentity.localPart || userIdentity.fileToken}. Use exportReport(), clearStoredSessions(), or dump().`);
        return current;
    }

    main().catch(err => {
        console.error('[myw-perf] failed to install:', err);
    });
})();
