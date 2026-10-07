/**
 * Synapses 2.0 — model/sequence.js
 * Contrat : progression pédagogique. Champs métier V1 (periode, prerequis,
 * objectifCommun, referencesTheoriques...) conservés comme extensions,
 * hors contrat minimal mais utiles (règle 10, §30).
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Sequence extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "domaineId", "titre"]);
      this.sourceId = donnees.sourceId || null;
      this.typeId = donnees.typeId || null;
      this.titre = donnees.titre;
      this.domaineId = donnees.domaineId;
      this.objectifIds = donnees.objectifIds || [];
      this.competenceIds = donnees.competenceIds || [];
      this.eleveIds = donnees.eleveIds || [];
      this.seanceIds = donnees.seanceIds || [];
      this.nombreSeancesPrevu = donnees.nombreSeancesPrevu || null;
      // Extensions métier V1, conservées :
      this.periode = donnees.periode ?? null;
      this.semaineDebut = donnees.semaineDebut ?? null;
      this.semaineFin = donnees.semaineFin ?? null;
      this.objectifCommun = donnees.objectifCommun || "";
      this.prerequis = donnees.prerequis || [];
      this.referencesTheoriques = donnees.referencesTheoriques || "";
    }

    static fromJSON(donnees) {
      return new Sequence(donnees);
    }

    /** Compat V1 : depuis sequence_xxx.json (domaine/competence_id en texte). */
    static depuisJSONv1(seqV1, domaineId) {
      return new Sequence({
        id: seqV1.id,
        titre: seqV1.titre,
        domaineId: domaineId || seqV1.domaine,
        competenceIds: seqV1.competence_id ? [seqV1.competence_id] : [],
        periode: seqV1.periode,
        semaineDebut: seqV1.semaine_debut,
        semaineFin: seqV1.semaine_fin,
        objectifCommun: seqV1.objectif_commun,
        prerequis: seqV1.prerequis,
        referencesTheoriques: seqV1.references_theoriques
      });
    }

    ajouterSeance(seanceId) {
      if (!this.seanceIds.includes(seanceId)) this.seanceIds.push(seanceId);
      return this;
    }

    estIssueDuneBibliotheque() {
      return this.sourceId !== null;
    }
  }

  global.SynapsesModel.Sequence = Sequence;
})(typeof window !== "undefined" ? window : globalThis);
