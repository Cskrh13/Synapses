/**
 * Synapses 2.0 — core/programmation-manager.js
 * ============================================================================
 * API conceptuelle du §27 du document d'architecture :
 *   ProgrammationManager.createSequence(...)
 *   ProgrammationManager.createSeance(...)
 *   ProgrammationManager.createOccurrence(...)
 *   ProgrammationManager.moveOccurrence(...)
 *   ProgrammationManager.validate(...)
 *
 * Règle d'or (§25) : ce que ce manager crée est exactement le même type
 * d'objet que ce que l'enseignant crée manuellement — pas de format
 * parallèle pour un futur moteur automatique.
 *
 * ProgrammationManager ne touche JAMAIS directement le Coffre pour écrire
 * une Occurrence nominative : createOccurrence() construit l'objet et le
 * retourne, c'est à l'appelant (une page qui a le Coffre ouvert) de le
 * persister via coffre.affecterCreneau(). Ça évite qu'un futur appel
 * involontaire fasse fuiter une identité d'élève par ce manager.
 */
(function (global) {
  "use strict";

  const M = global.SynapsesModel;
  const { ProgrammationValidator } = global.SynapsesCore;

  function idAleatoire(prefixe) {
    return `${prefixe}-${Math.random().toString(36).slice(2, 11)}`;
  }

  class ProgrammationManager {
    /**
     * @param {DataManager} dataManager
     */
    constructor(dataManager) {
      this.data = dataManager;
      this.validator = new ProgrammationValidator();
      this._sequences = new Map();
      this._seances = new Map();
    }

    /** Charge en mémoire les séquences/séances brouillon déjà existantes. */
    async charger() {
      const { sequences, seances } = await this.data.get("programmationBrouillon");
      sequences.forEach(s => this._sequences.set(s.id, s));
      seances.forEach(s => this._seances.set(s.id, s));
      return this;
    }

    // ------------------------------------------------------------------
    // Création
    // ------------------------------------------------------------------

    createSequence(proprietes) {
      const sequence = new M.Sequence(Object.assign(
        { id: proprietes.id || idAleatoire("SEQ") }, proprietes
      ));
      this._sequences.set(sequence.id, sequence);
      return sequence;
    }

    createSeance(sequenceId, proprietes) {
      const sequence = this._sequences.get(sequenceId);
      if (!sequence) throw new Error(`[ProgrammationManager] Séquence "${sequenceId}" introuvable.`);
      const seance = new M.Seance(Object.assign(
        { id: proprietes.id || idAleatoire("SEANCE"), sequenceId }, proprietes
      ));
      this._seances.set(seance.id, seance);
      sequence.ajouterSeance(seance.id);
      return seance;
    }

    /**
     * Construit une Occurrence prête à être persistée via le Coffre
     * (coffre.affecterCreneau) — ne l'écrit jamais elle-même.
     */
    createOccurrence(seanceId, proprietesPlacement) {
      const seance = this._seances.get(seanceId);
      if (!seance) throw new Error(`[ProgrammationManager] Séance "${seanceId}" introuvable.`);
      return new M.Occurrence(Object.assign(
        { id: proprietesPlacement.id || idAleatoire("OCC"), seanceId },
        proprietesPlacement
      ));
    }

    /**
     * Déplace une Occurrence déjà créée (nouveau jour/horaire/espace) sans la
     * recréer — cf. §13 : "une séance peut être déplacée sans être recréée".
     */
    moveOccurrence(occurrence, nouveauPlacement) {
      const deplacee = new M.Occurrence(Object.assign(
        {}, occurrence.toJSON(), nouveauPlacement
      ));
      return deplacee;
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    /** Validation sans données protégées : chevauchements, espaces, séances. */
    validate(occurrences, espaces) {
      const espacesParId = new Map((espaces || []).map(e => [e.id, e]));
      return this.validator.validerOccurrences(occurrences, espacesParId);
    }

    // ------------------------------------------------------------------
    // Persistance (brouillon uniquement — les séquences/séances "modèles"
    // publiées en data/ restent gérées par les générateurs existants)
    // ------------------------------------------------------------------

    sauvegarderBrouillon() {
      const sequences = Array.from(this._sequences.values()).map(s => s.toJSON());
      const seances = Array.from(this._seances.values()).map(s => s.toJSON());
      const okSeq = this.data.local.ecrire(this.data.local.cles.sequencesBrouillon, sequences);
      const okSea = this.data.local.ecrire(this.data.local.cles.seancesBrouillon, seances);
      return okSeq && okSea;
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.ProgrammationManager = ProgrammationManager;
})(typeof window !== "undefined" ? window : globalThis);
