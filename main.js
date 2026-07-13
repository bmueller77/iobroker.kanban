'use strict';

const utils = require('@iobroker/adapter-core');
const os = require('node:os');
const { EventBus } = require('./lib/events');
const { Store } = require('./lib/store');
const holidays = require('./lib/holidays');
const { Notifier } = require('./lib/notify');
const { Scheduler } = require('./lib/scheduler');
const { Server } = require('./lib/server');

class Kanban extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'kanban' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync('info.connection', false, true);

        this.bus = new EventBus();
        this.store = new Store(this, this.bus);
        this.notifier = new Notifier(this, () => this._baseUrl(), () => this._timezone);
        this.notifier.attach(this.bus);
        this.scheduler = new Scheduler(this, this.store, this.bus);
        this.webServer = new Server(this, this.store, (cmd, payload, source) => this.handleCommand(cmd, payload, source));

        // Meta-Objekt für den Dateispeicher (Benutzer-Avatare)
        await this.setForeignObjectNotExistsAsync(this.namespace, {
            type: 'meta',
            common: { name: 'Kanban files (avatars)', type: 'meta.user' },
            native: {},
        });

        await this.store.load();
        await this._resolveLanguage();
        await this._resolveTimezone();
        await this._initHolidays();
        await this._initApiSecret();

        try {
            this._port = await this.webServer.start();
            await this.setStateAsync('info.connection', true, true);
        } catch (e) {
            this.log.error(`Webserver konnte nicht starten: ${e.message}`);
            return;
        }

        this.scheduler.start();
        await this.subscribeStatesAsync('action');
        this.log.info(`Kanban bereit — UI: ${this._baseUrl()}/`);
    }

    /** Sprache ermitteln: Instanz-Einstellung `language` (leer/'auto' = System),
     *  sonst ioBroker-Systemsprache, sonst Englisch. */
    async _resolveLanguage() {
        let lang = String(this.config.language || '').toLowerCase();
        if (!lang || lang === 'auto') {
            try {
                const sys = await this.getForeignObjectAsync('system.config');
                lang = (sys && sys.common && sys.common.language) || 'en';
            } catch (e) { lang = 'en'; }
        }
        this._language = lang || 'en';
        this.log.info(`Sprache / language: ${this._language}`);
    }

    /** Zeitzone ermitteln (für Kalender-Anhänge). ioBroker führt keine eigene
     *  Zeitzone → System-Zeitzone des Prozesses; falls ioBroker künftig eine
     *  in system.config.common pflegt, hat diese Vorrang. */
    async _resolveTimezone() {
        let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        try {
            const sys = await this.getForeignObjectAsync('system.config');
            const cfgTz = sys && sys.common && (sys.common.timezone || sys.common.tz);
            if (cfgTz) tz = cfgTz;
        } catch (e) { /* System-Zeitzone genügt */ }
        this._timezone = tz || 'Europe/Berlin';
        this.log.info(`Zeitzone: ${this._timezone}`);
    }

    /** Feiertage für die Arbeitstag-Wiederholungen einrichten. Nutzt – falls
     *  installiert – die Bundesland-Konfiguration des feiertage-Adapters,
     *  sonst die bundesweit einheitlichen gesetzlichen Feiertage. */
    async _initHolidays() {
        let native = null;
        try {
            const obj = await this.getForeignObjectAsync('system.adapter.feiertage.0');
            if (obj && obj.native) native = obj.native;
        } catch (e) { /* Adapter nicht vorhanden -> Default */ }
        const info = holidays.configure(native);
        this.log.info(`Feiertage: Quelle ${info.source}, ${info.count} relevante Feiertage/Jahr`);
    }

    /** Secret für den Schreibschutz der /api-Routen. Einmalig erzeugt und im State
     *  info.apiSecret abgelegt (kein Neustart-Loop wie bei native-Änderungen). Wird in
     *  index.html als <meta name="kanban-token"> an die eigene SPA ausgeliefert. */
    async _initApiSecret() {
        try {
            await this.setObjectNotExistsAsync('info.apiSecret', {
                type: 'state',
                common: { name: 'API write secret', type: 'string', role: 'text', read: true, write: false },
                native: {},
            });
            const st = await this.getStateAsync('info.apiSecret');
            if (st && st.val) { this._apiSecret = String(st.val); return; }
            this._apiSecret = require('node:crypto').randomBytes(24).toString('hex');
            await this.setStateAsync('info.apiSecret', this._apiSecret, true);
        } catch (e) {
            this._apiSecret = require('node:crypto').randomBytes(24).toString('hex');
            this.log.warn(`API-Secret nicht persistierbar, nutze flüchtiges: ${e.message}`);
        }
    }

    _baseUrl() {
        const cfg = this.config;
        if (cfg.publicUrl) return String(cfg.publicUrl).replace(/\/+$/, '');
        let ip = '127.0.0.1';
        for (const ifaces of Object.values(os.networkInterfaces())) {
            for (const iface of ifaces || []) {
                if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; break; }
            }
            if (ip !== '127.0.0.1') break;
        }
        return `http://${ip}:${this._port || cfg.port || 8095}`;
    }

    /**
     * Gemeinsamer Kommando-Kern — bedient REST (indirekt), eingehende Webhooks,
     * sendTo('kanban.0', <cmd>, {...}) und den action-State.
     */
    async handleCommand(cmd, payload, source) {
        payload = payload || {};
        const boardId = payload.board || payload.boardId;
        const cardId = payload.cardId || payload.id;
        switch (cmd) {
            case 'listBoards':
            case 'getBoards':
                return this.store.listBoards();
            case 'getBoard':
                return this.store.getBoard(boardId);
            case 'addBoard':
                return this.store.createBoard({ id: payload.id, title: payload.title });
            case 'deleteBoard':
                await this.store.deleteBoard(boardId);
                return { ok: true };
            case 'addCard':
                return this.store.addCard(boardId, payload, source);
            case 'updateCard':
            case 'editCard':
                return this.store.updateCard(boardId, cardId, payload, source);
            case 'moveCard':
                return this.store.moveCard(boardId, cardId, payload.column || payload.columnId, payload.order, source);
            case 'doneCard': {
                const board = this.store.getBoard(boardId);
                if (!board) throw new Error(`Board '${boardId}' existiert nicht`);
                const doneCol = board.columns.find(c => c.isDone);
                if (!doneCol) throw new Error(`Board '${boardId}' hat keine Erledigt-Spalte`);
                return this.store.moveCard(boardId, cardId, doneCol.id, undefined, source);
            }
            case 'deleteCard':
                return this.store.deleteCard(boardId, cardId, source);
            default:
                throw new Error(`Unbekanntes Kommando '${cmd}'`);
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack || !state.val) return;
        if (id !== `${this.namespace}.action`) return;
        let parsed;
        try {
            parsed = JSON.parse(state.val);
        } catch (e) {
            this.log.warn(`action-State enthält kein gültiges JSON: ${e.message}`);
            await this.setStateAsync('action', '', true);
            return;
        }
        try {
            await this.handleCommand(parsed.cmd, parsed, 'action-state');
            this.log.debug(`action-Kommando '${parsed.cmd}' ausgeführt`);
        } catch (e) {
            this.log.warn(`action-Kommando fehlgeschlagen: ${e.message}`);
        }
        await this.setStateAsync('action', '', true);
    }

    async onMessage(obj) {
        if (!obj || !obj.command) return;

        // Admin-Button „Token generieren": hängt einen neuen Zufallstoken an die
        // aktuelle Tokens-Tabelle an und gibt sie zurück (Admin schreibt sie ins Feld).
        if (obj.command === 'generateToken') {
            const native = obj.message || {};
            const tokens = Array.isArray(native.inboundTokens) ? native.inboundTokens.slice() : [];
            const token = require('node:crypto').randomBytes(16).toString('hex');
            let name = 'agent';
            for (let i = 1; tokens.some(t => t && t.name === name); i++) name = `agent${i}`;
            tokens.push({ name, token, allowedBoards: '*', enabled: true });
            if (obj.callback) this.sendTo(obj.from, obj.command, { inboundTokens: tokens }, obj.callback);
            return;
        }

        let result;
        let error;
        try {
            result = await this.handleCommand(obj.command, obj.message || {}, `sendTo:${obj.from || ''}`);
        } catch (e) {
            error = e.message;
        }
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, error ? { error } : result, obj.callback);
        }
    }

    async onUnload(callback) {
        try {
            if (this.scheduler) this.scheduler.stop();
            if (this.webServer) await this.webServer.stop();
            if (this.store) await this.store.flush();
            await this.setStateAsync('info.connection', false, true);
        } catch (e) {
            // ignorieren — wir fahren ohnehin herunter
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new Kanban(options);
} else {
    new Kanban();
}
