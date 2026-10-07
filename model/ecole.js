/**
 * Synapses 2.0 — model/ecole.js
 * Contrat (étape 2/3) : contexte global d'un établissement.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Ecole extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "nom", "anneeScolaire"]);
      this.nom = donnees.nom;
      this.anneeScolaire = donnees.anneeScolaire;
      this.classeIds = donnees.classeIds || [];
      this.dispositifIds = donnees.dispositifIds || [];
      this.personnelIds = donnees.personnelIds || [];
      this.espaceIds = donnees.espaceIds || [];
      this.planningId = donnees.planningId || null;
    }

    static fromJSON(donnees) {
      return new Ecole(donnees);
    }

    ajouterClasse(classeId) {
      if (!this.classeIds.includes(classeId)) this.classeIds.push(classeId);
      return this;
    }
  }

  global.SynapsesModel.Ecole = Ecole;
})(typeof window !== "undefined" ? window : globalThis);
