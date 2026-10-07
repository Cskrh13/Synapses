/**
 * Synapses 2.0 — core/data-manager.js
 * ============================================================================
 * Porte d'accès UNIQUE aux données de Synapses (voir §4-7 du document
 * d'architecture) :
 *
 *   HTML / interface → Core → DataManager → StorageAdapter → data/*.json
 *                                         └→ LocalAdapter   → localStorage
 *                                         └→ CoffreAdapter  → .synapses
 *
 * Réécriture complète (classe, plus de singleton fermé dans une IIFE) pour
 * rester cohérent avec synapses-coffre.js et avec model/*.js.
 *
 * Règle stricte : toute donnée protégée (élèves, planning nominatif,
 * personnel privé) passe exclusivement par getProtege(), jamais get().
 * Un domaine protégé appelé via get() lève une erreur explicite.
 *
 * Dépendances (à charger avant ce fichier) :
 *   model/entite.js, model/*.js,
 *   core/adapters/storage-adapter.js, local-adapter.js, coffre-adapter.js
 */
(function (global) {
  "use strict";

  const M = global.SynapsesModel;
  const { StorageAdapter, LocalAdapter, CoffreAdapter } = global.SynapsesCore;

  const CHEMINS_JSON = {
    referentielIndex: "Programmation/data/index.json",
    competences: "Programmation/data/competences.json",
    indexBibliotheque: "Programmation/data/indexbibliotheque.json"
  };

  const DOMAINES_PROTEGES = new Set([
    "eleves", "eleve", "besoins", "objectifsIndividuels", "adaptations",
    "planningEleve", "affectationsEleves", "exclusionsCreneau",
    "personnels", "personnel"
  ]);

  class DataManager {
    constructor(options) {
      options = options || {};
      this.storage = options.storageAdapter || new StorageAdapter();
      this.local = options.localAdapter || new LocalAdapter();
      this.coffre = options.coffreAdapter || new CoffreAdapter(this.local);
      this._niveauxParNom = null; // cache de résolution texte -> ID
    }

    // ------------------------------------------------------------------
    // Domaines PUBLICS
    // ------------------------------------------------------------------

    async get(domaine, ...args) {
      if (DOMAINES_PROTEGES.has(domaine)) {
        throw new Error(
          `[DataManager] "${domaine}" est protégé : utilisez getProtege("${domaine}", ...) ` +
          `après ouverture du Coffre. Ne jamais transmettre ce domaine à un moteur d'IA.`
        );
      }
      const gestionnaire = this[`_get_${domaine}`];
      if (!gestionnaire) throw new Error(`[DataManager] Domaine public inconnu : "${domaine}".`);
      return gestionnaire.apply(this, args);
    }

    async _get_referentiels() {
      const [index, competences] = await Promise.all([
        this.storage.lire(CHEMINS_JSON.referentielIndex),
        this.storage.lire(CHEMINS_JSON.competences)
      ]);
      return { index, competences };
    }

    async _get_bibliotheques() {
      // Transition : couvre encore les fiches pédagogues V1. À scinder à
      // l'étape 9 (bibliothèques de séquences modèles, objet nouveau).
      return this.storage.lire(CHEMINS_JSON.indexBibliotheque);
    }

    _get_ecole() {
      const brut = this.local.lire(this.local.cles.config, { classes: [], dispositifs: [] });
      return {
        classes: (brut.classes || []).map(c => M.Classe.depuisConfigV1(c, c.niveau)),
        dispositifs: (brut.dispositifs || []).map(M.Dispositif.depuisConfigV1),
        rentree: brut.rentree || null,
        semaines: brut.semaines || 0,
        vacances: brut.vacances || []
      };
    }

    _get_grilles() {
      return this.local.lire(this.local.cles.grilles, {});
    }

    _get_programmationBrouillon() {
      return {
        sequences: this.local.lire(this.local.cles.sequencesBrouillon, []).map(M.Sequence.fromJSON),
        seances: this.local.lire(this.local.cles.seancesBrouillon, []).map(M.Seance.fromJSON)
      };
    }

    // ------------------------------------------------------------------
    // Domaines PROTÉGÉS — délèguent systématiquement au CoffreAdapter
    // ------------------------------------------------------------------

    async getProtege(domaine, ...args) {
      const gestionnaire = this[`_getProtege_${domaine}`];
      if (!gestionnaire) throw new Error(`[DataManager] Domaine protégé inconnu : "${domaine}".`);
      return gestionnaire.apply(this, args);
    }

    _getProtege_eleves() {
      return this.coffre.listerEleves();
    }

    _getProtege_eleve(identifiantSynapses) {
      return this.coffre.getEleve(identifiantSynapses);
    }

    _getProtege_planningEleve(identifiantSynapses) {
      const entrees = this.coffre.getPlanningEleve(identifiantSynapses) || [];
      return entrees.map(e => M.Occurrence.depuisEntreeCoffre(e, identifiantSynapses));
    }

    _getProtege_affectationsEleves() {
      return this.coffre.affectationsEleves();
    }

    _getProtege_exclusionsCreneau() {
      return this.coffre.exclusionsCreneau();
    }

    /** Vue publique des personnels — jamais de nom (voir Coffre.listerPersonnels). */
    _getProtege_personnels() {
      return this.coffre.listerPersonnels().map(M.Personnel.depuisCoffre);
    }

    /** Fiche complète (avec nom) d'un seul personnel — usage coffre.html uniquement. */
    _getProtege_personnel(identifiantPersonnel) {
      return this.coffre.getPersonnel(identifiantPersonnel);
    }

    // ------------------------------------------------------------------
    // Écriture (domaines publics uniquement — l'écriture protégée passe
    // toujours par l'API directe du Coffre, jamais par ce fichier)
    // ------------------------------------------------------------------

    save(domaine, valeur) {
      if (domaine === "ecole") {
        return this.local.ecrire(this.local.cles.config, valeur);
      }
      if (domaine === "grilles") {
        return this.local.ecrire(this.local.cles.grilles, valeur);
      }
      throw new Error(
        `[DataManager] Écriture non prise en charge pour "${domaine}" ` +
        `(lecture seule, ou domaine protégé — utilisez l'API du Coffre directement).`
      );
    }

    // ------------------------------------------------------------------
    // Compatibilité texte -> ID (décision étape 3 : pas de migration
    // physique des JSON existants, traduction à la volée)
    // ------------------------------------------------------------------

    async resoudreNiveauId(texteNiveau) {
      if (!texteNiveau) return null;
      if (!this._niveauxParNom) {
        const { index } = await this._get_referentiels();
        this._niveauxParNom = new Map(
          (index.niveaux || []).map(n => [String(n.nom || n.id).trim().toUpperCase(), n.id])
        );
      }
      return this._niveauxParNom.get(String(texteNiveau).trim().toUpperCase()) || null;
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.DataManager = DataManager;

})(typeof window !== "undefined" ? window : globalThis);
