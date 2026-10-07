/**
 * Synapses 2.0 — core/adapters/local-adapter.js
 * Lecture/écriture localStorage, pour les données NON sensibles uniquement
 * (config école, classes, dispositifs, grilles génériques). Les clés
 * reprennent exactement celles de planning-core.js — aucune donnée n'est
 * déplacée ni renommée par cet adapter.
 */
(function (global) {
  "use strict";

  class LocalAdapter {
    constructor(prefixeCles) {
      this.cles = Object.assign({
        config: "synapses_planning_config",
        grilles: "synapses_planning_grilles",
        affectations: "synapses_planning_affectations",
        sequencesBrouillon: "planif_sequences",
        seancesBrouillon: "planif_seances"
      }, prefixeCles || {});
    }

    _disponible() {
      return typeof global !== "undefined" && typeof global.localStorage !== "undefined";
    }

    lire(cle, valeurParDefaut) {
      if (!this._disponible()) return valeurParDefaut;
      const brut = global.localStorage.getItem(cle);
      if (typeof brut !== "string") return valeurParDefaut;
      try {
        return JSON.parse(brut);
      } catch (erreur) {
        console.warn(`[LocalAdapter] JSON invalide pour "${cle}", valeur par défaut utilisée.`, erreur);
        return valeurParDefaut;
      }
    }

    ecrire(cle, valeur) {
      if (!this._disponible()) return false;
      try {
        global.localStorage.setItem(cle, JSON.stringify(valeur));
        return true;
      } catch (erreur) {
        console.error(`[LocalAdapter] Échec d'écriture pour "${cle}".`, erreur);
        return false;
      }
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.LocalAdapter = LocalAdapter;
})(typeof window !== "undefined" ? window : globalThis);
