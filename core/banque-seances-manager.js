/**
 * Synapses 2.0 — core/banque-seances-manager.js
 * ============================================================================
 * Portage fidèle de chargerBanque et chargerDerouleDeItem (planning-core.js).
 *
 * La « banque » est l'index des séances disponibles, par niveau puis par
 * domaine :
 *
 *   { [niveau]: { [domaineCle]: { label, items: [...] } } }
 *
 * Elle réunit :
 *   1. les séances publiées dans data/index.json (référentiel public) ;
 *   2. les séances créées localement dans sequences.html
 *      (localStorage : planif_sequences / planif_seances).
 *
 * Données publiques uniquement — aucune donnée élève ne transite ici.
 *
 * Pourquoi la lecture locale est BRUTE (et ne passe pas par
 * DataManager.get("programmationBrouillon")) : ce domaine reconstruit des
 * instances M.Sequence / M.Seance, dont le contrat exige `domaineId` et
 * perd `niveau`, `matiere`, `competence_id`, `deroule`… dont la banque a
 * besoin. Les séquences locales V1 n'ont pas de `domaineId` : le constructeur
 * lèverait une erreur. La lecture brute via LocalAdapter reste donc la seule
 * fidèle à la V1, tant que le modèle n'est pas migré.
 *
 * Chemins : mêmes candidats que la V1 (la page peut se trouver dans
 * Programmation/ ou à la racine) — les chemins « fichier » des items sont
 * relatifs au dossier qui contient data/, comme en V1.
 *
 * Dépendances : core/adapters/storage-adapter.js, core/adapters/local-adapter.js
 */
(function (global) {
  "use strict";

  const NIVEAU_PAR_DEFAUT = "CP"; // NIVEAUX[0] de planning-core.js

  const CANDIDATS_INDEX = [
    "data/index.json",
    "Programmation/data/index.json",
    "../Programmation/data/index.json",
    "../data/index.json"
  ];

  function slug(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "domaine";
  }

  function parseNumero(n) {
    const v = parseFloat(String(n).replace(",", "."));
    return isNaN(v) ? 999 : v;
  }

  class BanqueSeancesManager {
    /**
     * @param {object} [options]
     * @param {StorageAdapter} [options.storageAdapter]
     * @param {LocalAdapter}   [options.localAdapter]
     * @param {string[]}       [options.candidatsIndex]
     */
    constructor(options) {
      options = options || {};
      const { StorageAdapter, LocalAdapter } = global.SynapsesCore;
      this.storage = options.storageAdapter || new StorageAdapter();
      this.local = options.localAdapter || new LocalAdapter();
      this.candidatsIndex = options.candidatsIndex || CANDIDATS_INDEX;
    }

    /** Premier chemin qui répond avec un JSON valide, ou null. */
    async _chargerIndex() {
      for (const chemin of this.candidatsIndex) {
        try {
          return { data: await this.storage.lire(chemin), chemin: chemin };
        } catch (e) {
          // On essaie le chemin suivant.
        }
      }
      return null;
    }

    static baseDe(cheminIndex) {
      return cheminIndex.replace(/data\/index\.json$/, "");
    }

    _lireListeLocale(cle) {
      const v = this.local.lire(cle, []);
      return Array.isArray(v) ? v : [];
    }

    /** @returns {Promise<object>} la banque (voir en-tête). */
    async charger() {
      const banque = {};

      function domaineDe(niveau, cle) {
        if (!banque[niveau]) banque[niveau] = {};
        if (!banque[niveau][cle]) banque[niveau][cle] = { label: cle, items: [] };
        return banque[niveau][cle];
      }

      // 1. Fichiers du dépôt ------------------------------------------------
      const idx = await this._chargerIndex();
      if (idx) {
        const base = BanqueSeancesManager.baseDe(idx.chemin);
        for (const niv of (idx.data.niveaux || [])) {
          for (const disc of (niv.disciplines || [])) {
            for (const dom of (disc.domaines || [])) {
              const cle = `${disc.id}::${dom.id}`;
              const bucket = domaineDe(niv.id, cle);
              bucket.label = `${disc.nom || disc.id} — ${dom.nom || dom.id}`;

              let ordre = 0;
              for (const seq of (dom.sequences || [])) {
                for (const sea of (seq.seances || [])) {
                  bucket.items.push({
                    id: sea.id, domaineCle: cle, seqId: seq.id,
                    seqTitre: seq.titre || "", numero: sea.numero,
                    type: sea.type || "", titre: sea.titre || "",
                    source: "fichier", fichier: base + sea.fichier,
                    ordreSeq: ordre
                  });
                }
                ordre++;
              }
            }
          }
        }
      }

      // 2. Données locales (sequences.html) ---------------------------------
      const seqs = this._lireListeLocale(this.local.cles.sequencesBrouillon);
      const seas = this._lireListeLocale(this.local.cles.seancesBrouillon);
      const seqById = new Map(seqs.map(s => [s.id, s]));
      seqs.forEach((s, i) => { s.__ordre = i; });

      seas.forEach(sea => {
        // sequence_id est le champ canonique ; sequenceId en repli défensif.
        const seq = seqById.get(sea.sequence_id || sea.sequenceId);
        const niveau = (seq && seq.niveau) || sea.classe || NIVEAU_PAR_DEFAUT;
        const matiere = (seq && seq.matiere) || "Français";
        const champ = (seq && (seq.competence_id || seq.domaine)) || "lecture";
        const cle = `${slug(matiere)}::${champ}`;

        const bucket = domaineDe(niveau, cle);
        if (bucket.label === cle) bucket.label = `${matiere} — ${champ}`;

        bucket.items.push({
          id: sea.id, domaineCle: cle, seqId: sea.sequence_id,
          seqTitre: (seq && (seq.titre || seq.nom)) || "",
          numero: sea.numero, type: sea.type || "", titre: sea.titre || "",
          source: "local", deroule: sea.deroule || [],
          objectif_commun: sea.objectif_commun || "",
          problematique: sea.problematique || "",
          competence_cible: sea.competence_cible || "",
          ordreSeq: seq ? seq.__ordre : 999
        });
      });

      // Tri : ordre de séquence, puis numéro de séance.
      Object.values(banque).forEach(parNiveau => {
        Object.values(parNiveau).forEach(bucket => {
          bucket.items.sort((a, b) =>
            (a.ordreSeq - b.ordreSeq) || (parseNumero(a.numero) - parseNumero(b.numero))
          );
        });
      });

      return banque;
    }

    /**
     * Complète un item de la banque avec son déroulé détaillé. Un item
     * « local » porte déjà son déroulé ; un item « fichier » est lu à la volée.
     */
    async chargerDeroule(item) {
      if (item.source === "local") return item;

      let data;
      try {
        data = await this.storage.lire(item.fichier);
      } catch (e) {
        throw new Error("Fichier de séance introuvable : " + item.fichier);
      }

      return Object.assign({}, item, {
        deroule: data.deroule || [],
        objectif_commun: data.objectif_commun || "",
        problematique: data.problematique || "",
        competence_cible: data.competence_cible || "",
        modalites_generales: data.modalites_generales || "",
        vigilance: data.vigilance || "",
        titre: data.titre || item.titre
      });
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.BanqueSeancesManager = BanqueSeancesManager;
})(typeof window !== "undefined" ? window : globalThis);
