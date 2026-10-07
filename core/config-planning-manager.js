/**
 * Synapses 2.0 — core/config-planning-manager.js
 * ============================================================================
 * Configuration générale du planning (école, classes, dispositifs, jours
 * travaillés, récréations, pauses, calendrier) sous sa forme V1 BRUTE :
 * lecture normalisée, écriture, création/suppression de classe,
 * export/import du fichier de configuration, migration de l'ancien modèle.
 *
 * Portage fidèle de chargerConfig, sauverConfig, creerClasse,
 * supprimerClasse, classeById, dispositifById, classesDuService,
 * exporterConfigJSON, importerConfigJSON et migrerStockageClasses
 * (planning-core.js).
 *
 * Pourquoi ne pas passer par DataManager.get("ecole") : ce domaine renvoie
 * des instances Classe/Dispositif du modèle 2.0, qui perdent recreations,
 * pauses, joursTravailles, dispositifGroupes, enseignant… Une page qui
 * MODIFIE la configuration (planning-gestion.html) et la réécrit telle quelle
 * détruirait ces champs. get("ecole") reste la bonne porte pour les pages en
 * lecture seule (planning-affichage.html) ; ce manager est celle des pages
 * qui écrivent. Même clé de stockage dans les deux cas.
 *
 * Donnée publique : aucune identité d'élève ici.
 *
 * ⚠ Différence volontaire avec la V1 : sauver() lève une erreur si
 * l'écriture échoue (stockage plein / indisponible). La V1 laissait
 * remonter l'exception de localStorage.setItem ; LocalAdapter, lui, renvoie
 * false — on la retransforme en erreur pour ne jamais perdre une
 * modification en silence.
 *
 * Dépendances : core/adapters/local-adapter.js, core/calendrier-scolaire.js
 * (dates), core/cahier-journal-manager.js (uidParDefaut).
 */
