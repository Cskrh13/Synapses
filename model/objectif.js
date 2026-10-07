/**
 * Synapses 2.0 — model/objectif.js
 * Contrat : objectif général, de séquence, de séance, ou individualisé.
 * Un objectif individualisé (issu du Coffre) reste protégé même s'il
 * transite par cette classe : c'est l'appelant (CoffreAdapter) qui garantit
 * qu'il n'est jamais exposé hors contexte protégé.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Objectif extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "libelle"]);
      this.libelle = donnees.libelle;
      this.portee = donnees.portee || "general"; // general | sequence | seance | individuel
      this.competenceIds = donnees.competenceIds || [];
    }

    static fromJSON(donnees) {
      return new Objectif(donnees);
    }

    estIndividuel() {
      return this.portee === "individuel";
    }
  }

  class Production extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "typeId"]);
      this.typeId = donnees.typeId;
      this.format = donnees.format || "document";
      this.description = donnees.description || "";
    }

    static fromJSON(donnees) {
      return new Production(donnees);
    }
  }

  global.SynapsesModel.Objectif = Objectif;
  global.SynapsesModel.Production = Production;
})(typeof window !== "undefined" ? window : globalThis);
