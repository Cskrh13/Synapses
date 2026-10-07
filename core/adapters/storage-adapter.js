/**
 * Synapses 2.0 — core/adapters/storage-adapter.js
 * Lecture des JSON publics (data/), avec cache mémoire par instance.
 * Ne connaît rien du modèle métier : renvoie du JSON brut.
 */
(function (global) {
  "use strict";

  class StorageAdapter {
    constructor() {
      this._cache = new Map();
    }

    async lire(chemin) {
      if (this._cache.has(chemin)) return this._cache.get(chemin);
      const reponse = await fetch(chemin, { cache: "no-cache" });
      if (!reponse.ok) {
        throw new Error(`[StorageAdapter] Impossible de charger ${chemin} (HTTP ${reponse.status}).`);
      }
      const donnees = await reponse.json();
      this._cache.set(chemin, donnees);
      return donnees;
    }

    invalider(chemin) {
      if (chemin) this._cache.delete(chemin);
      else this._cache.clear();
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.StorageAdapter = StorageAdapter;
})(typeof window !== "undefined" ? window : globalThis);
