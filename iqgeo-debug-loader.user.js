// ==UserScript==
// @name         IQGeo Debug Tools
// @namespace    https://github.com/Conterra-Networks/iqgeo-debug-scripts
// @version      1.0.0
// @description  Loads IQGeo debug scripts from GitHub after app initialisation
// @author       CShepard
// @match        https://*.nmt.iqgeo.cloud/*
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/iqgeo-debug-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/iqgeo-debug-loader.user.js
// ==/UserScript==

(async function () {

    // Scripts to inject, in order. Comment out any you don't want to run.
    const SCRIPTS = [
        'https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/patch-show-status.js',
        'https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/listener-monitor.js',
    ];

    // How long to wait for the app to initialise before giving up (ms).
    const TIMEOUT_MS = 30000;

    // -------------------------------------------------------------------------
    // Wait for the IQGeo app to reach a state where injected scripts can run.
    // tabControl readiness is used as the gate: it is the last dependency for
    // the most demanding script (listener-monitor), and its presence implies
    // app, layout, and all core controls are fully initialised.
    // -------------------------------------------------------------------------
    function waitForApp() {
        return new Promise((resolve, reject) => {
            if (window.myw?.app?.layout?.controls?.tabControl) {
                resolve();
                return;
            }
            const start = Date.now();
            const id = setInterval(() => {
                if (window.myw?.app?.layout?.controls?.tabControl) {
                    clearInterval(id);
                    resolve();
                } else if (Date.now() - start >= TIMEOUT_MS) {
                    clearInterval(id);
                    reject(new Error(`App not ready after ${TIMEOUT_MS / 1000}s`));
                }
            }, 500);
        });
    }

    async function injectScript(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const code = await response.text();
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.textContent = code;
        document.documentElement.appendChild(script);
        script.remove();
    }

    try {
        await waitForApp();
    } catch (err) {
        console.error('[iqgeo-debug] Could not inject - app did not initialise in time:', err.message);
        return;
    }

    for (const url of SCRIPTS) {
        try {
            await injectScript(url);
        } catch (err) {
            console.error(`[iqgeo-debug] Failed to load ${url}:`, err);
        }
    }

})();
