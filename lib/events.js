'use strict';

const { EventEmitter } = require('node:events');

/**
 * Zentraler Event-Bus des Adapters.
 * Ereignistypen: cardCreated | cardUpdated | cardMoved | cardAssigned | cardDone | cardDeleted | cardDue
 * Jedes Event hat die Form:
 *   { event, ts, board: {id, title}, card: {...}, detail: {...} }
 * Zusätzlich zum typspezifischen Event wird immer 'event' emittiert (für den Dispatcher).
 */
class EventBus extends EventEmitter {
    emitEvent(type, data) {
        const event = Object.assign({ event: type, ts: new Date().toISOString() }, data);
        this.emit(type, event);
        this.emit('event', event);
        return event;
    }
}

module.exports = { EventBus };
