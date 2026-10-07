/**
 * Synapses 2.0 — model/dispositif.js
 * Contrat : ex. ULIS. Sens canonique = Dispositif.classeIds[] (le document
 * d'architecture §8 inverse le sens porté par config.classes[].dispositifs
 * en V1). Le Data Manager maintient le miroir classe -> dispositif pendant
 * la transition ; ce modèle, lui, n'expose que le sens canonique.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Dispositif extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "typeId"]);
      this.typeId = donnees.typeId;
      this.nom = donnees.nom || null;
      this.couleur = donnees.couleur || null;
      this.classeIds = donnees.classeIds || [];
      this.eleveIds = donnees.eleveIds || [];
      this.personnelIds = donnees.personnelIds || [];
    }

    static fromJSON(donnees) {
      return new Dispositif(donnees);
    }

    static depuisConfigV1(dispositifV1) {
      return new Dispositif({
        id: dispositifV1.id,
        typeId: dispositifV1.type || "ULIS",
        nom: dispositifV1.nom,
        couleur: dispositifV1.couleur
      });
    }

    rattacherClasse(classeId) {
      if (!this.classeIds.includes(classeId)) this.classeIds.push(classeId);
      return this;
    }
  }

  global.SynapsesModel.Dispositif = Dispositif;
})(typeof window !== "undefined" ? window : globalThis);
