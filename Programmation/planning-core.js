/**
 * planning-core.js
 * ---------------------------------------------------------------------------
 * Logique partagée entre planning-gestion.html et planning-affichage.html.
 *
 * ARCHITECTURE SYNAPSES
 *
 * 1. Référentiel officiel
 *    Programmation/data/index.json
 *    Programmation/data/competences.json
 *
 * 2. Bibliothèque de séquences / séances
 *    Les fichiers JSON référencés par index.json.
 *
 * 3. Planning personnel
 *    Stockage local temporaire + possibilité de synchronisation explicite
 *    avec un dossier choisi par l'utilisateur sur une clé USB.
 *
 * IMPORTANT :
 * Les compétences officielles ne sont jamais modifiées par ce fichier.
 * ---------------------------------------------------------------------------
 */

(function (global) {
  'use strict';

  // ========================================================================
  // CONSTANTES
  // ========================================================================

  const NIVEAUX = ["CP", "CE1", "CE2", "CM1", "CM2"];

  // Catalogue des niveaux disponibles pour créer une classe (configuration
  // générale). Une classe est une entité propre (ex. "CE2 A", "CE2 B") : deux
  // classes peuvent partager le même niveau pédagogique sans partager le
  // même emploi du temps ni la même récréation.
  const NIVEAUX_DISPONIBLES = ["TPS", "PS", "MS", "GS", "CP", "CE1", "CE2", "CM1", "CM2"];

  const PALETTE_CLASSES = ["#2E5EAA", "#B5502E", "#2A7F72", "#6B4E8E", "#B5871E", "#B23A5C", "#3F8C4B", "#8C5E2A", "#5B5F6B", "#1E2A4A"];

  const JOURS = [
    { n: 1, nom: "Lundi" },
    { n: 2, nom: "Mardi" },
    { n: 3, nom: "Mercredi" },
    { n: 4, nom: "Jeudi" },
    { n: 5, nom: "Vendredi" }
  ];

  const TYPES_CRENEAU = {
    seance: {
      label: "Séance",
      couleur: "#2E5EAA"
    },

    recreation: {
      label: "Récréation",
      couleur: "#B5871E"
    },

    pause: {
      label: "Pause méridienne",
      couleur: "#9A9689"
    },

    autre: {
      label: "Autre / rituel",
      couleur: "#5B5F6B"
    }
  };


  // ========================================================================
  // STOCKAGE LOCAL
  // ========================================================================

  const STORE_CONFIG =
    "synapses_planning_config";

  const STORE_GRILLES =
    "synapses_planning_grilles";

  const STORE_AFFECT =
    "synapses_planning_affectations";

  const STORE_JOURNAL =
    "synapses_planning_journal";

  const TYPES_ADULTE = [
    { id: "enseignant", label: "Enseignant" },
    { id: "aesh", label: "AESH" },
    { id: "atsem", label: "ATSEM" },
    { id: "autre", label: "Autre" }
  ];


  // ========================================================================
  // CLÉ USB
  // ========================================================================
  //
  // Le navigateur ne permet pas à une page web d'écrire directement sur
  // n'importe quelle clé USB.
  //
  // L'utilisateur doit donc sélectionner explicitement le dossier racine
  // de sa clé avec showDirectoryPicker().
  //
  // Structure créée :
  //
  // CLE USB/
  // ├── coffre.synapses
  // ├── sequences/
  // ├── planning/
  // │   └── planning.json
  // └── ...
  //
  // ========================================================================

  let usbRootHandle = null;


  /**
   * Demande à l'utilisateur de sélectionner le dossier racine.
   */
  async function connecterDossierUSB() {

    if (!window.showDirectoryPicker) {

      throw new Error(
        "L'accès direct aux dossiers n'est pas disponible " +
        "dans ce navigateur. Utilisez Chrome ou Edge sur ordinateur."
      );

    }

    usbRootHandle =
      await window.showDirectoryPicker({
        mode: "readwrite"
      });

    return usbRootHandle;
  }


  /**
   * Indique si un dossier USB a été connecté.
   */
  function dossierUSBConnecte() {

    return !!usbRootHandle;

  }


  /**
   * Récupère un sous-dossier.
   */
  async function obtenirDossierUSB(
    nom,
    creer = true
  ) {

    if (!usbRootHandle) {

      throw new Error(
        "Aucun dossier USB n'est connecté."
      );

    }

    return await usbRootHandle.getDirectoryHandle(
      nom,
      {
        create: creer
      }
    );

  }


  /**
   * Écrit un fichier JSON.
   */
  async function ecrireJSONUSB(
    nom,
    donnees,
    dossier = null
  ) {

    const dir =
      dossier || usbRootHandle;

    if (!dir) {

      throw new Error(
        "Aucun dossier USB n'est connecté."
      );

    }

    const fichier =
      await dir.getFileHandle(
        nom,
        {
          create: true
        }
      );

    const writable =
      await fichier.createWritable();

    await writable.write(
      JSON.stringify(
        donnees,
        null,
        2
      )
    );

    await writable.close();

  }


  /**
   * Lit un fichier JSON.
   */
  async function lireJSONUSB(
    nom,
    dossier = null
  ) {

    const dir =
      dossier || usbRootHandle;

    if (!dir) {

      throw new Error(
        "Aucun dossier USB n'est connecté."
      );

    }

    const fichier =
      await dir.getFileHandle(nom);

    const file =
      await fichier.getFile();

    const texte =
      await file.text();

    return JSON.parse(texte);

  }


  /**
   * Sauvegarde complète du planning sur la clé.
   *
   * Fichier :
   *
   * planning/planning.json
   */
  async function sauverPlanningUSB(
    config,
    grilles,
    affectations
  ) {

    const planningDir =
      await obtenirDossierUSB(
        "planning",
        true
      );

    const paquet = {

      format:
        "synapses-planning",

      version:
        1,

      maj:
        new Date().toISOString(),

      config:
        config || {},

      grilles:
        grilles || {},

      affectations:
        affectations || {}

    };

    await ecrireJSONUSB(
      "planning.json",
      paquet,
      planningDir
    );

    return paquet;

  }


  /**
   * Charge le planning depuis la clé.
   */
  async function chargerPlanningUSB() {

    const planningDir =
      await obtenirDossierUSB(
        "planning",
        false
      );

    return await lireJSONUSB(
      "planning.json",
      planningDir
    );

  }


  // ========================================================================
  // OUTILS
  // ========================================================================

  function slug(str) {

    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      || "domaine";

  }


  function uid(prefix) {

    return (
      prefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 7)
    );

  }


  function parseNumero(n) {

    const v =
      parseFloat(
        String(n)
          .replace(",", ".")
      );

    return isNaN(v)
      ? 999
      : v;

  }


  function pad2(n) {

    return String(n)
      .padStart(2, "0");

  }


  function dateISO(d) {

    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate())
    );

  }


  function parseISO(s) {

    const parts =
      String(s || "")
        .split("-")
        .map(Number);

    if (parts.length !== 3) {

      return new Date(
        NaN
      );

    }

    return new Date(
      parts[0],
      parts[1] - 1,
      parts[2]
    );

  }


  function addDays(d, n) {

    const r =
      new Date(d);

    r.setDate(
      r.getDate() + n
    );

    return r;

  }


  function mondayOfWeek(d) {

    const r =
      new Date(d);

    const dow =
      (r.getDay() + 6) % 7;

    return addDays(
      r,
      -dow
    );

  }


  function formatDateLong(d) {

    return d.toLocaleDateString(
      "fr-FR",
      {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      }
    );

  }


  function formatDateShort(d) {

    return d.toLocaleDateString(
      "fr-FR",
      {
        day: "2-digit",
        month: "2-digit"
      }
    );

  }


  function heureVersMin(h) {

    const morceaux =
      String(h || "0:0")
        .split(":")
        .map(Number);

    const hh =
      morceaux[0] || 0;

    const mm =
      morceaux[1] || 0;

    return (
      hh * 60 +
      mm
    );

  }


  // ========================================================================
  // CHARGEMENT DES JSON
  // ========================================================================

  /**
   * Essaie plusieurs chemins jusqu'à trouver un JSON valide.
   */
  async function fetchFirst(candidats) {

    for (
      const chemin
      of candidats
    ) {

      try {

        const r =
          await fetch(
            chemin,
            {
              cache: "no-store"
            }
          );

        if (
          r.ok
        ) {

          return {

            data:
              await r.json(),

            chemin:
              chemin

          };

        }

      }
      catch (e) {

        // On essaie le chemin suivant.

      }

    }

    return null;

  }


  /**
   * Chemins possibles vers l'index.
   *
   * Le fichier planning-core.js est situé dans :
   *
   * Programmation/
   *
   * Donc le premier chemin est normalement :
   *
   * data/index.json
   */
  function candidatsIndex() {

    return [

      "data/index.json",

      "Programmation/data/index.json",

      "../Programmation/data/index.json",

      "../data/index.json"

    ];

  }


  /**
   * Détermine la base à utiliser pour les chemins de fichiers contenus
   * dans index.json.
   */
  function baseDe(cheminIndex) {

    return cheminIndex.replace(
      /data\/index\.json$/,
      ""
    );

  }


  // ========================================================================
  // BANQUE DE SÉANCES
  // ========================================================================

  /**
   * Charge les séances depuis :
   *
   * 1. index.json
   * 2. les fichiers JSON référencés
   * 3. les données locales créées par sequences.html
   *
   * Retour :
   *
   * {
   *   niveau: {
   *     domaine: {
   *       label: "...",
   *       items: [...]
   *     }
   *   }
   * }
   */
  async function chargerBanque() {

    const banque = {};


    function domaineDe(
      niveau,
      cle
    ) {

      if (!banque[niveau]) {

        banque[niveau] = {};

      }

      if (
        !banque[niveau][cle]
      ) {

        banque[niveau][cle] = {

          label:
            cle,

          items:
            []

        };

      }

      return banque[niveau][cle];

    }


    // ======================================================================
    // 1. FICHIERS DU DÉPÔT
    // ======================================================================

    const idx =
      await fetchFirst(
        candidatsIndex()
      );


    if (idx) {

      const base =
        baseDe(
          idx.chemin
        );


      for (
        const niv
        of (idx.data.niveaux || [])
      ) {

        for (
          const disc
          of (niv.disciplines || [])
        ) {

          for (
            const dom
            of (disc.domaines || [])
          ) {

            const cle =
              `${disc.id}::${dom.id}`;


            const bucket =
              domaineDe(
                niv.id,
                cle
              );


            bucket.label =
              `${disc.nom || disc.id} — ${dom.nom || dom.id}`;


            let ordre =
              0;


            for (
              const seq
              of (dom.sequences || [])
            ) {

              for (
                const sea
                of (seq.seances || [])
              ) {

                bucket.items.push({

                  id:
                    sea.id,

                  seqId:
                    seq.id,

                  seqTitre:
                    seq.titre || "",

                  numero:
                    sea.numero,

                  type:
                    sea.type || "",

                  titre:
                    sea.titre || "",

                  source:
                    "fichier",

                  fichier:
                    base + sea.fichier,

                  ordreSeq:
                    ordre

                });

              }

              ordre++;

            }

          }

        }

      }

    }


    // ======================================================================
    // 2. DONNÉES LOCALES
    // ======================================================================

    let seqs = [];
    let seas = [];


    try {

      seqs =
        JSON.parse(
          localStorage.getItem(
            "planif_sequences"
          )
        ) || [];

    }
    catch (e) {

      seqs = [];

    }


    try {

      seas =
        JSON.parse(
          localStorage.getItem(
            "planif_seances"
          )
        ) || [];

    }
    catch (e) {

      seas = [];

    }


    const seqById =
      new Map(
        seqs.map(
          s => [s.id, s]
        )
      );


    seqs.forEach(
      (s, i) => {

        s.__ordre =
          i;

      }
    );


    seas.forEach(
      sea => {

        const seq =
          seqById.get(
            sea.sequence_id
          );


        const niveau =
          (seq && seq.niveau) ||
          sea.classe ||
          NIVEAUX[0];


        const matiere =
          (seq && seq.matiere) ||
          "Français";


        const champ =
          (seq &&
            (
              seq.competence_id ||
              seq.domaine
            )
          ) ||
          "lecture";


        const cle =
          `${slug(matiere)}::${champ}`;


        const bucket =
          domaineDe(
            niveau,
            cle
          );


        if (
          bucket.label === cle
        ) {

          bucket.label =
            `${matiere} — ${champ}`;

        }


        bucket.items.push({

          id:
            sea.id,

          seqId:
            sea.sequence_id,

          seqTitre:
            (
              seq &&
              (
                seq.titre ||
                seq.nom
              )
            ) || "",

          numero:
            sea.numero,

          type:
            sea.type || "",

          titre:
            sea.titre || "",

          source:
            "local",

          deroule:
            sea.deroule || [],

          objectif_commun:
            sea.objectif_commun || "",

          problematique:
            sea.problematique || "",

          competence_cible:
            sea.competence_cible || "",

          ordreSeq:
            seq
              ? seq.__ordre
              : 999

        });

      }
    );


    // ======================================================================
    // TRI
    // ======================================================================

    Object
      .values(banque)
      .forEach(
        parNiveau => {

          Object
            .values(parNiveau)
            .forEach(
              bucket => {

                bucket.items.sort(
                  (a, b) => {

                    return (
                      a.ordreSeq -
                      b.ordreSeq
                    ) ||
                    (
                      parseNumero(a.numero) -
                      parseNumero(b.numero)
                    );

                  }
                );

              }
            );

        }
      );


    return banque;

  }


  // ========================================================================
  // CHARGEMENT DU DÉROULÉ
  // ========================================================================

  async function chargerDerouleDeItem(item) {

    if (
      item.source === "local"
    ) {

      return item;

    }


    const r =
      await fetch(
        item.fichier,
        {
          cache: "no-store"
        }
      );


    if (!r.ok) {

      throw new Error(
        "Fichier de séance introuvable : " +
        item.fichier
      );

    }


    const data =
      await r.json();


    return Object.assign(
      {},
      item,
      {

        deroule:
          data.deroule || [],

        objectif_commun:
          data.objectif_commun || "",

        problematique:
          data.problematique || "",

        competence_cible:
          data.competence_cible || "",

        modalites_generales:
          data.modalites_generales || "",

        vigilance:
          data.vigilance || "",

        titre:
          data.titre ||
          item.titre

      }
    );

  }


  // ========================================================================
  // CONFIGURATION
  // ========================================================================

  function chargerConfig() {

    try {

      const c =
        JSON.parse(
          localStorage.getItem(
            STORE_CONFIG
          )
        );


      if (c) {

        // Rétro-compatibilité : complète les champs ajoutés après coup
        // sans jamais écraser une config existante.
        if (!c.joursTravailles || !c.joursTravailles.length) c.joursTravailles = [1, 2, 3, 4, 5];
        if (!Array.isArray(c.recreations)) c.recreations = [
          { label: "Récréation matin", debut: "10:00", fin: "10:15", classes: [] }
        ];
        if (!Array.isArray(c.pauses)) c.pauses = [
          { label: "Pause méridienne", debut: "12:00", fin: "13:30", classes: [] }
        ];
        // Ancien modèle "niveauxActifs" (CP/CE1/CE2…) -> nouveau modèle
        // "classes" (entités propres, ex. deux CE2 distincts). On migre une
        // seule fois : chaque niveau actif devient une classe portant ce
        // niveau comme nom par défaut.
        if (!Array.isArray(c.classes)) {
          c.classes = (c.niveauxActifs || []).map((n, i) => ({
            id: uid("cls"), nom: n, niveau: n, couleur: PALETTE_CLASSES[i % PALETTE_CLASSES.length]
          }));
        }
        c.classes.forEach((cl, i) => {
          if (!cl.id) cl.id = uid("cls");
          if (!cl.couleur) cl.couleur = PALETTE_CLASSES[i % PALETTE_CLASSES.length];
          if (!cl.nom) cl.nom = cl.niveau || "Classe";
        });
        // Migration des récréations/pauses sans champ `classes` : réputées
        // s'appliquer à toutes les classes (comportement historique).
        c.recreations.forEach(r => { if (!Array.isArray(r.classes)) r.classes = []; });
        c.pauses.forEach(p => { if (!Array.isArray(p.classes)) p.classes = []; });

        return c;

      }

    }
    catch (e) {

      // Configuration absente ou invalide.

    }


    return {

      rentree:
        "",

      semaines:
        36,

      vacances:
        [],

      // Classes créées par l'enseignant (configuration générale). Chaque
      // classe = { id, nom, niveau, couleur }. Remplace l'ancien
      // "niveauxActifs" : deux classes du même niveau (ex. deux CE2)
      // peuvent avoir des récréations et des grilles horaires différentes.
      classes:
        [],

      // Jours de la semaine travaillés (1=lundi … 5=vendredi).
      joursTravailles:
        [1, 2, 3, 4, 5],

      // Récréations et pauses méridiennes : pensées à l'échelle de l'école,
      // donc définies une seule fois ici, avec la liste des classes
      // concernées par chaque service (`classes: []` = toutes les classes).
      // Plusieurs entrées = plusieurs récréations (matin/après-midi) ou
      // plusieurs services de pause méridienne (par ex. un service par
      // groupe de classes).
      recreations:
        [{ label: "Récréation matin", debut: "10:00", fin: "10:15", classes: [] }],

      pauses:
        [{ label: "Pause méridienne", debut: "12:00", fin: "13:30", classes: [] }]

    };

  }


  function sauverConfig(c) {

    localStorage.setItem(
      STORE_CONFIG,
      JSON.stringify(c)
    );

  }


  // ------------------------------------------------------------------------
  // Classes (configuration générale)
  // ------------------------------------------------------------------------

  function chargerClasses(config) {
    config = config || chargerConfig();
    return config.classes || [];
  }

  function creerClasse(config, nom, niveau) {
    const cl = {
      id: uid("cls"),
      nom: (nom || niveau || "Classe").trim(),
      niveau: niveau || "",
      couleur: PALETTE_CLASSES[config.classes.length % PALETTE_CLASSES.length]
    };
    config.classes.push(cl);
    return cl;
  }

  function supprimerClasse(config, classeId, grilles, affectations) {
    config.classes = config.classes.filter(c => c.id !== classeId);
    config.recreations.forEach(r => { r.classes = (r.classes || []).filter(id => id !== classeId); });
    config.pauses.forEach(p => { p.classes = (p.classes || []).filter(id => id !== classeId); });
    if (grilles) delete grilles[classeId];
    if (affectations) delete affectations[classeId];
  }

  function classeById(config, classeId) {
    return (config.classes || []).find(c => c.id === classeId) || null;
  }

  /** Identifiants des classes concernées par un service (récréation/pause) :
   *  `def.classes` vide ou absent = toutes les classes de la config. */
  function classesDuService(config, def) {
    if (def.classes && def.classes.length) return def.classes;
    return (config.classes || []).map(c => c.id);
  }


  // ------------------------------------------------------------------------
  // Export / import de la configuration du planning (fichier .json)
  // ------------------------------------------------------------------------
  // Contient : classes, jours travaillés, récréations/pauses, rentrée,
  // nombre de semaines et vacances — c'est-à-dire tout ce qui se règle
  // dans les onglets "Configuration générale" et "Jours travaillés &
  // horaires fixes". Les grilles horaires détaillées par classe ne sont
  // PAS incluses ici (elles se gèrent séparément, onglet par onglet) afin
  // de garder ce fichier court et facilement partageable entre collègues.
  function exporterConfigJSON(config) {
    const payload = {
      type: "synapses-planning-config",
      version: 1,
      exporteLe: new Date().toISOString(),
      rentree: config.rentree,
      semaines: config.semaines,
      vacances: config.vacances,
      classes: config.classes,
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

  /** Fusionne un fichier de configuration importé dans la config courante.
   *  Remplace entièrement classes / jours / récréations / pauses / calendrier
   *  (import "franc" plutôt que fusion silencieuse, pour rester prévisible). */
  function importerConfigJSON(config, payload) {
    if (!payload || typeof payload !== "object") throw new Error("Fichier de configuration invalide.");
    if (Array.isArray(payload.classes)) config.classes = payload.classes.map(c => ({
      id: c.id || uid("cls"), nom: c.nom || c.niveau || "Classe", niveau: c.niveau || "", couleur: c.couleur || PALETTE_CLASSES[0]
    }));
    if (typeof payload.rentree === "string") config.rentree = payload.rentree;
    if (typeof payload.semaines === "number") config.semaines = payload.semaines;
    if (Array.isArray(payload.vacances)) config.vacances = payload.vacances;
    if (Array.isArray(payload.joursTravailles) && payload.joursTravailles.length) config.joursTravailles = payload.joursTravailles;
    if (Array.isArray(payload.recreations)) config.recreations = payload.recreations.map(r => ({ label: r.label || "Récréation", debut: r.debut, fin: r.fin, classes: r.classes || [] }));
    if (Array.isArray(payload.pauses)) config.pauses = payload.pauses.map(p => ({ label: p.label || "Pause méridienne", debut: p.debut, fin: p.fin, classes: p.classes || [] }));
    return config;
  }


  // ========================================================================
  // GRILLES
  // ========================================================================

  function chargerGrilles() {

    try {

      return (
        JSON.parse(
          localStorage.getItem(
            STORE_GRILLES
          )
        ) || {}
      );

    }
    catch (e) {

      return {};

    }

  }


  function sauverGrilles(g) {

    localStorage.setItem(
      STORE_GRILLES,
      JSON.stringify(g)
    );

  }

  // ------------------------------------------------------------------------
  // Récréations / pauses "fixes", pilotées depuis la configuration générale
  // ------------------------------------------------------------------------
  //
  // Plutôt que de les saisir créneau par créneau et niveau par niveau, on les
  // définit une fois (config.recreations / config.pauses) et on les
  // applique automatiquement à chaque niveau, sur chaque jour travaillé.
  // Chaque occurrence générée porte un identifiant stable
  // ("fixe_<niveau>_<jour>_<type>_<index>") pour pouvoir être mise à jour à
  // l'identique plutôt que dupliquée si on relance l'application, et pour
  // être proprement retirée si le nombre d'occurrences ou les jours
  // travaillés changent ensuite.
  //
  function upsertCreneauFixe(liste, classeId, jour, type, index, def) {
    const id = "fixe_" + classeId + "_" + jour + "_" + type + "_" + index;
    let c = liste.find(x => x.id === id);
    if (!c) {
      c = { id: id, jour: jour, debut: def.debut, fin: def.fin, type: type, libelle: def.label || "", domaineCle: "" };
      liste.push(c);
    } else {
      c.debut = def.debut;
      c.fin = def.fin;
      c.libelle = def.label || "";
    }
    return c;
  }

  /**
   * Applique les récréations / pauses méridiennes (pensées à l'échelle de
   * l'école, définies une seule fois dans la configuration générale) à la
   * grille de chaque classe concernée. Une classe absente de `def.classes`
   * (ou `def.classes` vide = toutes les classes) ne reçoit pas ce créneau :
   * c'est ce qui permet à deux CE2 de ne pas partager la même récréation.
   */
  function appliquerCreneauxFixes(config, grilles, classeIds) {
    const toutesLesClasses = (config.classes || []).map(c => c.id);
    classeIds = (classeIds && classeIds.length) ? classeIds : toutesLesClasses;
    const jours = (config.joursTravailles && config.joursTravailles.length) ? config.joursTravailles : [1, 2, 3, 4, 5];
    const recreations = config.recreations || [];
    const pauses = config.pauses || [];

    classeIds.forEach(classeId => {
      grilles[classeId] = grilles[classeId] || [];

      jours.forEach(j => {
        recreations.forEach((def, idx) => {
          if (!classesDuService(config, def).includes(classeId)) return;
          upsertCreneauFixe(grilles[classeId], classeId, j, "recreation", idx, def);
        });
        pauses.forEach((def, idx) => {
          if (!classesDuService(config, def).includes(classeId)) return;
          upsertCreneauFixe(grilles[classeId], classeId, j, "pause", idx, def);
        });
      });

      // Retire les occurrences fixes devenues obsolètes : jour non
      // travaillé, classe retirée du service, ou index au-delà du nombre
      // de récréations/pauses défini.
      grilles[classeId] = grilles[classeId].filter(c => {
        if (!c.id || c.id.indexOf("fixe_" + classeId + "_") !== 0) return true;
        const parts = c.id.split("_"); // ["fixe", classeId, jour, type, index]
        const jr = +parts[2], typ = parts[3], idx = +parts[4];
        if (jours.indexOf(jr) === -1) return false;
        const liste = (typ === "recreation" ? recreations : pauses);
        if (idx >= liste.length) return false;
        return classesDuService(config, liste[idx]).includes(classeId);
      });
    });

    return grilles;
  }


  // ========================================================================
  // AFFECTATIONS
  // ========================================================================

  function chargerAffectations() {

    try {

      return (
        JSON.parse(
          localStorage.getItem(
            STORE_AFFECT
          )
        ) || {}
      );

    }
    catch (e) {

      return {};

    }

  }


  function sauverAffectations(a) {

    localStorage.setItem(
      STORE_AFFECT,
      JSON.stringify(a)
    );

  }


  function cleCreneau(
    dateStr,
    creneauId
  ) {

    return (
      dateStr +
      "__" +
      creneauId
    );

  }


  // ========================================================================
  // CAHIER JOURNAL (vue à la journée)
  // ========================================================================
  //
  // Une entrée de journal, par date ISO :
  // {
  //   date: "2026-05-25",
  //   remarque: "...",
  //   devoirs: "...",
  //   libellesBlocs: { "09:00|09:30": "Matin 1", ... },   // libellés de bloc personnalisés
  //   exclusions: ["CE1__cr_ab12"],                        // origines retirées à la main
  //   groupes: [
  //     {
  //       id, debut, fin,
  //       origine: "CE1__cr_ab12" | null,   // lien vers le créneau de grille d'origine (null = ajouté à la main)
  //       modifie: false,                    // dès que l'enseignant retouche titre/adulte/horaire : plus jamais resynchronisé
  //       adulte: { type: "enseignant"|"aesh"|"atsem"|"autre", nom: "Vincent" } | null,
  //       titre: "Numération",
  //       domaineCle: "maths::numeration",
  //       niveau: "CE1",
  //       seanceRef: { id, source, fichier } | null,
  //       eleves: ["ELEVE-0042", ...],
  //       remarque: "",
  //       fixe: false            // true pour récréation / pause (pas d'adulte ni d'élèves)
  //     }, ...
  //   ]
  // }
  //
  // Les groupes d'un même horaire (debut/fin identiques) sont affichés côte
  // à côte comme des colonnes parallèles (cf. cahier journal ULIS papier) ;
  // ce regroupement est calculé à l'affichage, pas persisté en imbrication,
  // ce qui permet de suivre chaque groupe individuellement.
  //
  // PRIORITÉ DE SYNCHRONISATION (du plus fort au plus faible) :
  //   1. Cahier journal  — un groupe marqué "modifie" n'est plus jamais
  //      touché par une resynchronisation automatique depuis la grille.
  //   2. Planning (affectations) — une séance affectée manuellement dans
  //      Planning — Affichage (aff.manuel = true) est reprise telle quelle.
  //   3. Planning — Gestion (grille) — sert de valeur par défaut tant que
  //      rien de plus prioritaire ne l'a supplantée.
  //
  // Le journal reste 100% local (localStorage) : aucune identité d'élève
  // n'y est stockée, seulement des identifiants Synapses (ELEVE-xxxx), donc
  // rien de nominatif ne transite. Le rapprochement avec les vrais noms se
  // fait en mémoire, uniquement si le coffre est ouvert dans l'onglet.
  // ========================================================================

  function chargerJournal() {
    try {
      return JSON.parse(localStorage.getItem(STORE_JOURNAL)) || {};
    } catch (e) {
      return {};
    }
  }

  function sauverJournal(j) {
    localStorage.setItem(STORE_JOURNAL, JSON.stringify(j));
  }

  function journalPourDate(iso, journal) {
    journal = journal || chargerJournal();
    if (!journal[iso]) {
      journal[iso] = { date: iso, remarque: "", devoirs: "", libellesBlocs: {}, exclusions: [], groupes: [] };
    }
    // Rétro-compatibilité avec l'ancien format imbriqué (creneaux[].groupes[]).
    if (journal[iso].creneaux && !journal[iso].groupes) {
      const plat = [];
      journal[iso].creneaux.forEach(bloc => {
        (bloc.groupes || []).forEach(g => {
          plat.push(Object.assign({ debut: bloc.debut, fin: bloc.fin, origine: null, modifie: false }, g));
        });
      });
      journal[iso] = {
        date: iso,
        remarque: journal[iso].remarque || "",
        devoirs: journal[iso].devoirs || "",
        libellesBlocs: {},
        exclusions: [],
        groupes: plat
      };
    }
    journal[iso].libellesBlocs = journal[iso].libellesBlocs || {};
    journal[iso].exclusions = journal[iso].exclusions || [];
    journal[iso].groupes = journal[iso].groupes || [];
    return journal[iso];
  }

  function cleBloc(debut, fin) { return debut + "|" + fin; }

  /** Regroupe les groupes d'un jour par plage horaire, triés par heure. */
  function regrouperParBloc(jourJournal) {
    const parCle = new Map();
    jourJournal.groupes.forEach(g => {
      const cle = cleBloc(g.debut, g.fin);
      if (!parCle.has(cle)) parCle.set(cle, { debut: g.debut, fin: g.fin, cle: cle, groupes: [] });
      parCle.get(cle).groupes.push(g);
    });
    return Array.from(parCle.values()).sort((a, b) => heureVersMin(a.debut) - heureVersMin(b.debut));
  }

  function libelleBlocDefaut(debut) {
    const h = heureVersMin(debut);
    if (h < 10 * 60 + 30) return "Matin 1";
    if (h < 12 * 60) return "Matin 2";
    if (h < 15 * 60) return "Après-midi 1";
    return "Après-midi 2";
  }

  function libelleBloc(jourJournal, debut, fin) {
    return jourJournal.libellesBlocs[cleBloc(debut, fin)] || libelleBlocDefaut(debut);
  }

  /**
   * Synchronise le journal d'un jour avec la grille horaire hebdomadaire
   * (et les affectations de séances) de chaque niveau actif.
   *
   * Peut être appelée à chaque ouverture de la page (elle est sans danger) :
   *  - un groupe jamais retouché par l'enseignant ("modifie" = false) est
   *    mis à jour pour refléter la grille/l'affectation actuelles
   *    (horaire, titre, domaine, séance affectée) ;
   *  - un groupe retouché ("modifie" = true) n'est JAMAIS modifié par cette
   *    fonction, conformément à la priorité « cahier journal » ;
   *  - un groupe manuellement supprimé par l'enseignant (son origine est
   *    dans jour.exclusions) n'est jamais recréé ;
   *  - un groupe dont le créneau de grille d'origine a disparu (supprimé
   *    dans Planning — Gestion) est retiré automatiquement, sauf s'il a été
   *    modifié (auquel cas il est conservé, orphelin, plutôt que perdu).
   *  - les groupes ajoutés à la main (origine = null) ne sont jamais touchés.
   */
  function genererJournalDepuisGrille(iso, config, grilles, affectations, banque) {
    const journal = chargerJournal();
    const jour = journalPourDate(iso, journal);
    const jourDate = parseISO(iso);
    const jourSemaine = (jourDate.getDay() + 6) % 7 + 1; // 1=lundi

    const classes = (config.classes && config.classes.length) ? config.classes : [];

    const parOrigine = new Map();
    jour.groupes.forEach(g => { if (g.origine) parOrigine.set(g.origine, g); });

    const originesVues = new Set();

    classes.forEach(classe => {
      const classeId = classe.id;
      const grille = (grilles[classeId] || []).filter(c => c.jour === jourSemaine);
      grille.forEach(c => {
        const origine = classeId + "__" + c.id;
        if (jour.exclusions.indexOf(origine) !== -1) return; // retiré à la main : on respecte ce choix
        originesVues.add(origine);

        const existant = parOrigine.get(origine);
        if (existant && existant.modifie) return; // priorité au cahier journal : on ne touche à rien

        if (c.type !== "seance") {
          const titre = (c.libelle && c.libelle.trim()) ? c.libelle.trim() : TYPES_CRENEAU[c.type].label;
          if (existant) {
            existant.debut = c.debut; existant.fin = c.fin; existant.titre = titre;
          } else {
            jour.groupes.push({
              id: uid("grp"), debut: c.debut, fin: c.fin, origine: origine, modifie: false,
              adulte: null, titre: titre, domaineCle: "", niveau: classe.nom, classeId: classeId, seanceRef: null,
              eleves: [], remarque: "", fixe: true
            });
          }
          return;
        }

        const aff = (affectations[classeId] || {})[cleCreneau(iso, c.id)];
        const bucket = (banque[classe.niveau] && banque[classe.niveau][c.domaineCle]) || null;
        const item = (aff && aff.seanceId && bucket) ? bucket.items.find(it => it.id === aff.seanceId) : null;
        const titre = (item && (item.titre || item.type)) || (bucket ? bucket.label : c.domaineCle);

        if (existant) {
          existant.debut = c.debut; existant.fin = c.fin; existant.titre = titre;
          existant.domaineCle = c.domaineCle; existant.niveau = classe.nom; existant.classeId = classeId;
          existant.seanceRef = item ? { id: item.id, source: item.source, fichier: item.fichier || null } : null;
        } else {
          jour.groupes.push({
            id: uid("grp"), debut: c.debut, fin: c.fin, origine: origine, modifie: false,
            adulte: { type: "enseignant", nom: "" }, titre: titre, domaineCle: c.domaineCle, niveau: classe.nom, classeId: classeId,
            seanceRef: item ? { id: item.id, source: item.source, fichier: item.fichier || null } : null,
            eleves: [], remarque: "", fixe: false
          });
        }
      });
    });

    // Nettoyage : un groupe synchronisé (origine non nulle) dont le créneau
    // de grille a disparu, et qui n'a jamais été retouché, est retiré.
    jour.groupes = jour.groupes.filter(g => !g.origine || originesVues.has(g.origine) || g.modifie);

    sauverJournal(journal);
    return jour;
  }

  /**
   * Répartition automatique des élèves dans les groupes d'un jour, à
   * partir des besoins/objectifs actifs lus dans le coffre ouvert.
   *
   * Principe (le système suggère, l'enseignant valide) :
   *  - Pour chaque plage horaire, on regarde les groupes "séance" (non figés).
   *  - Chaque élève du coffre est rapproché du groupe dont le domaineCle
   *    correspond le mieux à ses besoins/objectifs actifs (correspondance
   *    de préfixe sur la discipline, ex. "maths" ~ "mathematiques").
   *  - À défaut de correspondance, l'élève est réparti sur le groupe le
   *    moins chargé de la plage (équilibrage), pour qu'aucun groupe ne soit vide.
   *  - Un élève déjà placé (présent dans un groupe de la plage) n'est pas
   *    déplacé : on ne redistribue que les élèves absents de tous les
   *    groupes de cette plage horaire.
   */
  function repartirElevesAuto(iso, journalJour, coffre) {
    if (!coffre || !coffre.ouvert) return journalJour;
    const eleves = coffre.listerEleves ? coffre.listerEleves() : [];
    if (!eleves.length) return journalJour;

    function besoinsEtObjectifs(e) {
      const b = (e.besoins || []).map(x => String(x.domaine || x.champ || x.hypothese || "").toLowerCase());
      const o = (e.objectifs || [])
        .filter(x => !x.statut || x.statut === "actif")
        .map(x => String(x.domaine || x.libelle || x.contexte || "").toLowerCase());
      return b.concat(o);
    }

    regrouperParBloc(journalJour).forEach(bloc => {
      const groupesSeance = bloc.groupes.filter(g => !g.fixe);
      if (!groupesSeance.length) return;

      const dejaPlaces = new Set();
      groupesSeance.forEach(g => (g.eleves || []).forEach(id => dejaPlaces.add(id)));

      eleves.forEach(e => {
        const id = e.identifiantSynapses;
        if (dejaPlaces.has(id)) return;

        const mots = besoinsEtObjectifs(e);
        let meilleur = null, meilleurScore = -1;
        groupesSeance.forEach(g => {
          const cle = String(g.domaineCle || g.titre || "").toLowerCase();
          let score = 0;
          mots.forEach(m => {
            if (!m) return;
            if (cle.indexOf(m.slice(0, 4)) !== -1 || m.indexOf(cle.split("::")[0] || cle) !== -1) score++;
          });
          if (score > meilleurScore) { meilleurScore = score; meilleur = g; }
        });

        if (meilleurScore <= 0) {
          // Aucune correspondance : on équilibre sur le groupe le moins chargé.
          meilleur = groupesSeance.reduce((min, g) => ((g.eleves||[]).length < (min.eleves||[]).length ? g : min), groupesSeance[0]);
        }
        if (meilleur) { meilleur.eleves = meilleur.eleves || []; meilleur.eleves.push(id); dejaPlaces.add(id); }
      });
    });

    const journal = chargerJournal();
    journal[iso] = journalJour;
    sauverJournal(journal);
    return journalJour;
  }

  // ========================================================================
  // IMPORT / EXPORT JSON DU PLANNING (fichier téléchargeable, hors USB)
  // ========================================================================

  function exporterPlanningJSON(config, grilles, affectations, journal) {
    return {
      format: "synapses-planning",
      version: 2,
      maj: new Date().toISOString(),
      config: config || {},
      grilles: grilles || {},
      affectations: affectations || {},
      journal: journal || {}
    };
  }

  function telechargerPlanningJSON(config, grilles, affectations, journal) {
    const paquet = exporterPlanningJSON(config, grilles, affectations, journal);
    const blob = new Blob([JSON.stringify(paquet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "synapses-planning-" + dateISO(new Date()) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return paquet;
  }

  function lireFichierJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); }
        catch (e) { reject(new Error("Fichier JSON invalide.")); }
      };
      reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
      reader.readAsText(file);
    });
  }

  /**
   * Applique un paquet importé (fichier .json exporté par Synapses) au
   * stockage local courant. Retourne un résumé des parties appliquées.
   */
  function appliquerPaquetPlanning(paquet) {
    if (!paquet || paquet.format !== "synapses-planning") {
      throw new Error("Ce fichier ne semble pas être un export de planning Synapses.");
    }
    const applique = [];
    if (paquet.config) { sauverConfig(paquet.config); applique.push("configuration"); }
    if (paquet.grilles) { sauverGrilles(paquet.grilles); applique.push("grilles horaires"); }
    if (paquet.affectations) { sauverAffectations(paquet.affectations); applique.push("affectations"); }
    if (paquet.journal) { sauverJournal(paquet.journal); applique.push("cahier journal"); }
    return applique;
  }

  // ========================================================================
  // CALENDRIER
  // ========================================================================

  function estEnVacances(
    lundi,
    vendredi,
    vacances
  ) {

    return (
      vacances || []
    ).some(
      v => {

        const debut =
          parseISO(v.debut);

        const fin =
          parseISO(v.fin);


        return (
          lundi <= fin &&
          vendredi >= debut
        );

      }
    );

  }


  /**
   * Calcule les semaines de classe.
   */
  function calculerSemaines(
    config
  ) {

    const resultat = [];


    if (
      !config ||
      !config.rentree
    ) {

      return resultat;

    }


    let curseur =
      mondayOfWeek(
        parseISO(
          config.rentree
        )
      );


    const nb =
      config.semaines ||
      36;


    let garde =
      0;


    while (
      resultat.length < nb &&
      garde < nb + 30
    ) {

      garde++;


      const lundi =
        curseur;


      const vendredi =
        addDays(
          curseur,
          4
        );


      const vac =
        estEnVacances(
          lundi,
          vendredi,
          config.vacances
        );


      if (!vac) {

        resultat.push({

          numero:
            resultat.length + 1,

          lundi:
            lundi,

          vendredi:
            vendredi

        });

      }


      curseur =
        addDays(
          curseur,
          7
        );

    }


    return resultat;

  }


  // ========================================================================
  // GÉNÉRATION DES AFFECTATIONS
  // ========================================================================

  /**
   * Génère automatiquement les séances dans les créneaux correspondants.
   *
   * Les affectations marquées manuel:true sont conservées.
   */
  async function genererAffectations(
    classes,
    config,
    grilles,
    affectationsExistantes
  ) {

    const banque =
      await chargerBanque();


    const semaines =
      calculerSemaines(
        config
      );


    const affectations =
      JSON.parse(
        JSON.stringify(
          affectationsExistantes || {}
        )
      );


    classes.forEach(
      classe => {

        const niveau = classe.id; // clé de grilles/affectations = identifiant de la classe

        affectations[niveau] =
          affectations[niveau] ||
          {};


        const grille =
          (
            grilles[niveau] ||
            []
          )
          .filter(
            c =>
              c.type === "seance"
          );


        // --------------------------------------------------------------
        // Séances déjà utilisées manuellement
        // --------------------------------------------------------------

        const dejaUtilises =
          new Set();


        Object.entries(
          affectations[niveau]
        ).forEach(
          ([cle, aff]) => {

            if (
              aff &&
              aff.manuel &&
              aff.seanceId
            ) {

              dejaUtilises.add(
                aff.seanceId
              );

            }

          }
        );


        // --------------------------------------------------------------
        // Curseurs
        // --------------------------------------------------------------

        const curseurs = {};


        function prochaineSeance(
          domaineCle
        ) {

          const bucket =
            (
              banque[classe.niveau] &&
              banque[classe.niveau][domaineCle]
            ) ||
            {
              items: []
            };


          if (
            curseurs[domaineCle] ===
            undefined
          ) {

            curseurs[domaineCle] =
              0;

          }


          while (
            curseurs[domaineCle] <
            bucket.items.length
          ) {

            const it =
              bucket.items[
                curseurs[domaineCle]
              ];


            curseurs[domaineCle]++;


            if (
              !dejaUtilises.has(
                it.id
              )
            ) {

              dejaUtilises.add(
                it.id
              );

              return it;

            }

          }


          return null;

        }


        // --------------------------------------------------------------
        // Parcours des semaines
        // --------------------------------------------------------------

        semaines.forEach(
          sem => {

            JOURS.forEach(
              j => {

                const jourDate =
                  addDays(
                    sem.lundi,
                    j.n - 1
                  );


                const iso =
                  dateISO(
                    jourDate
                  );


                grille
                  .filter(
                    c =>
                      c.jour === j.n
                  )
                  .sort(
                    (a, b) =>
                      heureVersMin(a.debut) -
                      heureVersMin(b.debut)
                  )
                  .forEach(
                    creneau => {

                      const cle =
                        cleCreneau(
                          iso,
                          creneau.id
                        );


                      const existant =
                        affectations[niveau][cle];


                      // Une modification manuelle ne doit jamais être
                      // écrasée par la génération automatique.

                      if (
                        existant &&
                        existant.manuel
                      ) {

                        return;

                      }


                      const seance =
                        prochaineSeance(
                          creneau.domaineCle
                        );


                      if (seance) {

                        affectations[niveau][cle] = {

                          seanceId:
                            seance.id,

                          source:
                            seance.source,

                          fichier:
                            seance.fichier ||
                            null,

                          domaineCle:
                            creneau.domaineCle,

                          manuel:
                            false

                        };

                      }
                      else {

                        affectations[niveau][cle] = {

                          seanceId:
                            null,

                          domaineCle:
                            creneau.domaineCle,

                          manuel:
                            false

                        };

                      }

                    }
                  );

              }
            );

          }
        );

      }
    );


    return affectations;

  }


  // ========================================================================
  // API PUBLIQUE
  // ========================================================================

  global.PlanningCore = {

    // Constantes
    NIVEAUX,
    JOURS,
    TYPES_CRENEAU,
    TYPES_ADULTE,

    // Stockage
    STORE_CONFIG,
    STORE_GRILLES,
    STORE_AFFECT,
    STORE_JOURNAL,

    // Utilitaires
    slug,
    uid,
    parseNumero,
    dateISO,
    parseISO,
    addDays,
    mondayOfWeek,
    formatDateLong,
    formatDateShort,
    heureVersMin,

    // Banque
    chargerBanque,
    chargerDerouleDeItem,

    // Configuration
    chargerConfig,
    sauverConfig,
    exporterConfigJSON,
    importerConfigJSON,

    // Classes (configuration générale)
    NIVEAUX_DISPONIBLES,
    PALETTE_CLASSES,
    chargerClasses,
    creerClasse,
    supprimerClasse,
    classeById,
    classesDuService,

    // Grilles
    chargerGrilles,
    sauverGrilles,
    appliquerCreneauxFixes,

    // Affectations
    chargerAffectations,
    sauverAffectations,

    // Calendrier
    cleCreneau,
    calculerSemaines,

    // Génération
    genererAffectations,

    // Cahier journal
    chargerJournal,
    sauverJournal,
    journalPourDate,
    cleBloc,
    regrouperParBloc,
    libelleBloc,
    genererJournalDepuisGrille,
    repartirElevesAuto,

    // Import / export JSON
    exporterPlanningJSON,
    telechargerPlanningJSON,
    lireFichierJSON,
    appliquerPaquetPlanning,

    // Clé USB
    connecterDossierUSB,
    dossierUSBConnecte,
    obtenirDossierUSB,
    ecrireJSONUSB,
    lireJSONUSB,
    sauverPlanningUSB,
    chargerPlanningUSB

  };


})(window);
