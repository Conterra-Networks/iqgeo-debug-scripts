// ==UserScript==
// @name         IQGeo Debug Tools
// @namespace    https://github.com/Conterra-Networks/iqgeo-debug-scripts
// @version      1.4.0
// @description  Loads IQGeo debug scripts from a remote manifest on GitHub
// @author       CShepard
// @match        https://*.nmt.iqgeo.cloud/*
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/iqgeo-debug-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/iqgeo-debug-loader.user.js
// ==/UserScript==

(async function () {
    'use strict';

    const MANIFEST_URL = 'https://raw.githubusercontent.com/Conterra-Networks/iqgeo-debug-scripts/main/debug-tools-manifest.json';
    const MANIFEST_CACHE_KEY = 'iqgeo_debug_loader_manifest_cache';
    const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;

    function safeJsonParse(value, fallback) {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function normalizeStringArray(values) {
        if (!Array.isArray(values)) return [];
        const seen = new Set();
        const output = [];
        for (const value of values) {
            if (typeof value !== 'string') continue;
            const token = value.trim().toLowerCase();
            if (!token || seen.has(token)) continue;
            seen.add(token);
            output.push(token);
        }
        return output;
    }

    function resolveRoleCandidate() {
        const roles = window.myw?.app?.database?.startupInfo?.roles;
        return Array.isArray(roles) ? roles : null;
    }

    async function resolveRoleContext(timeoutMs = 4000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const candidate = resolveRoleCandidate();
            if (candidate) {
                const roles = normalizeStringArray(candidate);
                return {
                    roles,
                    display: roles.length ? roles.join(', ') : 'none',
                };
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        const roles = normalizeStringArray(resolveRoleCandidate());
        return {
            roles,
            display: roles.length ? roles.join(', ') : 'none',
        };
    }

    function matchesRole(roles, list) {
        if (list.includes('*')) return true;
        if (!roles.length) return false;
        return roles.some(role => list.includes(role));
    }

    function isAllowedByLists(roles, allowRoles, denyRoles) {
        if (matchesRole(roles, denyRoles)) return false;
        if (allowRoles.length === 0) return true;
        return matchesRole(roles, allowRoles);
    }

    function normalizeScriptEntry(entry) {
        if (typeof entry === 'string') {
            const url = entry.trim();
            return url
                ? { id: url, url, enabled: true, allowRoles: [], denyRoles: [] }
                : null;
        }
        if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') return null;
        const url = entry.url.trim();
        if (!url) return null;
        return {
            id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : url,
            url,
            enabled: entry.enabled !== false,
            allowRoles: normalizeStringArray(entry.allowRoles || entry.allowUsers),
            denyRoles: normalizeStringArray(entry.denyRoles || entry.denyUsers),
        };
    }

    function dedupeScripts(scripts) {
        const seen = new Set();
        const output = [];
        for (const script of scripts) {
            if (!script || typeof script.url !== 'string') continue;
            if (seen.has(script.url)) continue;
            seen.add(script.url);
            output.push(script);
        }
        return output;
    }

    function readCachedManifest() {
        const cached = safeJsonParse(localStorage.getItem(MANIFEST_CACHE_KEY), null);
        if (!cached || !cached.manifest || typeof cached.cachedAt !== 'number') {
            return null;
        }
        if (Date.now() - cached.cachedAt > MANIFEST_CACHE_TTL_MS) return null;
        return cached.manifest;
    }

    function writeCachedManifest(manifest) {
        const payload = {
            cachedAt: Date.now(),
            manifest,
        };
        localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(payload));
    }

    function normalizeManifest(manifest) {
        const allowRoles = normalizeStringArray(manifest?.allowRoles || manifest?.allowUsers);
        const denyRoles = normalizeStringArray(manifest?.denyRoles || manifest?.denyUsers);

        const rawScripts = Array.isArray(manifest)
            ? manifest
            : (manifest && Array.isArray(manifest.scripts) ? manifest.scripts : null);

        if (!rawScripts) {
            throw new Error('Manifest must be an array or an object with a scripts array.');
        }

        const scripts = dedupeScripts(rawScripts.map(normalizeScriptEntry).filter(Boolean));
        return { allowRoles, denyRoles, scripts };
    }

    async function loadManifest() {
        const cachedManifest = readCachedManifest();
        if (cachedManifest) return normalizeManifest(cachedManifest);

        const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Manifest HTTP ${response.status}: ${response.statusText}`);
        const manifest = await response.json();
        const normalized = normalizeManifest(manifest);
        writeCachedManifest(normalized);
        return normalized;
    }

    function selectScriptsForRoles(manifest, roleContext) {
        if (!isAllowedByLists(roleContext.roles, manifest.allowRoles, manifest.denyRoles)) {
            return [];
        }

        const selected = [];
        for (const script of manifest.scripts) {
            if (!script.enabled) continue;
            if (!isAllowedByLists(roleContext.roles, script.allowRoles, script.denyRoles)) continue;
            selected.push(script);
        }
        return selected;
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

    let manifestConfig = { allowRoles: [], denyRoles: [], scripts: [] };
    try {
        manifestConfig = await loadManifest();
        console.info(`[iqgeo-debug] Loaded manifest with ${manifestConfig.scripts.length} script entries.`);
    } catch (err) {
        console.warn('[iqgeo-debug] Manifest unavailable. No scripts will load this session.', err);
    }

    const roleContext = await resolveRoleContext();
    const scriptsToLoad = selectScriptsForRoles(manifestConfig, roleContext);
    console.info(`[iqgeo-debug] Role context: ${roleContext.display}. Selected ${scriptsToLoad.length} scripts.`);

    for (const script of scriptsToLoad) {
        try {
            await injectScript(script.url);
            console.info(`[iqgeo-debug] Loaded ${script.id}`);
        } catch (err) {
            console.error(`[iqgeo-debug] Failed to load ${script.id} (${script.url}):`, err);
        }
    }

})();