(function (global) {
  "use strict";

  const NIVEAUX = ["CP", "CE1", "CE2", "CM1", "CM2"];
  const NIVEAUX_DISPONIBLES = ["TPS", "PS", "MS", "GS", "CP", "CE1", "CE2", "CM1", "CM2"];
  const PALETTE_CLASSES = ["#2E5EAA", "#B5502E", "#2A7F72", "#6B4E8E", "#B5871E",
    "#B23A5C", "#3F8C4B", "#8C5E2A", "#5B5F6B", "#1E2A4A"];

  class ConfigPlanningManager {
    /**
     * @param {object} [options]
     * @param {LocalAdapter} [options.localAdapter]
     * @param {function} [options.uid] - (prefixe) => identifiant
     */
    constructor(options) {
      options = options || {};
      const { LocalAdapter, CahierJournalManager } = global.SynapsesCore;
      this.local = options.localAdapter || new LocalAdapter();
      this.uid = options.uid || CahierJournalManager.uidParDefaut;
    }

    /** Niveaux élémentaires dans l'ordre pédagogique (CP → CM2), pour trier. */
    static get NIVEAUX() { return NIVEAUX; }
    static get NIVEAUX_DISPONIBLES() { return NIVEAUX_DISPONIBLES; }
    static get PALETTE_CLASSES() { return PALETTE_CLASSES; }

    // ------------------------------------------------------------------
    // Lecture / écriture
    // ------------------------------------------------------------------

    static configParDefaut() {
      return {
        rentree: "",
        semaines: 36,
        vacances: [],
        // Classes : { id, nom, niveau, couleur, dispositifs: [ids] }
        classes: [],
        // Dispositifs indépendants des classes : { id, nom, type, couleur }
        dispositifs: [],
        // 1 = lundi … 5 = vendredi
        joursTravailles: [1, 2, 3, 4, 5],
        // Services d'école ; `classes: []` = toutes les classes
        recreations: [{ label: "Récréation matin", debut: "10:00", fin: "10:15", classes: [] }],
        pauses: [{ label: "Pause méridienne", debut: "12:00", fin: "13:30", classes: [] }]
      };
    }

    /**
     * Lit la configuration et la complète (rétro-compatibilité, sans jamais
     * écraser une valeur existante). Ne supprime jamais de donnée locale.
     */
    charger() {
      let c = null;
      try {
        c = this.local.lire(this.local.cles.config, null);
      } catch (e) {
        c = null;
      }
      if (!c || typeof c !== "object") return ConfigPlanningManager.configParDefaut();

      if (!c.joursTravailles || !c.joursTravailles.length) c.joursTravailles = [1, 2, 3, 4, 5];
      if (!Array.isArray(c.recreations)) c.recreations = [
        { label: "Récréation matin", debut: "10:00", fin: "10:15", classes: [] }
      ];
      if (!Array.isArray(c.pauses)) c.pauses = [
        { label: "Pause méridienne", debut: "12:00", fin: "13:30", classes: [] }
      ];

      // Ancien modèle « niveauxActifs » -> classes. Cas particulier des
      // versions intermédiaires qui avaient créé classes: [] sans recopier
      // la liste : les niveaux historiques redeviennent des classes.
      if (!Array.isArray(c.classes) ||
          (c.classes.length === 0 && Array.isArray(c.niveauxActifs) && c.niveauxActifs.length)) {
        const anciens = Array.isArray(c.niveauxActifs) ? c.niveauxActifs : [];
        c.classes = anciens.map((n, i) => ({
          id: this.uid("cls"), nom: n, niveau: n,
          couleur: PALETTE_CLASSES[i % PALETTE_CLASSES.length], dispositifs: []
        }));
      }
      c.classes.forEach((cl, i) => {
        if (!cl.id) cl.id = this.uid("cls");
        if (!cl.couleur) cl.couleur = PALETTE_CLASSES[i % PALETTE_CLASSES.length];
        if (!cl.nom) cl.nom = cl.niveau || "Classe";
        if (!Array.isArray(cl.dispositifs)) cl.dispositifs = [];
      });
      if (!Array.isArray(c.dispositifs)) c.dispositifs = [];
      c.dispositifs.forEach((d, i) => {
        if (!d.id) d.id = this.uid("disp");
        if (!d.nom) d.nom = d.type || "Dispositif";
        if (!["ULIS", "SEGPA", "RASED"].includes(String(d.type || "").toUpperCase())) d.type = "ULIS";
        else d.type = String(d.type).toUpperCase();
        if (!d.couleur) d.couleur = ["#6B4E8E", "#3F8C4B", "#B5871E"][i % 3];
      });
      c.recreations.forEach(r => { if (!Array.isArray(r.classes)) r.classes = []; });
      c.pauses.forEach(p => { if (!Array.isArray(p.classes)) p.classes = []; });
      return c;
    }

    sauver(config) {
      if (!this.local.ecrire(this.local.cles.config, config)) {
        throw new Error("Impossible d'enregistrer la configuration du planning (stockage local plein ou indisponible).");
      }
      return true;
    }

    // ------------------------------------------------------------------
    // Classes / dispositifs
    // ------------------------------------------------------------------

    classeById(config, classeId) {
      return (config.classes || []).find(c => c.id === classeId) || null;
    }

    dispositifById(config, dispositifId) {
      return (config.dispositifs || []).find(d => d.id === dispositifId) || null;
    }

    /** Identifiants des classes concernées par un service (récréation/pause) :
     *  `def.classes` vide ou absent = toutes les classes de la config. */
    static classesDuService(config, def) {
      if (def.classes && def.classes.length) return def.classes;
      return (config.classes || []).map(c => c.id);
    }

    creerClasse(config, nom, niveau) {
      const cl = {
        id: this.uid("cls"),
        nom: (nom || niveau || "Classe").trim(),
        niveau: niveau || "",
        couleur: PALETTE_CLASSES[config.classes.length % PALETTE_CLASSES.length],
        dispositifs: []
      };
      config.classes.push(cl);
      return cl;
    }

    /** Retire la classe de la config, des services et des grilles/affectations passées. */
    supprimerClasse(config, classeId, grilles, affectations) {
      config.classes = config.classes.filter(c => c.id !== classeId);
      config.recreations.forEach(r => { r.classes = (r.classes || []).filter(id => id !== classeId); });
      config.pauses.forEach(p => { p.classes = (p.classes || []).filter(id => id !== classeId); });
      if (grilles) delete grilles[classeId];
      if (affectations) delete affectations[classeId];
    }

    // ------------------------------------------------------------------
    // Export / import du fichier de configuration (.json, sans grilles)
    // ------------------------------------------------------------------

    /** Déclenche le téléchargement de synapses-planning-config.json. */
    exporterJSON(config) {
      const payload = {
        type: "synapses-planning-config",
        version: 1,
        exporteLe: new Date().toISOString(),
        rentree: config.rentree,
        semaines: config.semaines,
        vacances: config.vacances,
        classes: config.classes,
        dispositifs: config.dispositifs || [],
        joursTravailles: config.joursTravailles,
        recreations: config.recreations,
        pauses: config.pauses
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "synapses-planning-config.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    /** Import « franc » (remplace classes / jours / récréations / pauses / calendrier). */
    importerJSON(config, payload) {
      if (!payload || typeof payload !== "object") throw new Error("Fichier de configuration invalide.");
      if (Array.isArray(payload.classes)) config.classes = payload.classes.map(c => ({
        id: c.id || this.uid("cls"),
        nom: c.nom || c.niveau || "Classe",
        niveau: c.niveau || "",
        couleur: c.couleur || PALETTE_CLASSES[0],
        dispositifs: Array.isArray(c.dispositifs) ? c.dispositifs.slice() : []
      }));
      if (Array.isArray(payload.dispositifs)) config.dispositifs = payload.dispositifs.map(d => ({
        id: d.id || this.uid("disp"),
        nom: d.nom || "Dispositif",
        type: d.type || "ULIS",
        couleur: d.couleur || PALETTE_CLASSES[0]
      }));
      if (typeof payload.rentree === "string") config.rentree = payload.rentree;
      if (typeof payload.semaines === "number") config.semaines = payload.semaines;
      if (Array.isArray(payload.vacances)) config.vacances = payload.vacances;
      if (Array.isArray(payload.joursTravailles) && payload.joursTravailles.length) config.joursTravailles = payload.joursTravailles;
      if (Array.isArray(payload.recreations)) config.recreations = payload.recreations.map(r => ({ label: r.label || "Récréation", debut: r.debut, fin: r.fin, classes: r.classes || [] }));
      if (Array.isArray(payload.pauses)) config.pauses = payload.pauses.map(p => ({ label: p.label || "Pause méridienne", debut: p.debut, fin: p.fin, classes: p.classes || [] }));
      return config;
    }

    // ------------------------------------------------------------------
    // Migration de l'ancien modèle (grilles indexées par niveau CP/CE1/…)
    // ------------------------------------------------------------------

    /**
     * Non destructive : les anciennes clés ne sont jamais supprimées. Sauve
     * config, grilles et affectations si quelque chose a changé.
     * @returns {boolean} true si une modification a eu lieu
     */
    migrerStockageClasses(config, grilles) {
      if (!config || !grilles || typeof grilles !== "object") return false;

      const anciens = Array.isArray(config.niveauxActifs) ? config.niveauxActifs.slice() : [];
      Object.keys(grilles).forEach(k => {
        const niveau = String(k).toUpperCase();
        if (NIVEAUX.includes(niveau) && !anciens.some(x => String(x).toUpperCase() === niveau)) {
          anciens.push(k);
        }
      });

      if (!Array.isArray(config.classes)) config.classes = [];
      let modifie = false;

      anciens.forEach(niveau => {
        if (!niveau) return;
        const niveauCle = String(niveau).toUpperCase();
        let cl = config.classes.find(c => String(c.niveau || c.nom || "").toUpperCase() === niveauCle);
        if (!cl) {
          cl = {
            id: this.uid("cls"), nom: niveau, niveau: niveau,
            couleur: PALETTE_CLASSES[config.classes.length % PALETTE_CLASSES.length],
            dispositifs: []
          };
          config.classes.push(cl);
          modifie = true;
        }
        const ancienne = grilles[niveau] || grilles[niveauCle];
        if (Array.isArray(ancienne) && (!Array.isArray(grilles[cl.id]) || !grilles[cl.id].length)) {
          grilles[cl.id] = ancienne;
          modifie = true;
        }
      });

      // Même migration pour les affectations de séances (anciennes clés conservées).
      try {
        const cleAff = this.local.cles.affectations;
        const aff = this.local.lire(cleAff, {}) || {};
        let affModifie = false;
        anciens.forEach(niveau => {
          const niveauCle = String(niveau).toUpperCase();
          const cl = config.classes.find(c => String(c.niveau || c.nom || "").toUpperCase() === niveauCle);
          const ancienne = aff[niveau] || aff[niveauCle];
          if (cl && ancienne !== undefined && !Object.prototype.hasOwnProperty.call(aff, cl.id)) {
            aff[cl.id] = ancienne;
            affModifie = true;
          }
        });
        if (affModifie) this.local.ecrire(cleAff, aff);
      } catch (e) {
        // Une migration secondaire ne doit jamais empêcher le chargement du planning.
      }

      if (modifie) {
        this.local.ecrire(this.local.cles.grilles, grilles);
        this.sauver(config);
      }
      return modifie;
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.ConfigPlanningManager = ConfigPlanningManager;
})(typeof window !== "undefined" ? window : globalThis);
