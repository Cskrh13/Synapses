/**
 * planning-core.js
 * ---------------------------------------------------------------------------
 * Logique partagée entre planning-gestion.html et planning-affichage.html.
 *
 * Contrairement au reste du site (où chaque page HTML duplique sa propre
 * logique de chargement), les DEUX pages du planning doivent appliquer
 * EXACTEMENT le même calcul de calendrier (semaines, vacances) et la même
 * lecture de la banque de séances. Un écart entre les deux casserait la
 * correspondance affichage / gestion. D'où ce module unique, chargé par
 * <script src="planning-core.js"></script> dans les deux pages.
 *
 * Sources de séances agrégées :
 *   1) Programmation/data/index.json + les fichiers séance qu'il référence
 *      (référentiel "officiel", fichiers JSON du dépôt).
 *   2) localStorage (planif_sequences / planif_seances), alimenté par
 *      Programmation/sequences.html.
 * Les deux sont fusionnées dans une "banque" indexée par niveau puis par
 * "clé de domaine" (discipline::domaine).
 *
 * Stockage propre au planning (localStorage) :
 *   - synapses_planning_config      : réglages généraux (rentrée, nb de
 *                                      semaines, périodes de vacances)
 *   - synapses_planning_grilles     : grille horaire type par niveau
 *   - synapses_planning_affectations: séance affectée à chaque créneau daté
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const NIVEAUX = ["CP", "CE1", "CE2", "CM1", "CM2"];
  const JOURS = [
    { n: 1, nom: "Lundi" }, { n: 2, nom: "Mardi" }, { n: 3, nom: "Mercredi" },
    { n: 4, nom: "Jeudi" }, { n: 5, nom: "Vendredi" }
  ];
  const TYPES_CRENEAU = {
    seance: { label: "Séance", couleur: "#2E5EAA" },
    recreation: { label: "Récréation", couleur: "#B5871E" },
    pause: { label: "Pause méridienne", couleur: "#9A9689" },
    autre: { label: "Autre / rituel", couleur: "#5B5F6B" }
  };

  const STORE_CONFIG = "synapses_planning_config";
  const STORE_GRILLES = "synapses_planning_grilles";
  const STORE_AFFECT = "synapses_planning_affectations";

  // -------------------------------------------------------------- Helpers
  function slug(str) {
    return String(str || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "domaine";
  }
  function uid(prefix) { return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7); }
  function parseNumero(n) { const v = parseFloat(String(n).replace(",", ".")); return isNaN(v) ? 999 : v; }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function mondayOfWeek(d) { const r = new Date(d); const dow = (r.getDay() + 6) % 7; return addDays(r, -dow); }
  function formatDateLong(d) {
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function formatDateShort(d) {
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  }
  function heureVersMin(h) { const [hh, mm] = String(h || "0:0").split(":").map(Number); return (hh || 0) * 60 + (mm || 0); }

  // -------------------------------------------------------- Chargement JSON
  async function fetchFirst(candidats) {
    for (const chemin of candidats) {
      try {
        const r = await fetch(chemin, { cache: "no-store" });
        if (r.ok) return { data: await r.json(), chemin };
      } catch (e) { /* chemin suivant */ }
    }
    return null;
  }
  function candidatsIndex() {
    return ["data/index.json", "Programmation/data/index.json", "../Programmation/data/index.json", "../data/index.json"];
  }
  function baseDe(cheminIndex) {
    // Les chemins internes à index.json ("data/...") sont relatifs au dossier Programmation/.
    // On déduit la racine "Programmation/" à partir du chemin qui a fonctionné pour index.json.
    return cheminIndex.replace(/data\/index\.json$/, "");
  }

  // ------------------------------------------------------------ Banque
  /**
   * Retourne { niveau: { domaineCle: { label, items: [...] } } }
   * item = { id, seqTitre, numero, type, titre, source:'fichier'|'local', fichier?, deroule? , meta:{...} }
   */
  async function chargerBanque() {
    const banque = {};
    function domaineDe(niveau, cle) {
      if (!banque[niveau]) banque[niveau] = {};
      if (!banque[niveau][cle]) banque[niveau][cle] = { label: cle, items: [] };
      return banque[niveau][cle];
    }

    // --- 1) Fichiers du dépôt, via index.json ---
    const idx = await fetchFirst(candidatsIndex());
    if (idx) {
      const base = baseDe(idx.chemin);
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
                  id: sea.id,
                  seqId: seq.id,
                  seqTitre: seq.titre || "",
                  numero: sea.numero,
                  type: sea.type || "",
                  titre: sea.titre || "",
                  source: "fichier",
                  fichier: base + sea.fichier,
                  ordreSeq: ordre
                });
              }
              ordre++;
            }
          }
        }
      }
    }

    // --- 2) localStorage (créées dans sequences.html) ---
    let seqs = [], seas = [];
    try { seqs = JSON.parse(localStorage.getItem("planif_sequences")) || []; } catch (e) { /* vide */ }
    try { seas = JSON.parse(localStorage.getItem("planif_seances")) || []; } catch (e) { /* vide */ }
    const seqById = new Map(seqs.map(s => [s.id, s]));
    seqs.forEach((s, i) => { s.__ordre = i; });
    seas.forEach(sea => {
      const seq = seqById.get(sea.sequence_id);
      const niveau = (seq && seq.niveau) || sea.classe || NIVEAUX[0];
      const matiere = (seq && seq.matiere) || "Français";
      const champ = (seq && (seq.competence_id || seq.domaine)) || "lecture";
      const cle = `${slug(matiere)}::${champ}`;
      const bucket = domaineDe(niveau, cle);
      if (bucket.label === cle) bucket.label = `${matiere} — ${champ}`;
      bucket.items.push({
        id: sea.id,
        seqId: sea.sequence_id,
        seqTitre: (seq && (seq.titre || seq.nom)) || "",
        numero: sea.numero,
        type: sea.type || "",
        titre: sea.titre || "",
        source: "local",
        deroule: sea.deroule || [],
        objectif_commun: sea.objectif_commun || "",
        problematique: sea.problematique || "",
        competence_cible: sea.competence_cible || "",
        ordreSeq: seq ? seq.__ordre : 999
      });
    });

    // --- Tri de chaque file d'attente : ordre de séquence puis numéro de séance ---
    Object.values(banque).forEach(parNiveau => {
      Object.values(parNiveau).forEach(bucket => {
        bucket.items.sort((a, b) => (a.ordreSeq - b.ordreSeq) || (parseNumero(a.numero) - parseNumero(b.numero)));
      });
    });
    return banque;
  }

  async function chargerDerouleDeItem(item) {
    if (item.source === "local") return item; // déjà en mémoire
    const r = await fetch(item.fichier, { cache: "no-store" });
    if (!r.ok) throw new Error("Fichier de séance introuvable : " + item.fichier);
    const data = await r.json();
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

  // ------------------------------------------------------------ Stockage
  function chargerConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(STORE_CONFIG));
      if (c) return c;
    } catch (e) { /* défaut */ }
    return { rentree: "", semaines: 36, vacances: [], niveauxActifs: [] };
  }
  function sauverConfig(c) { localStorage.setItem(STORE_CONFIG, JSON.stringify(c)); }

  function chargerGrilles() {
    try { return JSON.parse(localStorage.getItem(STORE_GRILLES)) || {}; } catch (e) { return {}; }
  }
  function sauverGrilles(g) { localStorage.setItem(STORE_GRILLES, JSON.stringify(g)); }

  function chargerAffectations() {
    try { return JSON.parse(localStorage.getItem(STORE_AFFECT)) || {}; } catch (e) { return {}; }
  }
  function sauverAffectations(a) { localStorage.setItem(STORE_AFFECT, JSON.stringify(a)); }

  function cleCreneau(dateStr, creneauId) { return dateStr + "__" + creneauId; }

  // ------------------------------------------------------------ Calendrier
  /**
   * Calcule N "semaines de classe" à partir de la config (rentrée, vacances).
   * Une semaine dont le lundi tombe dans une période de vacances est ignorée
   * et ne compte pas dans les N semaines (simplification : une période de
   * vacances qui touche une semaine met toute la semaine de côté).
   * Retourne [{ numero, lundi:Date, vendredi:Date, vacances:false }] + les
   * semaines de vacances rencontrées, pour affichage ("Semaine X — Vacances").
   */
  function estEnVacances(lundi, vendredi, vacances) {
    return (vacances || []).some(v => {
      const debut = parseISO(v.debut), fin = parseISO(v.fin);
      return lundi <= fin && vendredi >= debut;
    });
  }
  function calculerSemaines(config) {
    const resultat = [];
    if (!config.rentree) return resultat;
    let curseur = mondayOfWeek(parseISO(config.rentree));
    const nb = config.semaines || 36;
    let garde = 0;
    while (resultat.length < nb && garde < nb + 30) {
      garde++;
      const lundi = curseur;
      const vendredi = addDays(curseur, 4);
      const vac = estEnVacances(lundi, vendredi, config.vacances);
      if (!vac) resultat.push({ numero: resultat.length + 1, lundi, vendredi });
      curseur = addDays(curseur, 7);
    }
    return resultat;
  }

  // -------------------------------------------------------- Génération
  /**
   * Remplit les affectations pour les niveaux donnés, sur l'ensemble des
   * semaines calculées. Les créneaux marqués manuel:true dans les
   * affectations existantes ne sont jamais écrasés. Les autres sont
   * recalculés depuis le début (pour rester cohérent si des séances ont
   * été ajoutées/retirées de la banque).
   */
  async function genererAffectations(niveaux, config, grilles, affectationsExistantes) {
    const banque = await chargerBanque();
    const semaines = calculerSemaines(config);
    const affectations = JSON.parse(JSON.stringify(affectationsExistantes || {}));

    niveaux.forEach(niveau => {
      affectations[niveau] = affectations[niveau] || {};
      const grille = (grilles[niveau] || []).filter(c => c.type === "seance");
      // Curseurs de consommation par domaine, en tenant compte des créneaux
      // déjà affectés manuellement (on ne les redistribue pas).
      const dejaUtilises = new Set();
      Object.entries(affectations[niveau]).forEach(([cle, aff]) => {
        if (aff && aff.manuel && aff.seanceId) dejaUtilises.add(aff.seanceId);
      });
      const curseurs = {}; // domaineCle -> index dans la file
      function prochaineSeance(domaineCle) {
        const bucket = (banque[niveau] && banque[niveau][domaineCle]) || { items: [] };
        if (curseurs[domaineCle] === undefined) curseurs[domaineCle] = 0;
        while (curseurs[domaineCle] < bucket.items.length) {
          const it = bucket.items[curseurs[domaineCle]];
          curseurs[domaineCle]++;
          if (!dejaUtilises.has(it.id)) { dejaUtilises.add(it.id); return it; }
        }
        return null;
      }

      semaines.forEach(sem => {
        JOURS.forEach(j => {
          const jourDate = addDays(sem.lundi, j.n - 1);
          const iso = dateISO(jourDate);
          grille
            .filter(c => c.jour === j.n)
            .sort((a, b) => heureVersMin(a.debut) - heureVersMin(b.debut))
            .forEach(creneau => {
              const cle = cleCreneau(iso, creneau.id);
              const existant = affectations[niveau][cle];
              if (existant && existant.manuel) return; // ne jamais écraser un choix manuel
              const seance = prochaineSeance(creneau.domaineCle);
              affectations[niveau][cle] = seance
                ? { seanceId: seance.id, source: seance.source, fichier: seance.fichier || null, domaineCle: creneau.domaineCle, manuel: false }
                : { seanceId: null, domaineCle: creneau.domaineCle, manuel: false };
            });
        });
      });
    });
    return affectations;
  }

  global.PlanningCore = {
    NIVEAUX, JOURS, TYPES_CRENEAU,
    STORE_CONFIG, STORE_GRILLES, STORE_AFFECT,
    slug, uid, parseNumero, dateISO, parseISO, addDays, mondayOfWeek,
    formatDateLong, formatDateShort, heureVersMin,
    chargerBanque, chargerDerouleDeItem,
    chargerConfig, sauverConfig,
    chargerGrilles, sauverGrilles,
    chargerAffectations, sauverAffectations,
    cleCreneau, calculerSemaines, genererAffectations
  };
})(window);
