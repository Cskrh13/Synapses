/**
 * Synapses 2.0 — core/adapters/journal-adapter.js
 * ============================================================================
 * Accès au cahier journal (clé localStorage "synapses_planning_journal").
 *
 * Le journal reste 100 % local : il ne contient AUCUNE identité d'élève,
 * seulement des identifiants Synapses (ELEVE-xxxx). Il relève donc du
 * domaine public, d'où sa place ici et non dans le CoffreAdapter.
 *
 * Portage fidèle de chargerJournal / sauverJournal / journalPourDate de
 * planning-core.js, rétro-compatibilité incluse (ancien format imbriqué
 * creneaux[].groupes[]).
 *
 * Dépendance : core/adapters/local-adapter.js
 */
(function (global) {
  "use strict";

  const CLE_JOURNAL = "synapses_planning_journal";

  class JournalAdapter {
    constructor(localAdapter) {
      const { LocalAdapter } = global.SynapsesCore;
      this.local = localAdapter || new LocalAdapter();
      this.cle = (this.local.cles && this.local.cles.journal) || CLE_JOURNAL;
    }

    charger() {
      return this.local.lire(this.cle, {}) || {};
    }

    sauver(journal) {
      return this.local.ecrire(this.cle, journal);
    }

    /**
     * Retourne (en la créant / normalisant au besoin) la journée du journal
     * correspondant à une date ISO. Mute l'objet `journal` passé, comme en V1.
     */
    pourDate(iso, journal) {
      journal = journal || this.charger();

      if (!journal[iso]) {
        journal[iso] = {
          date: iso, remarque: "", devoirs: "",
          libellesBlocs: {}, exclusions: [], groupes: []
        };
      }

      // Rétro-compatibilité avec l'ancien format imbriqué.
      if (journal[iso].creneaux && !journal[iso].groupes) {
        const plat = [];
        journal[iso].creneaux.forEach(bloc => {
          (bloc.groupes || []).forEach(g => {
            plat.push(Object.assign(
              { debut: bloc.debut, fin: bloc.fin, origine: null, modifie: false }, g
            ));
          });
        });
        journal[iso] = {
          date: iso,
          remarque: journal[iso].remarque || "",
          devoirs: journal[iso].devoirs || "",
          libellesBlocs: {},
          exclusions: [],
          groupes: plat
        };
      }

      journal[iso].libellesBlocs = journal[iso].libellesBlocs || {};
      journal[iso].exclusions = journal[iso].exclusions || [];
      journal[iso].groupes = journal[iso].groupes || [];
      return journal[iso];
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.JournalAdapter = JournalAdapter;
})(typeof window !== "undefined" ? window : globalThis);
