'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

/**
 * HTTP-Server des Adapters: statisches Frontend (www/), REST-API (/api),
 * eingehende Webhooks (/webhook/:token) und WebSocket (/ws) für Live-Sync.
 * Bewusst KEINE Frame-/CSP-Header, damit die iframe-Einbindung (Lovelace) frei ist.
 */
class Server {
    /**
     * @param adapter ioBroker-Adapter
     * @param store Store aus store.js
     * @param handleCommand (cmd, payload, source) => Promise<any> — gemeinsamer Kommando-Kern
     */
    constructor(adapter, store, handleCommand) {
        this.adapter = adapter;
        this.store = store;
        this.handleCommand = handleCommand;
        this.server = null;
        this.wss = null;
    }

    async start() {
        const cfg = this.adapter.config;
        const app = express();
        app.use(express.json({ limit: '1mb' }));
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kanban-Token');
            if (req.method === 'OPTIONS') return res.sendStatus(204);
            next();
        });

        // Board-UI mit eingebettetem Schreib-Token ausliefern (CSP-konform via <meta>, kein Inline-Script)
        const indexHtml = path.join(__dirname, '..', 'www', 'index.html');
        app.get(['/', '/index.html'], (req, res) => {
            fs.readFile(indexHtml, 'utf8', (err, html) => {
                if (err) return res.status(500).end();
                const meta = `<meta name="kanban-token" content="${this.adapter._apiSecret || ''}">`;
                res.type('html').set('Cache-Control', 'no-cache').send(html.replace('</head>', `${meta}\n</head>`));
            });
        });

        // Schreibende /api-Zugriffe brauchen einen Token (Lesen bleibt offen).
        app.use('/api', (req, res, next) => this._guardApiWrite(req, res, next));

        this._apiRoutes(app);
        this._webhookRoutes(app);

        app.use('/', express.static(path.join(__dirname, '..', 'www'), {
            setHeaders: (res, filePath) => {
                // SPA-Assets immer revalidieren → keine veralteten HTML/JS-Mischzustände
                if (/\.(html|js|mjs|json|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
            },
        }));

        this.server = http.createServer(app);
        this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
        this.wss.on('connection', ws => {
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });
            ws.on('error', () => {});
        });
        this._pingInterval = setInterval(() => {
            for (const ws of this.wss.clients) {
                if (!ws.isAlive) { ws.terminate(); continue; }
                ws.isAlive = false;
                ws.ping();
            }
        }, 30 * 1000);

        // Store-Änderungen an alle offenen Ansichten broadcasten
        this.store.onChange = (boardId, rev) => this.broadcast({ type: 'dirty', boardId, rev });

        const port = await this.adapter.getPortAsync(cfg.port || 8095);
        if (port !== (cfg.port || 8095)) {
            this.adapter.log.error(`Port ${cfg.port} ist belegt — verwende freien Port ${port}`);
        }
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(port, cfg.bind || '0.0.0.0', () => resolve());
        });
        this.adapter.log.info(`Webserver läuft auf ${cfg.bind || '0.0.0.0'}:${port}`);
        return port;
    }

    broadcast(msg) {
        if (!this.wss) return;
        const data = JSON.stringify(msg);
        for (const ws of this.wss.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
    }

    async stop() {
        if (this._pingInterval) clearInterval(this._pingInterval);
        if (this.wss) {
            for (const ws of this.wss.clients) ws.terminate();
            this.wss.close();
        }
        if (this.server) {
            await new Promise(resolve => this.server.close(resolve));
        }
    }

    // ------------------------------------------------------------ REST-API

    /** Schreibzugriffe (POST/PATCH/DELETE) auf /api brauchen den SPA-Token
     *  (in index.html als <meta> injiziert) oder einen gültigen inboundToken.
     *  GET/HEAD/OPTIONS bleiben offen. Abschaltbar über native.apiWriteProtection=false. */
    _guardApiWrite(req, res, next) {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
        if (this.adapter.config.apiWriteProtection === false) return next();
        const tok = req.get('X-Kanban-Token') || (req.body && req.body._token) || req.query.token || '';
        if (tok && tok === this.adapter._apiSecret) return next();
        const entry = (this.adapter.config.inboundTokens || []).find(t => t && t.enabled !== false && t.token === tok);
        if (entry) return next();
        this.adapter.log.warn(`Schreibzugriff auf ${req.originalUrl} ohne gültigen Token von ${req.ip}`);
        return res.status(401).json({ error: 'write requires token' });
    }

    _apiRoutes(app) {
        const wrap = fn => (req, res) => {
            Promise.resolve(fn(req, res)).catch(e => {
                const code = /existiert nicht/.test(e.message) ? 404 : 400;
                res.status(code).json({ error: e.message });
            });
        };

        app.get('/api/config', wrap(async (req, res) => {
            const cfg = this.adapter.config;
            const users = await Promise.all((cfg.users || []).map(async u => ({
                name: u.name, displayName: u.displayName, color: u.color,
                avatar: await this._avatarExists(u.name),
            })));
            res.json({
                users,
                themeDefault: cfg.themeDefault || 'auto',
                accentColor: cfg.accentColor || '#7E57C2',
                language: this.adapter._language || 'en',
            });
        }));

        app.get('/api/custom.css', (req, res) => {
            res.type('text/css').send(this.adapter.config.customCss || '');
        });

        app.get('/api/users', wrap(async (req, res) => {
            const users = await Promise.all((this.adapter.config.users || []).map(async u => ({
                name: u.name, displayName: u.displayName, color: u.color,
                avatar: await this._avatarExists(u.name),
            })));
            res.json(users);
        }));

        // ---- Benutzer-Avatare (Bild-Upload; abgelegt im ioBroker-Dateispeicher) ----
        app.get('/avatars/:name', wrap(async (req, res) => {
            const name = String(req.params.name).replace(/[^a-z0-9_-]/gi, '');
            try {
                const data = await this.adapter.readFileAsync(this.adapter.namespace, `avatars/${name}.png`);
                const buf = data && data.file !== undefined ? data.file : data;
                res.type('image/png').set('Cache-Control', 'no-cache')
                    .send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
            } catch (e) {
                res.status(404).end();
            }
        }));

        app.post('/api/users/:name/avatar', wrap(async (req, res) => {
            const name = String(req.params.name);
            if (!(this.adapter.config.users || []).some(u => u.name === name)) {
                return res.status(404).json({ error: 'Benutzer unbekannt' });
            }
            const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec((req.body || {}).image || '');
            if (!m) return res.status(400).json({ error: 'Ungültiges Bild' });
            const buf = Buffer.from(m[2], 'base64');
            if (buf.length > 512 * 1024) return res.status(413).json({ error: 'Bild zu groß' });
            await this.adapter.writeFileAsync(this.adapter.namespace, `avatars/${name.replace(/[^a-z0-9_-]/gi, '')}.png`, buf);
            res.json({ ok: true });
        }));

        app.delete('/api/users/:name/avatar', wrap(async (req, res) => {
            const name = String(req.params.name).replace(/[^a-z0-9_-]/gi, '');
            try { await this.adapter.delFileAsync(this.adapter.namespace, `avatars/${name}.png`); } catch (e) { /* egal */ }
            res.json({ ok: true });
        }));

        app.get('/api/boards', (req, res) => res.json(this.store.listBoards()));

        app.post('/api/boards', wrap(async (req, res) => {
            const board = await this.store.createBoard(req.body || {});
            res.status(201).json(board);
        }));

        app.get('/api/boards/:id', wrap(async (req, res) => {
            const board = this.store.getBoard(req.params.id);
            if (!board) return res.status(404).json({ error: `Board '${req.params.id}' existiert nicht` });
            if (req.query.rev !== undefined && Number(req.query.rev) === board.rev) {
                return res.json({ unchanged: true, rev: board.rev });
            }
            res.json(board);
        }));

        app.patch('/api/boards/:id', wrap(async (req, res) => {
            res.json(this.store.updateBoard(req.params.id, req.body || {}));
        }));

        app.delete('/api/boards/:id', wrap(async (req, res) => {
            await this.store.deleteBoard(req.params.id);
            res.json({ ok: true });
        }));

        app.post('/api/boards/:id/cards', wrap(async (req, res) => {
            const card = this.store.addCard(req.params.id, req.body || {}, (req.body && req.body.by) || 'api');
            res.status(201).json(card);
        }));

        app.patch('/api/boards/:id/cards/:cardId', wrap(async (req, res) => {
            res.json(this.store.updateCard(req.params.id, req.params.cardId, req.body || {}, (req.body && req.body.by) || 'api'));
        }));

        app.post('/api/boards/:id/cards/:cardId/move', wrap(async (req, res) => {
            const { columnId, order, by } = req.body || {};
            res.json(this.store.moveCard(req.params.id, req.params.cardId, columnId, order, by || 'api'));
        }));

        app.delete('/api/boards/:id/cards/:cardId', wrap(async (req, res) => {
            res.json(this.store.deleteCard(req.params.id, req.params.cardId, 'api'));
        }));
    }

    // ------------------------------------------------------------ Eingehende Webhooks

    _checkToken(req) {
        const tokens = this.adapter.config.inboundTokens || [];
        const entry = tokens.find(t => t && t.enabled !== false && t.token === req.params.token);
        return entry || null;
    }

    _boardAllowed(entry, boardId) {
        const s = String(entry.allowedBoards || '*').trim();
        if (!s || s === '*') return true;
        return s.split(/[\s,;]+/).includes(boardId);
    }

    async _avatarExists(name) {
        const n = String(name).replace(/[^a-z0-9_-]/gi, '');
        try { return !!(await this.adapter.fileExistsAsync(this.adapter.namespace, `avatars/${n}.png`)); }
        catch (e) { return false; }
    }

    _webhookRoutes(app) {
        const router = express.Router({ mergeParams: true });

        router.use((req, res, next) => {
            const entry = this._checkToken(req);
            if (!entry) {
                this.adapter.log.warn(`Webhook mit ungültigem Token von ${req.ip}`);
                return res.status(401).json({ error: 'invalid token' });
            }
            req.tokenEntry = entry;
            next();
        });

        const wrap = fn => (req, res) => {
            Promise.resolve(fn(req, res)).catch(e => {
                const code = /existiert nicht/.test(e.message) ? 404 : 400;
                res.status(code).json({ error: e.message });
            });
        };

        const guardBoard = (req, res, boardId) => {
            if (!this._boardAllowed(req.tokenEntry, boardId)) {
                res.status(403).json({ error: `Token darf Board '${boardId}' nicht ändern` });
                return false;
            }
            return true;
        };

        router.post('/boards/:id/cards', wrap(async (req, res) => {
            if (!guardBoard(req, res, req.params.id)) return;
            const source = `webhook:${req.tokenEntry.name || 'token'}`;
            res.status(201).json(this.store.addCard(req.params.id, req.body || {}, source));
        }));

        const updateHandler = wrap(async (req, res) => {
            if (!guardBoard(req, res, req.params.id)) return;
            const source = `webhook:${req.tokenEntry.name || 'token'}`;
            res.json(this.store.updateCard(req.params.id, req.params.cardId, req.body || {}, source));
        });
        router.patch('/boards/:id/cards/:cardId', updateHandler);
        router.post('/boards/:id/cards/:cardId', updateHandler);

        router.post('/boards/:id/cards/:cardId/move', wrap(async (req, res) => {
            if (!guardBoard(req, res, req.params.id)) return;
            const { columnId, order } = req.body || {};
            const source = `webhook:${req.tokenEntry.name || 'token'}`;
            res.json(this.store.moveCard(req.params.id, req.params.cardId, columnId, order, source));
        }));

        // Generische Aktion: gleiches Kommando-Vokabular wie sendTo/action-State
        router.post('/action', wrap(async (req, res) => {
            const body = req.body || {};
            const boardId = body.board || body.boardId;
            if (boardId && !guardBoard(req, res, boardId)) return;
            const source = `webhook:${req.tokenEntry.name || 'token'}`;
            const result = await this.handleCommand(body.cmd, body, source);
            res.json(result === undefined ? { ok: true } : result);
        }));

        app.use('/webhook/:token', router);
    }
}

module.exports = { Server };
