'use strict';

// Serverseitige Übersetzungen: Default-Spaltennamen (bei Board-Erstellung) und
// E-Mail-Texte. Klein gehalten; Englisch ist Fallback für fehlende Sprachen.

const STRINGS = {
    en: {
        'col.todo': 'To do', 'col.doing': 'In progress', 'col.done': 'Done',
        'ev.cardCreated': 'New card', 'ev.cardUpdated': 'Card changed', 'ev.cardMoved': 'Card moved',
        'ev.cardAssigned': 'Card assigned', 'ev.cardDone': 'Card done', 'ev.cardDeleted': 'Card deleted',
        'ev.cardDue': 'Card due',
        'mail.board': 'Board', 'mail.moved': 'Moved', 'mail.due': 'Due', 'mail.assignees': 'Assignees',
        'mail.by': 'By', 'mail.description': 'Description', 'mail.openCard': 'Open card in board',
        'mail.subjectPrefix': '[Kanban]',
    },
    de: {
        'col.todo': 'Zu erledigen', 'col.doing': 'In Arbeit', 'col.done': 'Erledigt',
        'ev.cardCreated': 'Neue Karte', 'ev.cardUpdated': 'Karte geändert', 'ev.cardMoved': 'Karte verschoben',
        'ev.cardAssigned': 'Karte zugewiesen', 'ev.cardDone': 'Karte erledigt', 'ev.cardDeleted': 'Karte gelöscht',
        'ev.cardDue': 'Karte fällig',
        'mail.board': 'Board', 'mail.moved': 'Verschoben', 'mail.due': 'Fällig', 'mail.assignees': 'Zuständig',
        'mail.by': 'Durch', 'mail.description': 'Beschreibung', 'mail.openCard': 'Karte im Board öffnen',
        'mail.subjectPrefix': '[Kanban]',
    },
    fr: {
        'col.todo': 'À faire', 'col.doing': 'En cours', 'col.done': 'Terminé',
        'ev.cardCreated': 'Nouvelle carte', 'ev.cardUpdated': 'Carte modifiée', 'ev.cardMoved': 'Carte déplacée',
        'ev.cardAssigned': 'Carte assignée', 'ev.cardDone': 'Carte terminée', 'ev.cardDeleted': 'Carte supprimée',
        'ev.cardDue': 'Carte à échéance',
        'mail.board': 'Tableau', 'mail.moved': 'Déplacée', 'mail.due': 'Échéance', 'mail.assignees': 'Assignés',
        'mail.by': 'Par', 'mail.description': 'Description', 'mail.openCard': 'Ouvrir la carte dans le tableau',
        'mail.subjectPrefix': '[Kanban]',
    },
    nl: {
        'col.todo': 'Te doen', 'col.doing': 'Bezig', 'col.done': 'Voltooid',
        'ev.cardCreated': 'Nieuwe kaart', 'ev.cardUpdated': 'Kaart gewijzigd', 'ev.cardMoved': 'Kaart verplaatst',
        'ev.cardAssigned': 'Kaart toegewezen', 'ev.cardDone': 'Kaart voltooid', 'ev.cardDeleted': 'Kaart verwijderd',
        'ev.cardDue': 'Kaart vervalt',
        'mail.board': 'Bord', 'mail.moved': 'Verplaatst', 'mail.due': 'Vervaldatum', 'mail.assignees': 'Toegewezen aan',
        'mail.by': 'Door', 'mail.description': 'Beschrijving', 'mail.openCard': 'Kaart in bord openen',
        'mail.subjectPrefix': '[Kanban]',
    },
    it: {
        'col.todo': 'Da fare', 'col.doing': 'In corso', 'col.done': 'Completato',
        'ev.cardCreated': 'Nuova scheda', 'ev.cardUpdated': 'Scheda modificata', 'ev.cardMoved': 'Scheda spostata',
        'ev.cardAssigned': 'Scheda assegnata', 'ev.cardDone': 'Scheda completata', 'ev.cardDeleted': 'Scheda eliminata',
        'ev.cardDue': 'Scheda in scadenza',
        'mail.board': 'Bacheca', 'mail.moved': 'Spostata', 'mail.due': 'Scadenza', 'mail.assignees': 'Assegnatari',
        'mail.by': 'Da', 'mail.description': 'Descrizione', 'mail.openCard': 'Apri la scheda nella bacheca',
        'mail.subjectPrefix': '[Kanban]',
    },
};

function serverT(lang, key) {
    const l = String(lang || 'en').toLowerCase();
    const dict = STRINGS[l] || STRINGS.en;
    return dict[key] != null ? dict[key] : (STRINGS.en[key] != null ? STRINGS.en[key] : key);
}

module.exports = { serverT, SERVER_LANGS: Object.keys(STRINGS) };
