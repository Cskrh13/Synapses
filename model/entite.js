/**
 * Synapses 2.0 — model/entite.js
 * ============================================================================
 * Classe de base commune à tous les objets du modèle métier (contrat des
 * objets, étape 2). Fournit :
 *   - un identifiant stable (règle 1, §30 du document d'architecture) ;
 *   - une conversion JSON <-> instance homogène (fromJSON/toJSON) ;
 *   - une validation minimale (champs obligatoires déclarés par la sous-classe).
 *
 * Ne contient AUCUNE logique de stockage : une Entité ne sait pas où/comment
 * elle est persistée. C'est le rôle du Data Manager (core/data-manager.js).
 */
(function (global) {
  "use strict";

  class Entite {
    /**
     * @param {object} donnees - propriétés brutes (déjà en camelCase / IDs).
     * @param {string[]} champsObligatoires - noms de propriétés requis.
     */
    constructor(donnees, champsObligatoires) {
      if (new.target === Entite) {
        throw new Error("[Entite] Classe abstraite : instancier une sous-classe (Classe, Sequence, ...).");
      }
      donnees = donnees || {};
      (champsObligatoires || []).forEach(champ => {
        const valeur = donnees[champ];
        const manquant = valeur === undefined || valeur === null || valeur === "";
        if (manquant) {
          throw new Error(`[${this.constructor.name}] Champ obligatoire manquant : "${champ}".`);
        }
      });
      this.id = donnees.id;
    }

    /** Sérialisation vers un objet JSON simple (pour Data Manager / fichiers). */
    toJSON() {
      const sortie = {};
      Object.keys(this).forEach(cle => { sortie[cle] = this[cle]; });
      return sortie;
    }

    /** Chaque sous-classe doit fournir un fromJSON(donnees) statique. */
    static fromJSON() {
      throw new Error("fromJSON doit être implémenté par la sous-classe.");
    }
  }

  global.SynapsesModel = global.SynapsesModel || {};
  global.SynapsesModel.Entite = Entite;

})(typeof window !== "undefined" ? window : globalThis);
