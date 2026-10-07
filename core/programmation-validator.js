/**
 * Synapses 2.0 — core/programmation-validator.js
 * ============================================================================
 * Validateur de programmation (§24 du document d'architecture). Scope
 * volontairement réduit à ce qui est vérifiable SANS données protégées
 * (le validateur ne reçoit jamais d'identité élève, seulement des IDs et
 * des créneaux) :
 *   - contraintes temporelles : chevauchement, durée impossible ;
 *   - contraintes spatiales : capacité d'espace insuffisante ;
 *   - contraintes pédagogiques minimales : séance sans séquence.
 * Les contraintes humaines et individuelles (§24) nécessitent le Coffre et
 * seront ajoutées via ProgrammationManager.validerAvecCoffre(), pas ici.
 */
(function (global) {
  "use strict";

  class ProgrammationValidator {
    /**
     * @param {object[]} occurrences - instances Occurrence (ou compatibles)
     * @returns {{valide: boolean, erreurs: object[]}}
     */
    validerOccurrences(occurrences, espacesParId) {
      const erreurs = [];
      occurrences.forEach(occ => this._validerUneOccurrence(occ, espacesParId, erreurs));
      this._detecterChevauchements(occurrences, erreurs);
      return { valide: erreurs.length === 0, erreurs };
    }

    _validerUneOccurrence(occ, espacesParId, erreurs) {
      if (!occ.debut || !occ.fin || occ.debut >= occ.fin) {
        erreurs.push({ type: "duree_impossible", occurrenceId: occ.id,
          message: `Créneau invalide (${occ.debut} → ${occ.fin}).` });
      }
      if (occ.espaceId && espacesParId) {
        const espace = espacesParId.get(occ.espaceId);
        if (!espace) {
          erreurs.push({ type: "espace_inconnu", occurrenceId: occ.id,
            message: `Espace "${occ.espaceId}" introuvable.` });
        } else if (occ.eleveIds && !espace.accueillePersonnes(occ.eleveIds.length)) {
          erreurs.push({ type: "capacite_insuffisante", occurrenceId: occ.id,
            message: `Espace "${espace.nom}" (capacité ${espace.capacite}) pour ${occ.eleveIds.length} élève(s).` });
        }
      }
      if (!occ.seanceId) {
        erreurs.push({ type: "seance_manquante", occurrenceId: occ.id,
          message: `Occurrence sans séance associée.` });
      }
    }

    _detecterChevauchements(occurrences, erreurs) {
      for (let i = 0; i < occurrences.length; i++) {
        for (let j = i + 1; j < occurrences.length; j++) {
          const a = occurrences[i], b = occurrences[j];
          if (a.jour !== b.jour) continue;
          const memeSalle = a.espaceId && a.espaceId === b.espaceId;
          if (!memeSalle) continue;
          const chevauche = a.debut < b.fin && b.debut < a.fin;
          if (chevauche) {
            erreurs.push({ type: "chevauchement_salle", occurrenceId: a.id, autreOccurrenceId: b.id,
              message: `"${a.espaceId}" occupé simultanément par ${a.id} et ${b.id}.` });
          }
        }
      }
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.ProgrammationValidator = ProgrammationValidator;
})(typeof window !== "undefined" ? window : globalThis);
