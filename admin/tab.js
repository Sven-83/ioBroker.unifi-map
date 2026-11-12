/*
 * Admin tab: topology map of the UniFi network, live from the states of the instance.
 * Reads only. Names come from the console and are always escaped before they reach the page.
 */
(function () {
    'use strict';

    const L = window.UnifiMapLayout;
    const S = L.SIZE;
    const esc = L.esc;

    // instance from the tab URL: "tab.html?0" or "tab.html?instance=0"
    const match = /^\?(\d+)/.exec(location.search) || /[?&]instance=(\d+)/.exec(location.search);
    const prefix = `unifi-map.${match ? match[1] : '0'}.`;

    const TEXT = {
        en: {
            devices: n => `UniFi · ${n} devices`,
            running: 'Network is running',
            slow: 'Uplink slower than usual',
            failed: name => `${name} failed`,
            stale: 'No current data',
            noData: 'No data yet',
            online: 'Online',
            slowK: 'Slow',
            updates: 'Updates',
            map: 'Topology',
            hint: 'Tap a device for details',
            cable: 'Cable',
            mesh: 'Mesh',
            segment: 'Not UniFi',
            notUnifi: 'Not UniFi',
            notUnifiSub: 'e.g. powerline',
            notUnifiNamedSub: 'not UniFi',
            notReachable: 'not reachable',
            failedSub: 'failed',
            updating: 'updating',
            port: p => `Port ${p}`,
            instead: (a, b) => `${a} instead of ${b}`,
            disconnected: 'No connection to ioBroker',
            noConsole: 'No connection to the console',
            staleBanner: 'The data is too old. Is the instance running?',
            model: 'Model',
            state: 'State',
            connectedTo: 'Connected to',
            link: 'Link',
            uptime: 'Uptime',
            firmware: 'Firmware',
            clients: 'Clients',
            ip: 'IP',
            restarts: 'Restarts (7 days)',
            stOk: 'running',
            stDegraded: 'uplink slower than usual',
            stOffline: 'failed',
            stConsequence: 'not reachable (behind a failed device)',
            stBusy: 'update running',
            updateAvailable: 'Update available',
            updateHint: 'A firmware update is available. Starting it from here follows in a later version.',
            causeHint: name => `Not reachable because ${name} failed.`,
            days: (d, h) => `${d} d ${h} h`,
            hours: h => `${h} h`,
            close: 'Close',
        },
        de: {
            devices: n => `UniFi · ${n} Geräte`,
            running: 'Netzwerk läuft',
            slow: 'Uplink langsamer als gewohnt',
            failed: name => `${name} ausgefallen`,
            stale: 'Keine aktuellen Daten',
            noData: 'Noch keine Daten',
            online: 'Online',
            slowK: 'Langsam',
            updates: 'Updates',
            map: 'Topologie',
            hint: 'Tippen öffnet Details',
            cable: 'Kabel',
            mesh: 'Mesh',
            segment: 'Nicht UniFi',
            notUnifi: 'Nicht UniFi',
            notUnifiSub: 'z. B. Powerline',
            notUnifiNamedSub: 'kein UniFi-Gerät',
            notReachable: 'nicht erreichbar',
            failedSub: 'ausgefallen',
            updating: 'Update läuft',
            port: p => `Port ${p}`,
            instead: (a, b) => `${a} statt ${b}`,
            disconnected: 'Keine Verbindung zu ioBroker',
            noConsole: 'Keine Verbindung zur Konsole',
            staleBanner: 'Die Daten sind zu alt. Läuft die Instanz?',
            model: 'Modell',
            state: 'Zustand',
            connectedTo: 'Hängt an',
            link: 'Verbindung',
            uptime: 'Laufzeit',
            firmware: 'Firmware',
            clients: 'Clients',
            ip: 'IP',
            restarts: 'Neustarts (7 Tage)',
            stOk: 'läuft',
            stDegraded: 'Uplink langsamer als gewohnt',
            stOffline: 'ausgefallen',
            stConsequence: 'nicht erreichbar (hinter einem ausgefallenen Gerät)',
            stBusy: 'Update läuft',
            updateAvailable: 'Update verfügbar',
            updateHint: 'Ein Firmware-Update ist verfügbar. Starten von hier folgt in einer späteren Version.',
            causeHint: name => `Nicht erreichbar, weil ${name} ausgefallen ist.`,
            days: (d, h) => `${d} T ${h} h`,
            hours: h => `${h} h`,
            close: 'Schließen',
        },
    };
    let t = TEXT[(navigator.language || 'en').slice(0, 2)] || TEXT.en;

    // line icons (24 grid, stroke 1.7)
    const ICON = {
        gateway:
            'M8.5 2.5h7a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z M9.5 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M10.5 17.5h3',
        switch: 'M2.5 8h19v8h-19z M6 12h.01 M9 12h.01 M12 12h.01 M15 12h.01 M18 12h.5',
        accessPoint: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M7.5 12a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0 M12 12h.01',
        unknownSwitch: 'M9 2.5v4 M15 2.5v4 M6.5 6.5h11v4.5a5.5 5.5 0 0 1-11 0z M12 16.5v5 M13 8.5l-2 2.7h2.6l-1.8 2.6',
    };
    // card look per state (like the status tiles of the start page)
    const LOOK = {
        ok: { bg: '#183323', bd: '#3f8f57', fg: '#9fe0b2', sub: '#7fbf93', led: '#6fe08a' },
        degraded: { bg: '#183323', bd: '#3f8f57', fg: '#9fe0b2', sub: '#f2c14e', led: '#f2c14e', ledCls: 'slow' },
        offline: { bg: '#3a1d1f', bd: '#e5484d', fg: '#ffb3b3', sub: '#ffb3b3', led: '#e5484d', ledCls: 'alarm' },
        consequence: { bg: 'none', bd: '#4f4f56', fg: '#a3a19a', sub: '#77746c', dash: '5 4' },
        busy: { bg: '#16283a', bd: '#4aa3ff', fg: '#9cc9ff', sub: '#9cc9ff', led: '#4aa3ff', ledCls: 'slow' },
        virtual: { bg: 'none', bd: '#e8913a', fg: '#e8913a', sub: '#b98552', dash: '5 4' },
    };

    const values = new Map();
    let socket = null;
    let selected = '';
    let renderTimer = null;

    const $ = id => document.getElementById(id);
    const val = id => values.get(prefix + id);
    const dev = (id, key) => val(`devices.${id}.${key}`);

    function call(command, ...args) {
        return new Promise((resolve, reject) => {
            socket.emit(command, ...args, (error, result) =>
                error ? reject(new Error(String(error))) : resolve(result),
            );
        });
    }

    function topology() {
        try {
            const parsed = JSON.parse(String(val('topology.json') || ''));
            return parsed && Array.isArray(parsed.nodes) ? parsed : null;
        } catch {
            return null;
        }
    }

    function uptimeText(sec) {
        if (typeof sec !== 'number' || sec < 0) {
            return '–';
        }
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        return d ? t.days(d, h) : t.hours(h);
    }

    function nodeName(n) {
        if (n.virtual) {
            // own name from the instance settings (e.g. "Powerline"), else a neutral one
            return n.name || t.notUnifi;
        }
        // switch cards without "Switch" in the name, the second line says it
        return n.role === 'switch' ? String(n.name).replace(/^Switch\s+/i, '') || n.name : n.name;
    }

    function linkText(e) {
        if (!e) {
            return '';
        }
        if (e.type === 'wireless') {
            return e.signal != null ? `${t.mesh} · ${e.signal} dBm` : t.mesh;
        }
        const now = L.speedText(e.speed);
        const usual = L.speedText(dev(e.to, 'linkUsualSpeed'));
        return e.degraded && usual ? t.instead(now, usual) : now;
    }

    function renderHeader(topo) {
        const real = topo ? topo.nodes.filter(n => !n.virtual) : [];
        const off = real.filter(n => n.state === 'offline');
        const cons = real.filter(n => n.state === 'consequence');
        const slow = real.filter(n => n.state === 'degraded');
        const upd = real.filter(n => n.updatable);
        const state = val('summary.state');
        $('over').textContent = t.devices(real.length);
        let text = t.running;
        let color = '#6fe08a';
        let cls = '';
        if (!topo) {
            text = t.noData;
            color = '#7d7b75';
        } else if (state === 'stale') {
            text = t.stale;
            color = '#7d7b75';
        } else if (off.length) {
            text = t.failed(off.map(n => n.name).join(', '));
            color = '#e5484d';
            cls = 'alarm';
        } else if (slow.length) {
            text = t.slow;
            color = '#f2c14e';
            cls = 'slow';
        }
        $('h1').innerHTML =
            `<span class="led ${cls}" style="background:${color};box-shadow:0 0 8px ${color}"></span>${esc(text)}`;
        $('kOnline').className = `kpi${off.length ? ' bad' : ''}`;
        $('kOnline').innerHTML =
            `<div class="over">${esc(t.online)}</div><div class="v">${real.length - off.length - cons.length}<small> / ${real.length}</small></div>`;
        $('kSlow').className = `kpi${slow.length ? ' warn' : ''}`;
        $('kSlow').innerHTML = `<div class="over">${esc(t.slowK)}</div><div class="v">${slow.length}</div>`;
        $('kUpdates').className = `kpi${upd.length ? ' warn' : ''}`;
        $('kUpdates').innerHTML = `<div class="over">${esc(t.updates)}</div><div class="v">${upd.length}</div>`;
        document.body.classList.toggle('stale', state === 'stale');
    }

    function renderMap(topo) {
        const map = $('map');
        if (!topo || !topo.nodes.length) {
            map.innerHTML = '';
            return;
        }
        const { pos, width, height } = L.layout(topo);
        const byId = new Map(topo.nodes.map(n => [n.id, n]));
        let lines = '';
        let chips = '';
        let cards = '';
        for (const e of topo.edges || []) {
            const a = pos[e.from];
            const b = pos[e.to];
            const child = byId.get(e.to);
            const parent = byId.get(e.from);
            if (!a || !b || !child) {
                continue;
            }
            // the cable into the section is a normal cable; only the way through it (e.g. powerline) is orange
            const viaSegment = !!(parent && parent.virtual);
            let color = '#8c8a83';
            let dash = '';
            let cap = 'butt';
            if (child.state === 'offline') {
                color = '#e5484d';
            } else if (child.state === 'consequence') {
                color = '#7d7b75';
                dash = '5 4';
            } else if (e.degraded) {
                color = '#f2c14e';
            } else if (e.type === 'wireless') {
                color = '#4aa3ff';
                dash = '7 6';
            } else if (viaSegment) {
                color = '#e8913a';
                dash = '2 5';
                cap = 'round';
            }
            const y1 = a.y + S.height / 2;
            const y2 = b.y - S.height / 2;
            const my = (y1 + y2) / 2;
            lines += `<path d="M${a.x} ${y1} C${a.x} ${my + 6} ${b.x} ${my - 6} ${b.x} ${y2}" stroke="${color}" stroke-width="2.4" fill="none" stroke-dasharray="${dash}" stroke-linecap="${cap}"/>`;
            let text = child.virtual ? '' : linkText(e);
            if (e.port != null) {
                text = text ? `${t.port(e.port)} · ${text}` : t.port(e.port);
            }
            if (text) {
                const warn = e.degraded && !['offline', 'consequence'].includes(child.state);
                const w = text.length * 5.7 + 16;
                const cy = y2 - 11;
                const fg = warn ? '#f2c14e' : '#a3a19a';
                const bd = warn ? '#f2c14e' : '#3d3d42';
                chips += `<rect x="${b.x - w / 2}" y="${cy - 9}" width="${w}" height="18" rx="9" fill="#2b2b2f" stroke="${bd}"/><text x="${b.x}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="${fg}">${esc(text)}</text>`;
            }
        }
        for (const n of topo.nodes) {
            const p = pos[n.id];
            if (!p) {
                continue;
            }
            const look = LOOK[n.virtual ? 'virtual' : n.state] || LOOK.ok;
            const x = p.x - S.width / 2;
            const y = p.y - S.height / 2;
            let sub = n.virtual
                ? n.name
                    ? t.notUnifiNamedSub
                    : t.notUnifiSub
                : n.role === 'switch'
                  ? 'Switch'
                  : n.model;
            const e = (topo.edges || []).find(edge => edge.to === n.id);
            if (n.state === 'degraded' && e && e.type !== 'wireless') {
                sub = linkText(e);
            } else if (n.state === 'offline') {
                sub = t.failedSub;
            } else if (n.state === 'consequence') {
                sub = t.notReachable;
            } else if (n.state === 'busy') {
                sub = t.updating;
            }
            const icon = ICON[n.virtual ? 'unknownSwitch' : n.role] || ICON.accessPoint;
            cards += `<g class="node${n.id === selected ? ' sel' : ''}" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(nodeName(n))}">`;
            cards += `<rect class="${n.state === 'offline' ? 'alarm' : ''}" x="${x}" y="${y}" width="${S.width}" height="${S.height}" rx="14" fill="${look.bg}" stroke="${look.bd}" stroke-width="1.5"${look.dash ? ` stroke-dasharray="${look.dash}"` : ''}/>`;
            cards += `<g transform="translate(${x + 11} ${p.y - 13}) scale(1.1)" fill="none" stroke="${look.fg}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${icon}"/></g>`;
            cards += `<text x="${x + 45}" y="${p.y - 2}" font-size="13.5" font-weight="600" fill="${look.fg}">${esc(clip(nodeName(n), 12))}</text>`;
            cards += `<text x="${x + 45}" y="${p.y + 13}" font-size="11" fill="${look.sub}">${esc(clip(sub, 17))}</text>`;
            if (look.led) {
                cards += `<circle class="${look.ledCls || ''}" cx="${x + S.width - 11}" cy="${y + 11}" r="4" fill="${look.led}" style="filter:drop-shadow(0 0 4px ${look.led})"/>`;
            }
            if (n.updatable) {
                cards += `<g class="upd"><rect x="${x + 6}" y="${y - 8}" width="44" height="15" rx="7.5" fill="#f2c14e"/><text x="${x + 28}" y="${y + 3}" text-anchor="middle" font-size="9.5" font-weight="700" letter-spacing=".04em" fill="#2a2108">UPDATE</text></g>`;
            }
            cards += '</g>';
        }
        // room above the top card for the UPDATE label and the chips
        map.setAttribute('viewBox', `0 -10 ${width} ${height + 10}`);
        map.innerHTML = lines + chips + cards;
    }

    function clip(text, max) {
        const s = String(text ?? '');
        return s.length > max ? `${s.slice(0, max - 1)}…` : s;
    }

    function renderDetail(topo) {
        const box = $('detail');
        const n = topo && topo.nodes.find(node => node.id === selected);
        if (!n) {
            box.classList.remove('show');
            return;
        }
        const byId = new Map(topo.nodes.map(node => [node.id, node]));
        const e = (topo.edges || []).find(edge => edge.to === n.id);
        const parent = n.uplinkId ? byId.get(n.uplinkId) : null;
        const stateText = {
            ok: t.stOk,
            degraded: t.stDegraded,
            offline: t.stOffline,
            consequence: t.stConsequence,
            busy: t.stBusy,
        }[n.state];
        const rows = [];
        const row = (label, value) => {
            if (value !== undefined && value !== null && value !== '') {
                rows.push(`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`);
            }
        };
        if (!n.virtual) {
            row(t.model, n.model);
            row(t.state, stateText);
        }
        if (parent) {
            row(t.connectedTo, e && e.port != null ? `${nodeName(parent)} · ${t.port(e.port)}` : nodeName(parent));
        }
        if (e && !n.virtual) {
            row(t.link, e.type === 'wireless' ? linkText(e) : `${t.cable} · ${linkText(e)}`);
        }
        if (!n.virtual) {
            row(t.uptime, n.state === 'offline' || n.state === 'consequence' ? '–' : uptimeText(dev(n.id, 'uptime')));
            row(t.firmware, dev(n.id, 'firmware'));
            row(t.clients, dev(n.id, 'clients'));
            row(t.ip, dev(n.id, 'ip'));
            row(t.restarts, dev(n.id, 'restartCount7d'));
        }
        let hint = '';
        if (n.updatable) {
            hint = `<div class="hint warn">${esc(t.updateHint)}</div>`;
        } else if (n.state === 'consequence' && n.causeId && byId.get(n.causeId)) {
            hint = `<div class="hint bad">${esc(t.causeHint(nodeName(byId.get(n.causeId))))}</div>`;
        }
        box.innerHTML = `<button class="close" aria-label="${esc(t.close)}">×</button><h2>${esc(n.virtual ? nodeName(n) : n.name)}</h2><div class="sub">${esc(n.virtual ? (n.name ? t.notUnifiNamedSub : t.notUnifiSub) : n.role === 'switch' ? 'Switch' : n.role === 'gateway' ? 'Gateway' : 'Access Point')}</div><dl>${rows.join('')}</dl>${hint}`;
        box.classList.add('show');
    }

    function renderBanner() {
        const banner = $('banner');
        let text = '';
        if (!socket || !socket.connected) {
            text = t.disconnected;
        } else if (val('summary.state') === 'stale') {
            text = t.staleBanner;
        } else if (val('info.connection') === false) {
            text = t.noConsole;
        }
        banner.textContent = text;
        banner.classList.toggle('show', !!text);
    }

    function render() {
        renderTimer = null;
        const topo = topology();
        renderHeader(topo);
        renderLegend(topo);
        renderMap(topo);
        renderDetail(topo);
        renderBanner();
    }

    function scheduleRender() {
        if (!renderTimer) {
            renderTimer = setTimeout(render, 150);
        }
    }

    function renderLegend(topo) {
        const named = topo && topo.nodes.find(n => n.virtual && n.name);
        $('legend').innerHTML =
            `<span><i style="border-top:2px solid #8c8a83"></i>${esc(t.cable)}</span>` +
            `<span><i style="border-top:2px dashed #4aa3ff"></i>${esc(t.mesh)}</span>` +
            `<span><i style="border-top:2px dotted #e8913a"></i>${esc(named ? named.name : t.segment)}</span>`;
    }

    function staticTexts() {
        $('mapTitle').textContent = t.map;
        $('mapHint').textContent = t.hint;
        renderLegend(null);
    }

    async function load() {
        try {
            try {
                const config = await call('getObject', 'system.config');
                const lang = config && config.common && config.common.language;
                if (lang && TEXT[lang]) {
                    t = TEXT[lang];
                }
            } catch {
                // language of the browser stays
            }
            staticTexts();
            const states = await call('getStates', `${prefix}*`);
            values.clear();
            for (const [id, state] of Object.entries(states || {})) {
                values.set(id, state ? state.val : null);
            }
            socket.emit('subscribe', `${prefix}*`);
        } catch (error) {
            console.warn(`Loading failed: ${error.message}`);
        }
        render();
    }

    function onStateChange(id, state) {
        if (typeof id !== 'string' || !id.startsWith(prefix)) {
            return;
        }
        values.set(id, state ? state.val : null);
        scheduleRender();
    }

    function select(id) {
        selected = selected === id ? '' : id;
        render();
    }

    $('map').addEventListener('click', ev => {
        const g = ev.target.closest('.node');
        select(g ? g.getAttribute('data-id') : '');
    });
    $('map').addEventListener('keydown', ev => {
        const g = ev.target.closest && ev.target.closest('.node');
        if (g && (ev.key === 'Enter' || ev.key === ' ')) {
            ev.preventDefault();
            select(g.getAttribute('data-id'));
        }
    });
    $('detail').addEventListener('click', ev => {
        if (ev.target.closest('.close')) {
            select('');
        }
    });
    document.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && selected) {
            select('');
        }
    });

    staticTexts();
    if (!window.io || typeof window.io.connect !== 'function') {
        $('banner').textContent = t.disconnected;
        $('banner').classList.add('show');
        return;
    }
    socket = window.io.connect('/', { name: 'unifi-map-tab' });
    socket.on('connect', load);
    socket.on('reconnect', load);
    socket.on('disconnect', renderBanner);
    socket.on('stateChange', onStateChange);
})();
