/**
 * Synapses 2.0 — model/classe.js
 * Contrat : classe de référence ou dispositif organisationnel.
 * Compat V1 : `couleur` conservée comme extension métier (config.classes[]).
 * Migration : `niveau` texte -> `niveauId` résolu via le Data Manager
 * (Resolveur.niveauIdDepuisTexte), jamais devinée ici dans le modèle.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Classe extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "nom", "niveauId"]);
      this.nom = donnees.nom;
      this.niveauId = donnees.niveauId;
      this.couleur = donnees.couleur || null;
      this.eleveIds = donnees.eleveIds || [];
      this.personnelIds = donnees.personnelIds || [];
      this.dispositifIds = donnees.dispositifIds || [];
      this.planningId = donnees.planningId || null;
    }

    static fromJSON(donnees) {
      return new Classe(donnees);
    }

    /** Compat V1 : construit une Classe depuis config.classes[] (niveau texte). */
    static depuisConfigV1(classeV1, niveauId) {
      return new Classe({
        id: classeV1.id,
        nom: classeV1.nom || classeV1.niveau || "Classe",
        niveauId: niveauId || classeV1.niveau || "INCONNU",
        couleur: classeV1.couleur,
        dispositifIds: classeV1.dispositifs || []
      });
    }

    ajouterEleve(eleveId) {
      if (!this.eleveIds.includes(eleveId)) this.eleveIds.push(eleveId);
      return this;
    }

    retirerEleve(eleveId) {
      this.eleveIds = this.eleveIds.filter(id => id !== eleveId);
      return this;
    }
  }

  global.SynapsesModel.Classe = Classe;
})(typeof window !== "undefined" ? window : globalThis);
