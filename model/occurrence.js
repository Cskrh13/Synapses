/**
 * Synapses 2.0 — model/occurrence.js
 * Contrat : placement concret d'une séance (mardi, 10h00, salle ULIS...).
 *
 * ⚠️ DONNÉE PROTÉGÉE (décision actée, étape 3) : dès qu'une Occurrence porte
 * des eleveIds, elle est nominative et vit exclusivement dans .synapses
 * (`eleve.planning[]` côté Coffre). Cette classe ne fait AUCUNE hypothèse de
 * stockage — elle sert uniquement à structurer une occurrence une fois
 * sortie du Coffre par CoffreAdapter. Ne jamais l'instancier à partir d'une
 * source autre que le Coffre, et ne jamais la faire transiter vers un appel
 * de génération IA.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Occurrence extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "debut", "fin"]);
      this.seanceId = donnees.seanceId || null;
      this.classeId = donnees.classeId || null;
      this.typeLieu = donnees.typeLieu || "classe";
      this.espaceId = donnees.espaceId || null;
      this.creneauId = donnees.creneauId || null;
      this.jour = donnees.jour ?? null;
      this.debut = donnees.debut;
      this.fin = donnees.fin;
      this.activite = donnees.activite || { nom: "", domaineCle: null };
      this.adulteReference = donnees.adulteReference || { nom: "", role: "" };
      this.eleveIds = donnees.eleveIds || [];
      this.remarque = donnees.remarque || "";
      this.dateAffectation = donnees.dateAffectation || new Date().toISOString();
    }

    static fromJSON(donnees) {
      return new Occurrence(donnees);
    }

    /** Compat V1 : une entrée eleve.planning[] du Coffre (une par élève). */
    static depuisEntreeCoffre(entree, eleveId) {
      return new Occurrence({
        id: entree.id,
        seanceId: entree.seanceId || null,
        classeId: entree.classeId,
        typeLieu: entree.typeLieu,
        espaceId: entree.espaceId || null,
        creneauId: entree.creneauId,
        jour: entree.jour,
        debut: entree.debut,
        fin: entree.fin,
        activite: entree.activite,
        adulteReference: entree.adulteReference,
        eleveIds: [eleveId],
        remarque: entree.remarque,
        dateAffectation: entree.dateAffectation
      });
    }
  }

  global.SynapsesModel.Occurrence = Occurrence;
})(typeof window !== "undefined" ? window : globalThis);
