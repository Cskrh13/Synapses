/**
 * Synapses 2.0 — model/creneau.js
 * Contrat : unité temporelle exploitable par le Planning, récurrente ou datée.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Creneau extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "jour", "debut", "fin"]);
      this.jour = donnees.jour;
      this.debut = donnees.debut;
      this.fin = donnees.fin;
      this.espaceId = donnees.espaceId || null;
    }

    static fromJSON(donnees) {
      return new Creneau(donnees);
    }

    chevauche(autreCreneau) {
      if (this.jour !== autreCreneau.jour) return false;
      return this.debut < autreCreneau.fin && autreCreneau.debut < this.fin;
    }
  }

  global.SynapsesModel.Creneau = Creneau;
})(typeof window !== "undefined" ? window : globalThis);
