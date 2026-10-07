/**
 * Synapses 2.0 — core/grille-manager.js
 * ============================================================================
 * Grilles horaires { [classeId | dispositifId]: [créneau, ...] } :
 * lecture/écriture, nom d'affichage d'un créneau, application des
 * récréations / pauses « fixes » définies dans la configuration générale.
 *
 * Portage fidèle de chargerGrilles, sauverGrilles, libelleCreneau,
 * upsertCreneauFixe et appliquerCreneauxFixes (planning-core.js).
 *
 * Pour les pages en lecture seule, DataManager.get("grilles") suffit ; ce
 * manager ajoute l'écriture et les règles de construction des grilles
 * (même clé de stockage).
 *
 * Donnée publique : aucune identité d'élève.
 *
 * Dépendances : core/adapters/local-adapter.js, core/cahier-journal-manager.js
 * (TYPES_CRENEAU), core/config-planning-manager.js (classesDuService).
 */
(function (global) {
  "use strict";

  class GrilleManager {
    /** @param {object} [options] @param {LocalAdapter} [options.localAdapter] */
    constructor(options) {
      options = options || {};
      const { LocalAdapter } = global.SynapsesCore;
      this.local = options.localAdapter || new LocalAdapter();
    }

    charger() {
      return this.local.lire(this.local.cles.grilles, {}) || {};
    }

    /** ⚠ Lève une erreur si l'écriture échoue (voir ConfigPlanningManager.sauver). */
    sauver(grilles) {
      if (!this.local.ecrire(this.local.cles.grilles, grilles)) {
        throw new Error("Impossible d'enregistrer les grilles horaires (stockage local plein ou indisponible).");
      }
      return true;
    }

    /**
     * Nom d'affichage d'un créneau, JAMAIS vide : titre saisi (séance) →
     * libellé saisi (récréation/pause/autre) → libellé générique du type.
     * Utilisé partout où un créneau doit être nommé, pour que le nom envoyé
     * au coffre soit identique à celui affiché dans Planning — Gestion.
     */
    static libelleCreneau(c) {
      if (!c) return "";
      const saisi = c.type === "seance" ? (c.titre || "") : (c.libelle || "");
      if (saisi.trim()) return saisi.trim();
      const type = global.SynapsesCore.CahierJournalManager.TYPES_CRENEAU[c.type];
      return type ? type.label : "Créneau";
    }

    /**
     * Crée ou met à jour l'occurrence d'une récréation/pause. L'identifiant
     * est stable (« fixe_<classe>_<jour>_<type>_<index> ») ; les métadonnées
     * sont stockées explicitement car classeId contient lui-même des « _ »
     * (un split("_") de l'id serait faux).
     */
    static upsertCreneauFixe(liste, classeId, jour, type, index, def) {
      const id = "fixe_" + classeId + "_" + jour + "_" + type + "_" + index;
      let c = liste.find(x => x.id === id);
      if (!c) {
        c = {
          id: id, jour: jour, debut: def.debut, fin: def.fin, type: type,
          libelle: def.label || "", domaineCle: "",
          _fixeJour: jour, _fixeType: type, _fixeIndex: index
        };
        liste.push(c);
      } else {
        c.debut = def.debut;
        c.fin = def.fin;
        c.libelle = def.label || "";
        c._fixeJour = jour;
        c._fixeType = type;
        c._fixeIndex = index;
      }
      return c;
    }

    /**
     * Applique les récréations / pauses (définies une fois à l'échelle de
     * l'école) à la grille de chaque classe concernée, et retire celles qui
     * ne s'appliquent plus (jour non travaillé, service supprimé, classe
     * retirée du service). Mute `grilles`.
     * @returns {{ajoutes:number, misAJour:number, total:number}}
     */
    appliquerCreneauxFixes(config, grilles, classeIds) {
      const { ConfigPlanningManager } = global.SynapsesCore;
      const dansService = (def, classeId) =>
        ConfigPlanningManager.classesDuService(config, def).includes(classeId);

      const toutesLesClasses = (config.classes || []).map(c => c.id);
      classeIds = (classeIds && classeIds.length) ? classeIds : toutesLesClasses;
      const jours = (config.joursTravailles && config.joursTravailles.length)
        ? config.joursTravailles.map(Number) : [1, 2, 3, 4, 5];
      const recreations = Array.isArray(config.recreations) ? config.recreations : [];
      const pauses = Array.isArray(config.pauses) ? config.pauses : [];
      let ajoutes = 0, misAJour = 0;

      classeIds.forEach(classeId => {
        grilles[classeId] = Array.isArray(grilles[classeId]) ? grilles[classeId] : [];
        const grille = grilles[classeId];
        jours.forEach(j => {
          recreations.forEach((def, idx) => {
            if (!dansService(def, classeId)) return;
            const id = "fixe_" + classeId + "_" + j + "_recreation_" + idx;
            const existait = grille.some(c => c && c.id === id);
            GrilleManager.upsertCreneauFixe(grille, classeId, j, "recreation", idx, def);
            existait ? misAJour++ : ajoutes++;
          });
          pauses.forEach((def, idx) => {
            if (!dansService(def, classeId)) return;
            const id = "fixe_" + classeId + "_" + j + "_pause_" + idx;
            const existait = grille.some(c => c && c.id === id);
            GrilleManager.upsertCreneauFixe(grille, classeId, j, "pause", idx, def);
            existait ? misAJour++ : ajoutes++;
          });
        });

        grilles[classeId] = grille.filter(c => {
          if (!c || !c.id || !c.id.startsWith("fixe_" + classeId + "_")) return true;
          const jr = Number(c._fixeJour), idx = Number(c._fixeIndex), typ = c._fixeType;
          if (!Number.isFinite(jr) || !typ || !Number.isFinite(idx)) return false;
          if (!jours.includes(jr)) return false;
          const liste = typ === "recreation" ? recreations : typ === "pause" ? pauses : null;
          if (!liste || idx < 0 || idx >= liste.length) return false;
          return dansService(liste[idx], classeId);
        });
      });

      return { ajoutes, misAJour, total: ajoutes + misAJour };
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.GrilleManager = GrilleManager;
})(typeof window !== "undefined" ? window : globalThis);
