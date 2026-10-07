/**
 * Synapses 2.0 — model/espace.js
 * Contrat : objet nouveau en V2 (n'existait pas en V1 — les lieux étaient
 * du texte libre `classeNom`/`typeLieu`). Permet la détection future de
 * conflits de salle (§9, §24 du document d'architecture).
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Espace extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "nom", "typeId"]);
      this.nom = donnees.nom;
      this.typeId = donnees.typeId;
      this.capacite = typeof donnees.capacite === "number" ? donnees.capacite : null;
    }

    static fromJSON(donnees) {
      return new Espace(donnees);
    }

    accueillePersonnes(nombre) {
      return this.capacite === null || nombre <= this.capacite;
    }
  }

  global.SynapsesModel.Espace = Espace;
})(typeof window !== "undefined" ? window : globalThis);
