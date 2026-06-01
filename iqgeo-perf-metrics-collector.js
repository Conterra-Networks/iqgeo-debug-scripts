(function installPerfMetricsCollector() {
    'use strict';

    const STORAGE_KEY = 'myw_perf_metrics_sessions';
    const MAX_SESSIONS = 20;
    const SAMPLE_MS = 5000;
    const UI_REFRESH_MS = 5000;
    const TAB_ID = 'myw-performance';
    const TAB_TITLE = 'Performance';
    const TOP_ENDPOINT_LIMIT = 12;
    const SLOW_REQUEST_MS = 1000;
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
        }
        #myw-performance-root .myw-perf-list {
            margin: 0;
            padding: 0;
            list-style: none;
            line-height: 1.45;
        }
        #myw-performance-root .myw-perf-k {
            color: #57606a;
        }
        #myw-performance-root .myw-perf-v {
            float: right;
            font-variant-numeric: tabular-nums;
            color: #24292f;
        }
        #myw-performance-root .myw-perf-flag-high { color: #b02a37; font-weight: 700; }
        #myw-performance-root .myw-perf-flag-ok { color: #1f7a3d; font-weight: 700; }
        #myw-performance-root table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            overflow: hidden;
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
        #myw-performance-root td.myw-num {
            text-align: right;
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
        if (tabControl?.tabs?.[TAB_ID]) tabControl.switchToTab(TAB_ID);
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

    function sampleSessionState(app, map, counters, networkState, longTaskState) {
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
            },
            longTasks: {
                count: longTaskState.count,
                totalMs: longTaskState.totalMs,
                maxMs: longTaskState.maxMs,
            },
        };
    }

    function buildPerformanceUI(snapshot, sessionStartMs, storedSessionCount, session) {
        const counters = snapshot.counters;
        const network = snapshot.network;
        const longTasks = snapshot.longTasks;
        const vectorCache = snapshot.vectorCache;
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

        return `
            <div id="myw-performance-root">
                <style>${STYLES}</style>
                <div class="myw-perf-toolbar">
                    <button id="myw-btn-refresh">Refresh</button>
                    <button id="myw-btn-auto" class="myw-on">Auto: ON</button>
                    <button id="myw-btn-sample">Sample Now</button>
                    <button id="myw-btn-export">Export JSON</button>
                    <button id="myw-btn-stop">Stop + Save</button>
                </div>
                <div class="myw-perf-status">
                    Last updated: ${new Date(snapshot.at).toLocaleTimeString()} | Session elapsed: ${formatElapsed(elapsedSeconds(sessionStartMs))} | Stored sessions: ${storedSessionCount}
                </div>
                <div class="myw-perf-grid">
                    <div class="myw-perf-card">
                        <h4>Map Activity</h4>
                        <ul class="myw-perf-list">
                            <li><span class="myw-perf-k">Move start</span><span class="myw-perf-v">${counters.movestart}</span></li>
                            <li><span class="myw-perf-k">Move end</span><span class="myw-perf-v">${counters.moveend}</span></li>
                            <li><span class="myw-perf-k">Render complete</span><span class="myw-perf-v">${counters.rendercomplete}</span></li>
                            <li><span class="myw-perf-k">Render per move</span><span class="myw-perf-v ${computeFlagClass(renderRisk)}">${renderPerMove === null ? '-' : renderPerMove.toFixed(2)}</span></li>
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        <h4>Status Churn</h4>
                        <ul class="myw-perf-list">
                            <li><span class="myw-perf-k">statusBusy</span><span class="myw-perf-v">${counters.statusBusy}</span></li>
                            <li><span class="myw-perf-k">showStatus</span><span class="myw-perf-v">${counters.showStatus}</span></li>
                            <li><span class="myw-perf-k">hideStatus</span><span class="myw-perf-v">${counters.hideStatus}</span></li>
                            <li><span class="myw-perf-k">statusBusy per move</span><span class="myw-perf-v ${computeFlagClass(statusRisk)}">${statusPerMove === null ? '-' : statusPerMove.toFixed(2)}</span></li>
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        <h4>Memory and Caches</h4>
                        <ul class="myw-perf-list">
                            <li><span class="myw-perf-k">JS heap used / total</span><span class="myw-perf-v">${snapshot.browserMemory.usedMB === null ? 'n/a' : `${snapshot.browserMemory.usedMB} / ${snapshot.browserMemory.totalMB === null ? '-' : snapshot.browserMemory.totalMB} MB`}</span></li>
                            <li><span class="myw-perf-k">Canvas count</span><span class="myw-perf-v">${snapshot.canvasCount}</span></li>
                            <li><span class="myw-perf-k">DOM nodes</span><span class="myw-perf-v">${snapshot.domNodeCount}</span></li>
                            <li><span class="myw-perf-k">Basemap cache tiles</span><span class="myw-perf-v">${snapshot.basemapCacheTiles === null ? 'n/a' : snapshot.basemapCacheTiles}</span></li>
                            <li><span class="myw-perf-k">Vector cached (shared + markers)</span><span class="myw-perf-v">${vectorCache.totalCachedFeatures} (${vectorCache.sharedVectorFeatures} + ${vectorCache.markerFeatures})</span></li>
                            <li><span class="myw-perf-k">Feature reps (URNs / instances)</span><span class="myw-perf-v">${vectorCache.featureRepUrns} / ${vectorCache.featureRepInstances}</span></li>
                            <li><span class="myw-perf-k">Rep coverage / pressure</span><span class="myw-perf-v">${vectorCache.representationCoveragePct === null ? '-' : `${vectorCache.representationCoveragePct}%`} / ${vectorCache.cachePressureRatio === null ? '-' : vectorCache.cachePressureRatio}</span></li>
                            <li><span class="myw-perf-k">Vector growth rate</span><span class="myw-perf-v">${vectorGrowthRatePerMin === null ? '-' : `${vectorGrowthRatePerMin > 0 ? '+' : ''}${vectorGrowthRatePerMin} features/min`}</span></li>
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        <h4>Network</h4>
                        <ul class="myw-perf-list">
                            <li><span class="myw-perf-k">Requests</span><span class="myw-perf-v">${counters.requestTotal}</span></li>
                            <li><span class="myw-perf-k">Failed</span><span class="myw-perf-v">${counters.requestFailed} (${failedRate}%)</span></li>
                            <li><span class="myw-perf-k">Slow > ${SLOW_REQUEST_MS}ms</span><span class="myw-perf-v ${computeFlagClass(slowRisk)}">${counters.requestSlow}</span></li>
                            <li><span class="myw-perf-k">Unique endpoints</span><span class="myw-perf-v">${network.uniqueEndpointCount}</span></li>
                            <li><span class="myw-perf-k">In-flight / max</span><span class="myw-perf-v">${network.inFlight} / ${network.maxInFlight}</span></li>
                            <li><span class="myw-perf-k">Avg / p95 request</span><span class="myw-perf-v">${network.avgRequestMs === null ? '-' : `${network.avgRequestMs} / ${network.p95RequestMs === null ? '-' : network.p95RequestMs} ms`}</span></li>
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        <h4>Long Tasks</h4>
                        <ul class="myw-perf-list">
                            <li><span class="myw-perf-k">Count</span><span class="myw-perf-v">${longTasks.count}</span></li>
                            <li><span class="myw-perf-k">Total blocked time</span><span class="myw-perf-v">${formatDurationMs(longTasks.totalMs)}</span></li>
                            <li><span class="myw-perf-k">Longest task</span><span class="myw-perf-v">${formatDurationMs(longTasks.maxMs)}</span></li>
                        </ul>
                    </div>
                    <div class="myw-perf-card">
                        <h4>Listener Snapshot</h4>
                        <ul class="myw-perf-list">
                            <li><span class="myw-perf-k">App listeners (tracked)</span><span class="myw-perf-v">${Object.values(snapshot.appListeners).reduce((sum, value) => sum + value, 0)}</span></li>
                            <li><span class="myw-perf-k">Map listeners (tracked)</span><span class="myw-perf-v">${Object.values(snapshot.mapListeners).reduce((sum, value) => sum + value, 0)}</span></li>
                            <li><span class="myw-perf-k">featureCollection-modified</span><span class="myw-perf-v">${snapshot.appListeners['featureCollection-modified']}</span></li>
                            <li><span class="myw-perf-k">currentFeature-changed</span><span class="myw-perf-v">${snapshot.appListeners['currentFeature-changed']}</span></li>
                        </ul>
                    </div>
                </div>
                <h4>Top Endpoints This Session</h4>
                <table>
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
                <div class="myw-note">Tip: compare statusBusy per move and endpoint p95 while reproducing low-performance workflows.</div>
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
        };

        const longTaskState = {
            count: 0,
            totalMs: 0,
            maxMs: 0,
        };

        const session = {
            startedAt: new Date().toISOString(),
            user: userIdentity,
            samples: [],
            final: null,
        };

        const sessionStartMs = Date.now();

        let stopped = false;
        let tabContainer = null;
        let autoRefresh = true;
        let uiTimer = null;

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

        function trackRequest(method, rawUrl, status, durationMs, hadNetworkError) {
            counters.requestTotal += 1;
            if (hadNetworkError || status >= 400) counters.requestFailed += 1;
            if (durationMs >= SLOW_REQUEST_MS) counters.requestSlow += 1;

            networkState.requestDurationsMs.push(Math.round(durationMs));
            networkState.requestDurationsTotalMs += durationMs;

            const endpoint = normalizeEndpoint(rawUrl);
            const methodPrefix = method ? method.toUpperCase() : 'GET';
            if (endpoint) {
                const key = `${methodPrefix} ${endpoint}`;
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
                endpointEntry.durationsMs.push(Math.round(durationMs));
                if (hadNetworkError || status >= 400) endpointEntry.failed += 1;
                if (durationMs >= SLOW_REQUEST_MS) endpointEntry.slow += 1;
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

                onRequestStart();
                try {
                    const response = await original.fetch(input, init);
                    trackRequest(method, rawUrl, response.status, performance.now() - start, false);
                    return response;
                } catch (error) {
                    trackRequest(method, rawUrl, 0, performance.now() - start, true);
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
            onRequestStart();

            const onDone = function onDone() {
                xhr.removeEventListener('loadend', onDone);
                trackRequest(
                    xhr.__mywPerfMethod || 'GET',
                    xhr.__mywPerfUrl,
                    Number.isFinite(xhr.status) ? xhr.status : 0,
                    performance.now() - start,
                    false
                );
                onRequestEnd();
            };

            xhr.addEventListener('loadend', onDone);

            try {
                return original.xhrSend.call(xhr, ...args);
            } catch (error) {
                xhr.removeEventListener('loadend', onDone);
                trackRequest(
                    xhr.__mywPerfMethod || 'GET',
                    xhr.__mywPerfUrl,
                    0,
                    performance.now() - start,
                    true
                );
                onRequestEnd();
                throw error;
            }
        };

        const onRenderComplete = () => { counters.rendercomplete += 1; };
        const onMoveStart = () => { counters.movestart += 1; };
        const onMoveEnd = () => { counters.moveend += 1; };

        map.on('rendercomplete', onRenderComplete);
        map.on('movestart', onMoveStart);
        map.on('moveend', onMoveEnd);

        function takeSample() {
            const sample = sampleSessionState(app, map, counters, networkState, longTaskState);
            session.samples.push(sample);
            return sample;
        }

        function getCurrentSnapshot() {
            return sampleSessionState(app, map, counters, networkState, longTaskState);
        }

        function renderTab() {
            if (!tabContainer) return;
            const snapshot = getCurrentSnapshot();
            const html = buildPerformanceUI(snapshot, sessionStartMs, loadSessions().length, session);
            tabContainer.innerHTML = html;
            bindTabButtons();
        }

        function startUiTimer() {
            if (uiTimer || !autoRefresh) return;
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
            const autoBtn = tabContainer.querySelector('#myw-btn-auto');
            const sampleBtn = tabContainer.querySelector('#myw-btn-sample');
            const exportBtn = tabContainer.querySelector('#myw-btn-export');
            const stopBtn = tabContainer.querySelector('#myw-btn-stop');

            if (refreshBtn) refreshBtn.onclick = () => renderTab();
            if (autoBtn) {
                autoBtn.className = autoRefresh ? 'myw-on' : 'myw-off';
                autoBtn.textContent = autoRefresh ? 'Auto: ON' : 'Auto: OFF';
                autoBtn.onclick = () => {
                    autoRefresh = !autoRefresh;
                    if (autoRefresh) startUiTimer();
                    else stopUiTimer();
                    renderTab();
                };
            }
            if (sampleBtn) {
                sampleBtn.onclick = () => {
                    takeSample();
                    renderTab();
                };
            }
            if (exportBtn) exportBtn.onclick = () => exportReport();
            if (stopBtn) {
                stopBtn.onclick = () => {
                    stop();
                    renderTab();
                };
            }
        }

        function saveCurrentSession() {
            const sessions = loadSessions();
            sessions.push(stripSamplesForStorage(session));
            saveSessions(sessions);
        }

        const sampleTimer = setInterval(takeSample, SAMPLE_MS);
        const current = takeSample();

        function stop() {
            if (stopped) return session;
            stopped = true;

            clearInterval(sampleTimer);
            stopUiTimer();
            map.un('rendercomplete', onRenderComplete);
            map.un('movestart', onMoveStart);
            map.un('moveend', onMoveEnd);

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

        function exportReport() {
            const payload = {
                version: 4,
                exportedAt: new Date().toISOString(),
                exportedBy: userIdentity,
                session,
                current: getCurrentSnapshot(),
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `iqgeo-perf-metrics-${userIdentity.fileToken}-${Date.now()}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
            return payload;
        }

        const tabObject = {
            visibilityChanged(visible) {
                if (visible) {
                    renderTab();
                    if (autoRefresh) startUiTimer();
                } else {
                    stopUiTimer();
                }
            },
            invalidateSize() {},
            remove() {
                stopUiTimer();
            },
        };

        if (tabControl.tabs?.[TAB_ID]) {
            tabControl.switchToTab(TAB_ID);
            tabContainer = getDomContainer(tabControl.tabs[TAB_ID].div);
        } else {
            tabControl.addTab({
                id: TAB_ID,
                title: TAB_TITLE,
                object: tabObject,
            });
            tabContainer = getDomContainer(tabControl.tabs?.[TAB_ID]?.div);
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
            sample: takeSample,
            stop,
            exportReport,
            dump() {
                console.table(session.samples.map(sample => ({
                    at: sample.at,
                    rendercomplete: sample.counters.rendercomplete,
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
                    longTaskCount: sample.longTasks.count,
                })));
                return session;
            },
        };

        console.log(`[myw-perf] installed for ${userIdentity.localPart || userIdentity.fileToken}. Use sample(), dump(), exportReport(), or stop().`);
        return current;
    }

    main().catch(err => {
        console.error('[myw-perf] failed to install:', err);
    });
})();
