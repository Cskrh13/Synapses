/**
 * Synapses 2.0 — core/affectation-seance-manager.js
 * ============================================================================
 * Registre « créneau de classe ↔ séance de la banque » (clé localStorage
 * synapses_planning_affectations). Portage fidèle de chargerAffectations /
 * sauverAffectations (planning-core.js) et de l'affectation manuelle faite
 * depuis planning-affichage.html.
 *
 * À NE PAS CONFONDRE avec AffectationManager (affectation-manager.js), qui
 * résout où se trouve un ÉLÈVE sur un créneau (pec / classe / dispositif) :
 * ici il n'est question d'aucun élève, seulement de « quelle séance est
 * posée sur ce créneau de cette classe, ce jour-là ». Donnée publique,
 * sans identité ni identifiant élève.
 *
 * Structure conservée à l'identique (les autres pages V1 lisent la même clé) :
 *   { [classeId]: { "<date ISO>__<creneauId>": {
 *       seanceId, source, fichier, domaineCle, manuel? } } }
 *
 * Dépendances : core/adapters/local-adapter.js, core/cahier-journal-manager.js
 * (cleCreneau).
 */
(function (global) {
  "use strict";

  const CLE_PAR_DEFAUT = "synapses_planning_affectations";

  class AffectationSeanceManager {
    /** @param {object} [options] @param {LocalAdapter} [options.localAdapter] */
    constructor(options) {
      options = options || {};
      const { LocalAdapter } = global.SynapsesCore;
      this.local = options.localAdapter || new LocalAdapter();
      this.cle = (this.local.cles && this.local.cles.affectations) || CLE_PAR_DEFAUT;
      this._donnees = {};
    }

    static cleCreneau(iso, creneauId) {
      return global.SynapsesCore.CahierJournalManager.cleCreneau(iso, creneauId);
    }

    /** (Re)lit le registre depuis le stockage local et le retourne. */
    charger() {
      this._donnees = this.local.lire(this.cle, {}) || {};
      return this._donnees;
    }

    sauver() {
      return this.local.ecrire(this.cle, this._donnees);
    }

    /** Remplace tout le registre (import d'un planning .synapses) et sauvegarde. */
    remplacer(affectations) {
      this._donnees = affectations || {};
      return this.sauver();
    }

    /** Affectation posée sur ce créneau de classe ce jour-là, ou null. */
    pour(classeId, iso, creneauId) {
      const parClasse = this._donnees[classeId] || {};
      return parClasse[AffectationSeanceManager.cleCreneau(iso, creneauId)] || null;
    }

    /**
     * Pose une séance choisie à la main sur un créneau (flag manuel:true,
     * jamais réécrasée par une répartition automatique) et sauvegarde.
     * @param {object} item - item de la banque (id, source, fichier)
     */
    affecterManuellement(classeId, iso, creneauId, item, domaineCle) {
      this._donnees[classeId] = this._donnees[classeId] || {};
      this._donnees[classeId][AffectationSeanceManager.cleCreneau(iso, creneauId)] = {
        seanceId: item.id,
        source: item.source,
        fichier: item.fichier || null,
        domaineCle: domaineCle,
        manuel: true
      };
      return this.sauver();
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.AffectationSeanceManager = AffectationSeanceManager;
})(typeof window !== "undefined" ? window : globalThis);
