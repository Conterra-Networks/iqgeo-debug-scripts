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

    // Scripts to inject, in order
    const SCRIPTS = [
        'https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/listener-monitor.js',
    ];

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

    for (const url of SCRIPTS) {
        try {
            await injectScript(url);
        } catch (err) {
            console.error(`[iqgeo-debug] Failed to load ${url}:`, err);
        }
    }

})();
