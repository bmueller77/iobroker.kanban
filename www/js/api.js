// REST-Wrapper + WebSocket mit Reconnect und Polling-Fallback

// Schreib-Token: vom Server in index.html injiziert (<meta name="kanban-token">).
const WRITE_TOKEN = (document.querySelector('meta[name="kanban-token"]') || {}).content || '';

export async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
    }
    if (init.method !== 'GET' && WRITE_TOKEN) init.headers['X-Kanban-Token'] = WRITE_TOKEN;
    const res = await fetch(path, init);
    if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).error || msg; } catch { /* leer */ }
        throw new Error(msg);
    }
    return res.json();
}

/**
 * Live-Sync: WebSocket auf /ws; bei 'dirty' wird onDirty(boardId, rev) gerufen.
 * Fällt der WS aus, greift alle 10 s ein Polling-Callback (onPoll).
 */
export function liveSync(onDirty, onPoll) {
    let ws = null;
    let retryMs = 1000;
    let alive = false;

    function connect() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        try {
            ws = new WebSocket(`${proto}//${location.host}/ws`);
        } catch {
            scheduleReconnect();
            return;
        }
        ws.onopen = () => { alive = true; retryMs = 1000; };
        ws.onmessage = ev => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'dirty') onDirty(msg.boardId, msg.rev);
            } catch { /* ignorieren */ }
        };
        ws.onclose = () => { alive = false; scheduleReconnect(); };
        ws.onerror = () => { try { ws.close(); } catch { /* leer */ } };
    }

    function scheduleReconnect() {
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15000);
    }

    connect();

    setInterval(() => {
        if (!alive && !document.hidden) onPoll();
    }, 10000);
}
