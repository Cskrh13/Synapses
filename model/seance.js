/**
 * Synapses 2.0 — model/seance.js
 * Contrat : action pédagogique, PAS prisonnière d'une date/salle (voir
 * Occurrence pour le placement concret). deroule[].tempsMinutes normalisé
 * en numérique (nécessaire au futur validateur, §24) ; dureeMinutes dérivée.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Seance extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "sequenceId"]);
      this.sequenceId = donnees.sequenceId;
      this.domaineId = donnees.domaineId || null;
      this.typeId = donnees.typeId || null;
      this.titre = donnees.titre || "";
      this.objectifIds = donnees.objectifIds || [];
      this.eleveIds = donnees.eleveIds || [];
      this.productionId = donnees.productionId || null;
      this.problematique = donnees.problematique || "";
      this.deroule = donnees.deroule || [];
      this.dureeMinutes = typeof donnees.dureeMinutes === "number"
        ? donnees.dureeMinutes
        : this.calculerDureeMinutes();
    }

    static fromJSON(donnees) {
      return new Seance(donnees);
    }

    /** Compat V1 : deroule[].temps ("5 min") -> tempsMinutes (5). */
    static depuisJSONv1(seaV1) {
      const deroule = (seaV1.deroule || []).map(phase => ({
        phase: phase.phase,
        tempsMinutes: parseInt(String(phase.temps || "").replace(/\D/g, ""), 10) || 0,
        modaliteMateriel: phase.modalite_materiel || "",
        deroulement: phase.deroulement || "",
        analyseTache: phase.analyse_tache || "",
        amenagement: phase.amenagement || "",
        posture: phase.posture || ""
      }));
      return new Seance({
        id: seaV1.id,
        sequenceId: seaV1.sequence_id,
        domaineId: seaV1.domaineId || null,
        typeId: seaV1.type,
        titre: seaV1.titre,
        problematique: seaV1.problematique,
        deroule
      });
    }

    calculerDureeMinutes() {
      return this.deroule.reduce((total, phase) => total + (phase.tempsMinutes || 0), 0);
    }
  }

  global.SynapsesModel.Seance = Seance;
})(typeof window !== "undefined" ? window : globalThis);
