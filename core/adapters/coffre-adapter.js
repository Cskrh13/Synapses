/**
 * Synapses 2.0 — core/adapters/coffre-adapter.js
 * Pont vers l'instance du Coffre (synapses-coffre.js), qui N'EST PAS
 * réécrit — cf. §7 du document d'architecture : "ne pas réinventer le
 * fonctionnement cryptographique". Ce fichier stabilise uniquement le
 * contrat d'accès conceptuel (Coffre.getEleve, Coffre.getBesoins...).
 *
 * Couvre aussi, provisoirement, deux domaines encore stockés en
 * localStorage en clair mais nominatifs par construction (identifiants
 * élève -> créneau) : affectationsEleves et exclusionsCreneau. Ils
 * resteront lisibles via ce même adapter le jour où ils basculeront
 * physiquement dans .synapses (étape 6) — l'appelant n'aura rien à changer.
 */
(function (global) {
  "use strict";

  class CoffreAdapter {
    constructor(localAdapter, cles) {
      this._local = localAdapter;
      this.cles = Object.assign({
        affectationsEleves: "synapses_planning_affectations_eleves",
        exclusionsCreneau: "synapses_planning_exclusions_creneau"
      }, cles || {});
    }

    _instance() {
      const coffre = global.SynapsesCoffre && global.SynapsesCoffre.instance;
      if (!coffre || typeof coffre.getEleve !== "function") {
        throw new Error(
          "[CoffreAdapter] Le Coffre n'est pas ouvert (mot de passe requis) : " +
          "aucune donnée élève n'est accessible tant qu'il n'est pas déverrouillé."
        );
      }
      return coffre;
    }

    listerEleves() {
      return this._instance().listerEleves();
    }

    getEleve(identifiantSynapses) {
      return this._instance().getEleve(identifiantSynapses);
    }

    getBesoins(identifiantSynapses) {
      const eleve = this.getEleve(identifiantSynapses);
      return eleve ? eleve.besoins : [];
    }

    getObjectifs(identifiantSynapses) {
      const eleve = this.getEleve(identifiantSynapses);
      return eleve ? eleve.objectifs : [];
    }

    getAdaptations(identifiantSynapses) {
      const eleve = this.getEleve(identifiantSynapses);
      return eleve ? eleve.adaptations : [];
    }

    getPlanningEleve(identifiantSynapses) {
      return this._instance().listerAffectationsCreneaux(identifiantSynapses);
    }

    // -- Personnels (enseignants, AESH, ...) — mêmes garanties que les
    // élèves : listerPersonnels() ne renvoie jamais de nom, seul
    // getPersonnel() le fait (réservé aux écrans du Coffre, jamais
    // transmis au DataManager public ni au planning). -------------------

    listerPersonnels() {
      return this._instance().listerPersonnels();
    }

    /** Fiche complète, avec nom — à ne consommer que côté coffre.html. */
    getPersonnel(identifiantPersonnel) {
      return this._instance().getPersonnel(identifiantPersonnel);
    }

    // -- Domaines nominatifs encore en localStorage (voir en-tête) --------
    affectationsEleves() {
      return this._local.lire(this.cles.affectationsEleves, {});
    }

    exclusionsCreneau() {
      return this._local.lire(this.cles.exclusionsCreneau, {});
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.CoffreAdapter = CoffreAdapter;
})(typeof window !== "undefined" ? window : globalThis);
