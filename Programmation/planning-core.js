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

  // Référentiel horaire officiel — arrêté du 9-11-2015 (BO n°44 du
  // 26/11/2015, MENE1526553A) : horaires d'enseignement à l'école
  // élémentaire, 24 h de classe par semaine.
  // https://www.education.gouv.fr/bo/15/Hebdo44/MENE1526553A.htm
  //
  // Utilisé pour :
  //  - vérifier le volume horaire des classes (déjà utilisé pour
  //    français/mathématiques dans repartirElevesSemaineAuto) ;
  //  - construire les groupes de besoin ULIS (élèves du coffre non
  //    affectés à une classe) sur les créneaux libres du cahier journal,
  //    en visant le même volume horaire hebdomadaire par domaine que
  //    leurs pairs, au prorata de leur équivalence scolaire.
  //
  // Valeurs en minutes / semaine.
  const BO_VOLUMES_HEBDO = {
    cycle2: { // CP, CE1, CE2
      francais: 600,              // 10 h
      mathematiques: 300,         // 5 h
      eps: 180,                   // 3 h
      languesVivantes: 90,        // 1 h 30
      artsEducationMusicale: 120, // 2 h (arts plastiques + éducation musicale)
      emc: 30,                    // 0 h 30
      questionnerLeMonde: 120     // 2 h
    },
    cycle3: { // CM1, CM2
      francais: 480,              // 8 h
      mathematiques: 300,         // 5 h
      eps: 180,                   // 3 h
      languesVivantes: 90,        // 1 h 30
      artsEducationMusicale: 120, // 2 h
      emc: 30,                    // 0 h 30
      histoireGeographie: 120,    // 2 h
      sciencesTechnologie: 120    // 2 h
    }
  };

  function cycleDuNiveau(niveau) {
    const n = String(niveau || "").toUpperCase();
    if (["CP", "CE1", "CE2"].indexOf(n) !== -1) return "cycle2";
    if (["CM1", "CM2"].indexOf(n) !== -1) return "cycle3";
    return null; // TPS/PS/MS/GS (cycle 1) : hors grille horaire BO n°44
  }

  // Association domaineCle (grille des créneaux) → clé du référentiel
  // BO_VOLUMES_HEBDO. Reste tolérante : reconnaît les variantes usuelles
  // de libellés utilisées dans la banque de séquences/séances.
  function domaineBoDe(texte) {
    const t = String(texte || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (/franc|lecture|ecriture|oral|vocabulaire|grammaire/.test(t)) return "francais";
    if (/math|nombre|calcul|grandeur|geometr/.test(t)) return "mathematiques";
    if (/\beps\b|sport|motric|education physique/.test(t)) return "eps";
    if (/langue|anglais|lve/.test(t)) return "languesVivantes";
    if (/art|musi|chant|dessin/.test(t)) return "artsEducationMusicale";
    if (/\bemc\b|moral|civi/.test(t)) return "emc";
    if (/histoire|geographie/.test(t)) return "histoireGeographie"; // cycle3
    if (/science|technolog/.test(t)) return "sciencesTechnologie"; // cycle3
    if (/questionner le monde|decouverte du monde|\bqlm\b/.test(t)) return "questionnerLeMonde"; // cycle2
    return null;
  }


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

  // Affectations manuelles élève ↔ créneau de grille (onglet « Affectation »
  // de Planning — Gestion). Distinct de STORE_AFFECT (qui relie un créneau
  // de type "séance" à une séance précise de la banque) : ici, on relie un
  // élève du coffre à un créneau récurrent d'une classe, pour déclarer
  // qu'il y est inclus chaque semaine (ex. inclusion partielle en classe
  // ordinaire). Clé : classeId + "__" + creneauId -> [identifiantSynapses...].
  const STORE_AFFECT_ELEVES =
    "synapses_planning_affectations_eleves";

  // Grille de présence "créneau × élève de la classe" (onglet Affectation) :
  // modèle inverse de STORE_AFFECT_ELEVES. Ici, le roster complet d'une
  // classe (chargé depuis le coffre, en mémoire, jamais persisté lui-même)
  // est présumé affecté à TOUS les créneaux de sa classe par défaut ; seules
  // les EXCEPTIONS (un élève retiré d'un créneau précis) sont enregistrées.
  // Clé : classeId + "__" + creneauId -> [identifiantSynapses exclus...].
  // Comme pour STORE_AFFECT_ELEVES, seuls des identifiants Synapses sont
  // stockés : aucun nom, aucune donnée nominative.
  const STORE_EXCLUSIONS_CRENEAU =
    "synapses_planning_exclusions_creneau";

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

  /** Deux plages [aDebut,aFin) et [bDebut,bFin) (en minutes) se chevauchent-elles ? */
  function chevaucheMin(aDebut, aFin, bDebut, bFin) {
    return aDebut < bFin && bDebut < aFin;
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

                  domaineCle:
                    cle,

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

          domaineCle:
            cle,

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
    // IMPORTANT : ne jamais supprimer silencieusement des données locales.
    // Les anciennes affectations/exclusions restent conservées pour assurer
    // la rétrocompatibilité ; le coffre demeure la source de vérité pour les
    // données nominatives. Une éventuelle migration doit être explicite.

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
        // Ancien stockage : `niveauxActifs` était la liste des clés de
        // grille. Certaines versions intermédiaires avaient déjà créé
        // `classes: []` sans recopier cette liste. Dans les deux cas, si des
        // niveaux historiques existent, ils doivent redevenir des classes.
        if (!Array.isArray(c.classes) || (c.classes.length === 0 && Array.isArray(c.niveauxActifs) && c.niveauxActifs.length)) {
          const anciens = Array.isArray(c.niveauxActifs) ? c.niveauxActifs : [];
          c.classes = anciens.map((n, i) => ({
            id: uid("cls"), nom: n, niveau: n, couleur: PALETTE_CLASSES[i % PALETTE_CLASSES.length], dispositifs: []
          }));
        }
        c.classes.forEach((cl, i) => {
          if (!cl.id) cl.id = uid("cls");
          if (!cl.couleur) cl.couleur = PALETTE_CLASSES[i % PALETTE_CLASSES.length];
          if (!cl.nom) cl.nom = cl.niveau || "Classe";
          if (!Array.isArray(cl.dispositifs)) cl.dispositifs = [];
        });
        if (!Array.isArray(c.dispositifs)) c.dispositifs = [];
        c.dispositifs.forEach((d, i) => {
          if (!d.id) d.id = uid("disp");
          if (!d.nom) d.nom = d.type || "Dispositif";
          if (!["ULIS","SEGPA","RASED"].includes(String(d.type||"").toUpperCase())) d.type = "ULIS";
          else d.type = String(d.type).toUpperCase();
          if (!d.couleur) d.couleur = ["#6B4E8E","#3F8C4B","#B5871E"][i % 3];
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

      // Dispositifs indépendants des classes (sans niveau propre).
      // Chaque dispositif = { id, nom, type, couleur } et peut être
      // rattaché à plusieurs classes via classe.dispositifs.
      dispositifs:
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
      couleur: PALETTE_CLASSES[config.classes.length % PALETTE_CLASSES.length],
      dispositifs: []
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

  function dispositifById(config, dispositifId) {
    return (config.dispositifs || []).find(d => d.id === dispositifId) || null;
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

  /** Fusionne un fichier de configuration importé dans la config courante.
   *  Remplace entièrement classes / jours / récréations / pauses / calendrier
   *  (import "franc" plutôt que fusion silencieuse, pour rester prévisible). */
  function importerConfigJSON(config, payload) {
    if (!payload || typeof payload !== "object") throw new Error("Fichier de configuration invalide.");
    if (Array.isArray(payload.classes)) config.classes = payload.classes.map(c => ({
      id: c.id || uid("cls"),
      nom: c.nom || c.niveau || "Classe",
      niveau: c.niveau || "",
      couleur: c.couleur || PALETTE_CLASSES[0],
      dispositifs: Array.isArray(c.dispositifs) ? c.dispositifs.slice() : []
    }));
    if (Array.isArray(payload.dispositifs)) config.dispositifs = payload.dispositifs.map(d => ({
      id: d.id || uid("disp"),
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

  /**
   * Restaure les clés de stockage de l'ancien modèle (CP/CE1/…) vers les
   * identifiants stables des nouvelles classes. Cette migration est
   * volontairement non destructive : les anciennes clés ne sont supprimées
   * qu'après copie réussie vers une classe correspondante.
   */
  function migrerStockageClasses(config, grilles) {
    if (!config || !grilles || typeof grilles !== "object") return false;

    // Ancien modèle : les grilles étaient directement indexées par niveau
    // (CP, CE1, CE2...). On conserve toutes les données et on reconstruit
    // seulement les entités de classe manquantes.
    const anciens = Array.isArray(config.niveauxActifs)
      ? config.niveauxActifs.slice()
      : [];
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
      let cl = config.classes.find(c =>
        String(c.niveau || c.nom || "").toUpperCase() === niveauCle
      );
      if (!cl) {
        cl = {
          id: uid("cls"),
          nom: niveau,
          niveau: niveau,
          couleur: PALETTE_CLASSES[config.classes.length % PALETTE_CLASSES.length],
          dispositifs: []
        };
        config.classes.push(cl);
        modifie = true;
      }
      const ancienne = grilles[niveau] || grilles[niveauCle];
      if (Array.isArray(ancienne) &&
          (!Array.isArray(grilles[cl.id]) || !grilles[cl.id].length)) {
        grilles[cl.id] = ancienne;
        modifie = true;
      }
    });

    // Même migration pour les affectations de séances, sans supprimer les
    // anciennes clés.
    try {
      const aff = JSON.parse(localStorage.getItem(STORE_AFFECT) || "{}");
      let affModifie = false;
      anciens.forEach(niveau => {
        const niveauCle = String(niveau).toUpperCase();
        const cl = config.classes.find(c =>
          String(c.niveau || c.nom || "").toUpperCase() === niveauCle
        );
        const ancienne = aff[niveau] || aff[niveauCle];
        if (cl && ancienne !== undefined && !Object.prototype.hasOwnProperty.call(aff, cl.id)) {
          aff[cl.id] = ancienne;
          affModifie = true;
        }
      });
      if (affModifie) localStorage.setItem(STORE_AFFECT, JSON.stringify(aff));
    } catch (e) {
      // Une migration secondaire ne doit jamais empêcher le chargement du planning.
    }

    if (modifie) {
      sauverGrilles(grilles);
      sauverConfig(config);
    }
    return modifie;
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
      c = {
        id: id, jour: jour, debut: def.debut, fin: def.fin, type: type,
        libelle: def.label || "", domaineCle: "",
        // Métadonnées stockées explicitement : l'id ne peut pas être reparsé
        // de façon fiable puisque classeId (via uid()) contient lui-même des
        // "_" (ex. "cls_lx8f3k2_ab3de"), ce qui décale tout split("_").
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
   * Applique les récréations / pauses méridiennes (pensées à l'échelle de
   * l'école, définies une seule fois dans la configuration générale) à la
   * grille de chaque classe concernée. Une classe absente de `def.classes`
   * (ou `def.classes` vide = toutes les classes) ne reçoit pas ce créneau :
   * c'est ce qui permet à deux CE2 de ne pas partager la même récréation.
   */
  function appliquerCreneauxFixes(config, grilles, classeIds) {
    const toutesLesClasses = (config.classes || []).map(c => c.id);
    classeIds = (classeIds && classeIds.length) ? classeIds : toutesLesClasses;
    const jours = (config.joursTravailles && config.joursTravailles.length) ? config.joursTravailles.map(Number) : [1,2,3,4,5];
    const recreations = Array.isArray(config.recreations) ? config.recreations : [];
    const pauses = Array.isArray(config.pauses) ? config.pauses : [];
    let ajoutes = 0, misAJour = 0;

    classeIds.forEach(classeId => {
      grilles[classeId] = Array.isArray(grilles[classeId]) ? grilles[classeId] : [];
      const grille = grilles[classeId];
      jours.forEach(j => {
        recreations.forEach((def, idx) => {
          if (!classesDuService(config, def).includes(classeId)) return;
          const id = "fixe_" + classeId + "_" + j + "_recreation_" + idx;
          const existait = grille.some(c => c && c.id === id);
          upsertCreneauFixe(grille, classeId, j, "recreation", idx, def);
          existait ? misAJour++ : ajoutes++;
        });
        pauses.forEach((def, idx) => {
          if (!classesDuService(config, def).includes(classeId)) return;
          const id = "fixe_" + classeId + "_" + j + "_pause_" + idx;
          const existait = grille.some(c => c && c.id === id);
          upsertCreneauFixe(grille, classeId, j, "pause", idx, def);
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
        return classesDuService(config, liste[idx]).includes(classeId);
      });
    });

    return { ajoutes, misAJour, total: ajoutes + misAJour };
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


  // ------------------------------------------------------------------
  // Affectations manuelles élève ↔ créneau (onglet « Affectation »)
  // ------------------------------------------------------------------

  function chargerAffectationsEleves() {
    try {
      return JSON.parse(localStorage.getItem(STORE_AFFECT_ELEVES)) || {};
    } catch (e) {
      return {};
    }
  }

  function sauverAffectationsEleves(a) {
    localStorage.setItem(STORE_AFFECT_ELEVES, JSON.stringify(a || {}));
  }

  function cleAffectationEleve(classeId, creneauId) {
    return classeId + "__" + creneauId;
  }

  function elevesAffectesCreneau(affEleves, classeId, creneauId) {
    return ((affEleves || {})[cleAffectationEleve(classeId, creneauId)] || []).slice();
  }

  /**
   * Affecte un élève à un créneau récurrent d'une classe. Renvoie false
   * (sans rien modifier) si l'élève est déjà affecté à ce créneau, afin
   * d'éviter tout doublon — y compris avec la génération automatique, qui
   * lit ce même registre pour ne jamais re-proposer un élève déjà prévu
   * à cet endroit (voir genererGroupesBesoinULIS / repartirElevesSemaineAuto).
   */
  function affecterEleveCreneau(affEleves, classeId, creneauId, identifiantSynapses) {
    if (!classeId || !creneauId || !identifiantSynapses) return false;
    const cle = cleAffectationEleve(classeId, creneauId);
    affEleves[cle] = affEleves[cle] || [];
    if (affEleves[cle].includes(identifiantSynapses)) return false;
    affEleves[cle].push(identifiantSynapses);
    return true;
  }

  function retirerEleveCreneau(affEleves, classeId, creneauId, identifiantSynapses) {
    const cle = cleAffectationEleve(classeId, creneauId);
    if (!affEleves[cle]) return false;
    const idx = affEleves[cle].indexOf(identifiantSynapses);
    if (idx === -1) return false;
    affEleves[cle].splice(idx, 1);
    if (!affEleves[cle].length) delete affEleves[cle];
    return true;
  }

  // ------------------------------------------------------------------
  // Grille de présence par défaut : créneau × élève de la classe
  // ------------------------------------------------------------------

  function chargerExclusionsCreneau() {
    try {
      return JSON.parse(localStorage.getItem(STORE_EXCLUSIONS_CRENEAU)) || {};
    } catch (e) {
      return {};
    }
  }

  function sauverExclusionsCreneau(o) {
    localStorage.setItem(STORE_EXCLUSIONS_CRENEAU, JSON.stringify(o || {}));
  }

  function estEleveExcluCreneau(exclusions, classeId, creneauId, identifiantSynapses) {
    const cle = cleAffectationEleve(classeId, creneauId);
    return ((exclusions || {})[cle] || []).includes(identifiantSynapses);
  }

  /**
   * Bascule la présence d'un élève sur un créneau (par défaut présent :
   * on ne stocke que les exceptions). `present === true` retire l'élève
   * de la liste d'exclusions (il redevient présent par défaut) ; `false`
   * l'y ajoute (il est retiré de ce créneau précis).
   */
  function definirPresenceEleveCreneau(exclusions, classeId, creneauId, identifiantSynapses, present) {
    const cle = cleAffectationEleve(classeId, creneauId);
    exclusions[cle] = exclusions[cle] || [];
    const idx = exclusions[cle].indexOf(identifiantSynapses);
    if (present) {
      if (idx !== -1) exclusions[cle].splice(idx, 1);
      if (!exclusions[cle].length) delete exclusions[cle];
    } else {
      if (idx === -1) exclusions[cle].push(identifiantSynapses);
    }
  }

  /**
   * Un élève est-il affecté manuellement à un créneau d'une classe qui
   * chevauche [segmentDebut, segmentFin] (en minutes) un jour de semaine
   * donné (1=lundi) ? Utilisé par la génération pour ne jamais dupliquer
   * un élève déjà prévu ailleurs sur ce créneau.
   */
  function eleveAffecteSurSegment(affEleves, grilles, jourSemaine, segmentDebut, segmentFin, identifiantSynapses) {
    if (!identifiantSynapses) return false;
    return Object.keys(affEleves || {}).some(cle => {
      const ids = affEleves[cle] || [];
      if (!ids.includes(identifiantSynapses)) return false;
      const sep = cle.indexOf("__");
      if (sep === -1) return false;
      const classeId = cle.slice(0, sep), creneauId = cle.slice(sep + 2);
      const creneau = (grilles[classeId] || []).find(c => c.id === creneauId);
      if (!creneau || creneau.jour !== jourSemaine) return false;
      const d = heureVersMin(creneau.debut), f = heureVersMin(creneau.fin);
      return d < segmentFin && f > segmentDebut;
    });
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
   * Synchronise le journal d'un jour avec les grilles horaires hebdomadaires
   * (classes et dispositifs) et les affectations de séances.
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
  function genererJournalDepuisGrille(iso, config, grilles, affectations, banque, coffre) {
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
        // Le nom de la grille est un libellé général (ex. « Français »),
        // jamais une affectation directe à une séance précise. La séance
        // précise est choisie par le générateur à partir de domaineCle.
        const titre = (item && (item.titre || item.type)) ||
          ((c.titre && c.titre.trim()) ? c.titre.trim() : null) ||
          (bucket ? bucket.label : c.domaineCle);
        const idsPlanning = (coffre && coffre.ouvert && typeof coffre.listerEleves === "function")
          ? coffre.listerEleves()
              .filter(e => Array.isArray(e.planning) && e.planning.some(p =>
                p.classeId === classeId && p.creneauId === c.id))
              .map(e => e.identifiantSynapses)
              .filter(Boolean)
          : [];

        if (existant) {
          existant.debut = c.debut; existant.fin = c.fin; existant.titre = titre;
          existant.domaineCle = c.domaineCle; existant.niveau = classe.nom; existant.classeId = classeId;
          existant.seanceRef = item ? { id: item.id, source: item.source, fichier: item.fichier || null } : null;
          existant.eleves = idsPlanning.slice();
        } else {
          jour.groupes.push({
            id: uid("grp"), debut: c.debut, fin: c.fin, origine: origine, modifie: false,
            adulte: { type: "enseignant", nom: "" }, titre: titre, domaineCle: c.domaineCle, niveau: classe.nom, classeId: classeId,
            seanceRef: item ? { id: item.id, source: item.source, fichier: item.fichier || null } : null,
            eleves: idsPlanning.slice(), remarque: "", fixe: false
          });
        }
      });
    });

    // --------------------------------------------------------------------
    // Dispositifs (ULIS, SEGPA, RASED, …) : même logique que les classes.
    // La grille du dispositif est la source des créneaux du cahier journal.
    // Les élèves sont simplement rapprochés à partir de leur planning
    // individuel : lorsqu'un créneau de classe chevauchant n'est pas présent
    // dans leur planning, ils sont disponibles pour le dispositif.
    // --------------------------------------------------------------------
    (config.dispositifs || []).forEach(disp => {
      const classesLiees = classes.filter(cl => (cl.dispositifs || []).includes(disp.id));
      if (!classesLiees.length) return;
      const classeIds = new Set(classesLiees.map(cl => cl.id));
      const grille = (grilles[disp.id] || []).filter(c => c && c.jour === jourSemaine);
      grille.forEach(c => {
        const origine = disp.id + "__" + c.id;
        if (jour.exclusions.indexOf(origine) !== -1) return;
        originesVues.add(origine);
        const existant = parOrigine.get(origine);
        if (existant && existant.modifie) return;

        // Un créneau déjà réparti en groupes de besoin (voir
        // repartirGroupesBesoinDispositif ci-dessous, action « Répartir
        // les élèves » de l'onglet Génération) porte plusieurs groupes
        // sous cette même origine. Dans ce cas, la répartition fait foi :
        // on ne recrée jamais le groupe fusionné unique par-dessus, pour
        // ne pas écraser silencieusement le travail de répartition.
        const sousGroupesBesoin = jour.groupes.filter(g => g.origine === origine && g.groupeBesoin);
        if (sousGroupesBesoin.length) return;

        const debut = heureVersMin(c.debut), fin = heureVersMin(c.fin);
        const idsPlanning = (coffre && coffre.ouvert && typeof coffre.listerEleves === "function")
          ? coffre.listerEleves().filter(e => {
              const valeurClasse = e.classe || (e.identite && e.identite.classe) || "";
              const norm = v => String(v).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
              const classeRef = classesLiees.find(cl => norm(cl.nom) === norm(valeurClasse) || (cl.niveau && norm(cl.niveau) === norm(valeurClasse)));
              if (!classeRef) return false;
              const plan = Array.isArray(e.planning) ? e.planning : [];
              const planClasse = plan.filter(p => p.classeId === classeRef.id);
              if (planClasse.length) {
                return !planClasse.some(p => Number(p.jour) === Number(jourSemaine) &&
                  chevaucheMin(heureVersMin(p.debut), heureVersMin(p.fin), debut, fin));
              }
              return !(grilles[classeRef.id] || []).some(cx => cx.jour === jourSemaine &&
                chevaucheMin(heureVersMin(cx.debut), heureVersMin(cx.fin), debut, fin));
            }).map(e => e.identifiantSynapses).filter(Boolean)
          : [];

        const estFixe = c.type !== "seance";
        const titre = estFixe
          ? ((c.libelle && c.libelle.trim()) ? c.libelle.trim() : ((TYPES_CRENEAU[c.type] || {}).label || c.type))
          : ((c.titre && c.titre.trim()) ? c.titre.trim() : disp.nom);

        if (existant) {
          existant.debut = c.debut; existant.fin = c.fin; existant.titre = titre;
          existant.domaineCle = c.domaineCle || ""; existant.niveau = ""; existant.classeId = "";
          existant.dispositifId = disp.id; existant.dispositifType = disp.type || "ULIS";
          existant.eleves = idsPlanning.slice(); existant.fixe = estFixe;
        } else {
          jour.groupes.push({
            id: uid("grp"), debut: c.debut, fin: c.fin, origine, modifie: false,
            adulte: estFixe ? null : { type: "enseignant", nom: "" },
            titre, domaineCle: c.domaineCle || "", niveau: "", classeId: "",
            dispositifId: disp.id, dispositifType: disp.type || "ULIS", seanceRef: null,
            eleves: idsPlanning.slice(), remarque: "", fixe: estFixe
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
  /**
   * Répartition des élèves pour une journée.
   *
   * Règles métier :
   *  - les élèves ne sont PAS enfermés dans leur classe : la classe sert
   *    surtout à connaître le niveau et à appliquer les récréations ;
   *  - un créneau comporte au maximum 3 groupes de travail ;
   *  - les besoins/objectifs actifs et le niveau sont les critères principaux ;
   *  - si la classe de l'élève est en récréation sur la plage, l'élève va
   *    dans la récréation de sa classe ;
   *  - sinon, il est placé dans un groupe de travail avec un enseignant ;
   *  - la répartition est recalculée à chaque clic sur « Répartir les élèves ».
   */
  function repartirElevesAuto(iso, journalJour, coffre) {
    if (!coffre || !coffre.ouvert) return journalJour;

    const eleves = coffre.listerEleves ? coffre.listerEleves() : [];
    if (!eleves.length) return journalJour;

    const norm = v => String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const niveauDe = v => {
      const s = norm(v);
      const m = s.match(/\b(tps|ps|ms|gs|cp|ce1|ce2|cm1|cm2)\b/);
      return m ? m[1] : s;
    };

    const mots = v => norm(v)
      .split(/\s+/)
      .filter(x => x.length >= 3);

    function besoinsEtObjectifs(e) {
      const besoins = (e.besoins || []).map(x =>
        x && typeof x === "object"
          ? (x.domaine || x.champ || x.hypothese || x.libelle || "")
          : x
      );
      const objectifs = (e.objectifs || [])
        .filter(x => !x || !x.statut || x.statut === "actif")
        .map(x =>
          x && typeof x === "object"
            ? (x.domaine || x.libelle || x.contexte || x.champ || "")
            : x
        );
      return besoins.concat(objectifs).map(norm).filter(Boolean);
    }

    function niveauEleve(e) {
      return niveauDe(
        e.niveau || e.classeNiveau || e.classe || e.niveauScolaire || ""
      );
    }

    // Niveau d'équivalence scolaire DISCIPLINAIRE (voir coffre : onglet
    // "Analyse & IA", Coffre.enregistrerEquivalenceScolaire), utilisé en
    // priorité sur le niveau de classe brut lorsqu'il est disponible : un
    // élève peut être en CM1 mais avoir un niveau équivalent CE1 en français.
    function niveauEquivalentSujet(e, matiere) {
      const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
      const v = eq && eq.niveauEquivalent;
      return v ? niveauDe(v) : niveauEleve(e);
    }

    function aAesh(e) {
      return (e.accompagnements || []).some(a => {
        const s = typeof a === "object" ? (a.type || a.libelle || a.nom || "") : a;
        return norm(s).indexOf("aesh") !== -1;
      });
    }

    function classeEleve(e) {
      return norm(
        e.classeId || e.classe || e.classeNom || e.groupeClasse || ""
      );
    }

    function classeDuGroupe(g) {
      return norm(g.classeId || g.classe || g.niveau || "");
    }

    function estRecreation(g) {
      return g.fixe && String(g.origine || "").indexOf("__fixe_") === -1
        ? String(g.titre || "").toLowerCase().indexOf("récré") !== -1
        : g.fixe && String(g.titre || "").toLowerCase().indexOf("récré") !== -1;
    }

    function scoreBesoin(e, g) {
      const besoins = besoinsEtObjectifs(e);
      if (!besoins.length) return 0;

      const cible = norm(
        String(g.domaineCle || "") + " " +
        String(g.titre || "")
      );
      const cibleMots = mots(cible);
      let score = 0;

      besoins.forEach(b => {
        if (!b) return;
        if (cible.indexOf(b) !== -1 || b.indexOf(cible) !== -1) {
          score += 8;
          return;
        }
        const bm = mots(b);
        bm.forEach(m => {
          if (cibleMots.some(x => x === m || x.indexOf(m) === 0 || m.indexOf(x) === 0)) score += 3;
          else if (m.length >= 4 && cible.indexOf(m.slice(0, 4)) !== -1) score += 2;
        });
      });
      return score;
    }

    function scoreNiveau(e, g) {
      const cible = norm(String(g.domaineCle || "") + " " + String(g.titre || ""));
      const estFrancaisG = /franc|lecture|ecriture|oral|comprehension/.test(cible);
      const estMathsG = /math|nombre|calcul|grandeur|geometr/.test(cible);
      const ne = estFrancaisG ? niveauEquivalentSujet(e, "francais")
        : estMathsG ? niveauEquivalentSujet(e, "mathematiques")
        : niveauEleve(e);
      const ng = niveauDe(g.niveau || g.classeId || "");
      if (!ne || !ng) return 0;
      return ne === ng ? 4 : 0;
    }

    function groupeScore(e, g) {
      return scoreBesoin(e, g) + scoreNiveau(e, g);
    }

    function classesRecreation(bloc) {
      return bloc.groupes.filter(g => {
        if (!g.fixe) return false;
        const t = norm(g.titre);
        return t.includes("recre") || t.includes("récré");
      });
    }

    function appartientARecreation(e, g) {
      const ec = classeEleve(e);
      const gc = classeDuGroupe(g);
      const en = niveauEleve(e);
      const gn = niveauDe(g.niveau || g.classeId || "");
      if (ec && gc && (ec === gc || gc.indexOf(ec) !== -1 || ec.indexOf(gc) !== -1)) return true;
      return !!(en && gn && en === gn && !ec);
    }

    // Les groupes sont regroupés par horaire exact. On travaille ensuite
    // sur chaque plage indépendamment afin qu'un élève puisse changer de
    // groupe d'un créneau à l'autre.
    regrouperParBloc(journalJour).forEach(bloc => {
      const fixes = bloc.groupes.filter(g => g.fixe);
      const recreations = classesRecreation(bloc);
      const travail = bloc.groupes.filter(g => !g.fixe);

      // Réinitialisation : la commande « Répartir » repart d'une situation
      // propre pour les groupes de travail. Les récréations reçoivent aussi
      // les élèves concernés automatiquement.
      travail.forEach(g => {
        g.eleves = [];
      });
      fixes.forEach(g => {
        g.eleves = [];
      });

      const places = new Map();

      // 1) Récréations : priorité absolue pour les élèves dont la classe
      // est concernée. On ne leur attribue aucun groupe de travail.
      eleves.forEach(e => {
        const id = e.identifiantSynapses;
        if (!id) return;
        const rec = recreations.find(g => appartientARecreation(e, g));
        if (rec) {
          rec.eleves.push(id);
          places.set(id, rec.id);
        }
      });

      // 1 bis) Scission d'un groupe unique en groupes de besoin.
      // Le cas le plus courant est celui d'un seul groupe de travail sur le
      // créneau (ex. une classe entière en français) : sans cela, tous les
      // élèves y seraient replacés tels quels et « Répartir les élèves » ne
      // ferait jamais que reproduire le cahier journal existant. On scinde
      // donc ce groupe unique en 2 ou 3 groupes de besoin (même contenu
      // pédagogique, niveaux/besoins différenciés), à condition qu'il reste
      // au moins deux élèves à placer sur ce créneau.
      if (travail.length === 1) {
        const modele = travail[0];
        const restantsAScinder = eleves.filter(e => !places.has(e.identifiantSynapses));
        if (restantsAScinder.length > 1) {
          const cible = norm(String(modele.domaineCle || "") + " " + String(modele.titre || ""));
          const estFrancaisG = /franc|lecture|ecriture|oral|comprehension/.test(cible);
          const estMathsG = /math|nombre|calcul|grandeur|geometr/.test(cible);
          const clusters = new Map();
          restantsAScinder.forEach(e => {
            const niv = estFrancaisG ? niveauEquivalentSujet(e, "francais")
              : estMathsG ? niveauEquivalentSujet(e, "mathematiques")
              : niveauEleve(e);
            const cle = niv || "?";
            if (!clusters.has(cle)) clusters.set(cle, []);
            clusters.get(cle).push(e);
          });

          let cles = Array.from(clusters.keys());
          if (cles.length > 1) {
            // Au-delà de 3 groupes de besoin distincts, on fusionne les plus
            // petits ensemble pour respecter la limite de 3 groupes simultanés.
            if (cles.length > 3) {
              cles.sort((a, b) => clusters.get(b).length - clusters.get(a).length);
              const gardees = cles.slice(0, 2);
              const reste = cles.slice(2);
              const fusion = [];
              reste.forEach(c => fusion.push(...clusters.get(c)));
              clusters.set("mixte", fusion);
              cles = gardees.concat(["mixte"]);
            }

            const nouveaux = cles.map((cle, i) => Object.assign({}, modele, {
              id: uid("grp"),
              titre: modele.titre + (cle && cle !== "mixte" && cle !== "?" ? " — " + cle.toUpperCase() : " — Groupe " + (i + 1)),
              eleves: [],
              adulte: i === 0 ? modele.adulte : { type: "enseignant", nom: "" },
              origine: i === 0 ? modele.origine : null,
              modifie: true,
              repartitionAuto: true,
              personnalise: false
            }));

            cles.forEach((cle, i) => {
              const g = nouveaux[i];
              clusters.get(cle).forEach(e => {
                g.eleves.push(e.identifiantSynapses);
                places.set(e.identifiantSynapses, g.id);
              });
            });

            const idx = journalJour.groupes.indexOf(modele);
            if (idx !== -1) journalJour.groupes.splice(idx, 1, ...nouveaux);
            travail.length = 0;
            nouveaux.forEach(g => travail.push(g));
          }
        }
      }

      // 2) Jusqu'à 3 groupes de travail. Si plus de 3 groupes existent dans
      // les données historiques, on choisit les trois groupes couvrant le
      // mieux les besoins/niveaux des élèves restant à placer.
      let candidats = travail.slice();

      if (candidats.length > 3) {
        const restants = eleves.filter(e => !places.has(e.identifiantSynapses));
        const choisis = [];

        while (choisis.length < 3 && candidats.length) {
          let meilleur = null;
          let meilleurGain = -1;
          candidats.forEach(g => {
            let gain = 0;
            restants.forEach(e => {
              const s = groupeScore(e, g);
              if (s > gain) gain = s;
            });
            // Favorise les groupes de l'enseignant et les groupes déjà
            // explicitement préparés dans le cahier journal.
            if (g.adulte && norm(g.adulte.type) === "enseignant") gain += 1;
            if (gain > meilleurGain) {
              meilleurGain = gain;
              meilleur = g;
            }
          });
          if (!meilleur) break;
          choisis.push(meilleur);
          candidats = candidats.filter(g => g !== meilleur);
        }
        travail.forEach(g => {
          g._repartitionInactif = !choisis.includes(g);
        });
        candidats = choisis;
      } else {
        travail.forEach(g => { g._repartitionInactif = false; });
      }

      // S'il n'existe aucun groupe de travail pour accueillir les élèves qui
      // ne sont pas en récréation, on crée un groupe enseignant unique.
      if (!candidats.length) {
        const id = uid("grp");
        const debut = bloc.debut;
        const fin = bloc.fin;
        const g = {
          id,
          debut,
          fin,
          origine: null,
          modifie: true,
          adulte: { type: "enseignant", nom: "" },
          titre: "Groupe avec l'enseignant",
          domaineCle: "",
          niveau: "",
          classeId: "",
          seanceRef: null,
          eleves: [],
          remarque: "Créé automatiquement pour les élèves hors récréation.",
          fixe: false,
          repartitionAuto: true,
          personnalise: false
        };
        journalJour.groupes.push(g);
        candidats = [g];
      }

      // 3) Attribution : besoins d'abord, niveau ensuite, puis équilibrage.
      const restants = eleves.filter(e => !places.has(e.identifiantSynapses));
      restants.forEach(e => {
        const id = e.identifiantSynapses;
        if (!id) return;

        let meilleur = null;
        let meilleurScore = -Infinity;

        candidats.forEach(g => {
          const score = groupeScore(e, g);
          const charge = (g.eleves || []).length;
          // Le nombre d'élèves sert uniquement à départager les groupes
          // ayant une pertinence comparable.
          const total = score * 100 - charge;
          if (total > meilleurScore) {
            meilleurScore = total;
            meilleur = g;
          }
        });

        if (meilleur) {
          meilleur.eleves = meilleur.eleves || [];
          meilleur.eleves.push(id);
          places.set(id, meilleur.id);
        }
      });

      // 4) Nettoyage des groupes créés automatiquement qui resteraient vides.
      journalJour.groupes = journalJour.groupes.filter(g =>
        !g.repartitionAuto || (g.eleves && g.eleves.length)
      );
    });

    // Retire le marqueur technique avant sauvegarde.
    journalJour.groupes.forEach(g => {
      delete g._repartitionInactif;
    });

    const journal = chargerJournal();
    journal[iso] = journalJour;
    sauverJournal(journal);
    return journalJour;
  }

  /**
   * Construit une répartition hebdomadaire automatique des élèves.
   *
   * Référentiel horaire utilisé (BO n°44 du 26/11/2015) :
   *   - CP/CE1/CE2 : Français 10 h, Mathématiques 5 h / semaine.
   *   - CM1/CM2    : Français 8 h, Mathématiques 5 h / semaine.
   *
   * Le moteur ne remplace pas les choix manuels :
   *   - un élève déjà affecté manuellement dans sa classe sur un créneau
   *     n'est pas ajouté à un groupe de soutien sur ce créneau ;
   *   - les récréations sont prioritaires ;
   *   - maximum 3 groupes automatiques par créneau ;
   *   - les groupes sont d'abord constitués par niveau, puis affinés
   *     par besoins/objectifs ;
   *   - le matin, priorité Français/Mathématiques ;
   *   - en début d'après-midi, une plage de 30 min est prioritairement
   *     utilisée pour lecture/écriture ;
   *   - les créneaux restants servent à combler les objectifs/besoins.
   *
   * Les identifiants d'élèves restent en mémoire via le coffre : aucune donnée
   * nominative n'est enregistrée dans la configuration.
   */
  function repartirElevesSemaineAuto(config, grilles, affectations, coffre) {
    if (!coffre || !coffre.ouvert) {
      throw new Error("Ouvrez le coffre avant de répartir les élèves.");
    }

    const eleves = coffre.listerEleves ? coffre.listerEleves() : [];
    if (!eleves.length) throw new Error("Aucun élève disponible dans le coffre.");

    const semaines = calculerSemaines(config || {});
    const joursTravail = new Set((config.joursTravailles || [1,2,3,4,5]).map(Number));
    const journal = chargerJournal();

    const norm = v => String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const niveauDe = v => {
      const s = norm(v);
      const m = s.match(/\b(cp|ce1|ce2|cm1|cm2)\b/);
      return m ? m[1].toUpperCase() : String(v || "").trim().toUpperCase();
    };

    const niveauEleve = e => niveauDe(
      e.niveau || e.classeNiveau || e.niveauScolaire || e.classe || ""
    );

    // Niveau d'équivalence scolaire DISCIPLINAIRE (français / mathématiques),
    // saisi par l'enseignant dans le coffre (onglet "Analyse & IA"). On
    // l'utilise en priorité sur le niveau de classe brut quand il existe :
    // c'est la vraie donnée individuelle de l'élève, pas une approximation.
    const niveauEquivalentSujet = (e, matiere) => {
      const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
      const v = eq && eq.niveauEquivalent;
      return v ? niveauDe(v) : niveauEleve(e);
    };

    // Accompagnement humain déclaré (ex. AESH) : lu depuis e.accompagnements,
    // seule vraie source de cette information dans le coffre (aucune donnée
    // n'est jamais inventée ici).
    const aAesh = e => (e.accompagnements || []).some(a => {
      const s = typeof a === "object" ? (a.type || a.libelle || a.nom || "") : a;
      return norm(s).indexOf("aesh") !== -1;
    });

    // Autonomie déclarée : seulement si explicitement renseignée dans le
    // coffre (accompagnements) — jamais supposée par défaut, conformément à
    // l'aide affichée dans Planning — Gestion ("uniquement pour les élèves
    // déclarés capables de travailler seuls").
    const autonomieDeclaree = e => (e.accompagnements || []).some(a => {
      const s = typeof a === "object" ? (a.type || a.libelle || a.nom || "") : a;
      const n = norm(s);
      return n.indexOf("autonomie") !== -1 || n.indexOf("autonome") !== -1;
    });

    const classeEleve = e => norm(
      e.classeId || e.classe || e.classeNom || e.groupeClasse || ""
    );

    const besoinsEleve = e => {
      const a = (e.besoins || []).map(x => typeof x === "object"
        ? (x.domaine || x.champ || x.libelle || x.hypothese || "")
        : x);
      const b = (e.objectifs || []).filter(x => !x || !x.statut || x.statut === "actif")
        .map(x => typeof x === "object"
          ? (x.domaine || x.champ || x.libelle || x.contexte || "")
          : x);
      return a.concat(b).map(norm).filter(Boolean).join(" ");
    };

    const estFixe = g => !!g.fixe;
    const estRecreation = g => {
      const t = norm(g.titre || g.libelle || "");
      return estFixe(g) && (t.includes("recre") || t.includes("pause meridienne"));
    };

    const domaine = g => norm(
      (g.domaineCle || "") + " " + (g.titre || "") + " " + (g.seanceRef && g.seanceRef.titre || "")
    );

    const estFrancais = g => {
      const d = domaine(g);
      return d.includes("franc") || d.includes("lecture") || d.includes("ecriture") ||
             d.includes("oral") || d.includes("comprehension");
    };
    const estMaths = g => {
      const d = domaine(g);
      return d.includes("math") || d.includes("nombres") || d.includes("calcul") ||
             d.includes("grandeurs") || d.includes("geometr");
    };
    const estLectureEcriture = g => {
      const d = domaine(g);
      return d.includes("lecture") || d.includes("ecriture") ||
             d.includes("comprehension") || d.includes("production");
    };

    const minutes = (a,b) => Math.max(0, heureVersMin(b) - heureVersMin(a));
    const cible = {
      CP:  { francais: 600, maths: 300 },
      CE1: { francais: 600, maths: 300 },
      CE2: { francais: 600, maths: 300 },
      CM1: { francais: 480, maths: 300 },
      CM2: { francais: 480, maths: 300 }
    };

    const ids = new Map(eleves.map(e => [e.identifiantSynapses, e]).filter(x => x[0]));
    const stats = {};
    eleves.forEach(e => {
      stats[e.identifiantSynapses] = { francais: 0, maths: 0, lectureEcriture: 0, autres: 0 };
    });

    // Le planning individuel du coffre est la source de vérité pour les
    // affectations récurrentes d'un élève dans sa classe.
    const estDansSaClasse = (jour, e, bloc) => {
      const id = e.identifiantSynapses;
      const plan = Array.isArray(e.planning) ? e.planning : [];
      if (id && plan.length && bloc.groupes.some(g => {
        if (!g.origine) return false;
        const parts = String(g.origine).split("__");
        const classeId = parts[0], creneauId = parts.slice(1).join("__");
        return plan.some(p => p.classeId === classeId && p.creneauId === creneauId &&
          Number(p.jour) === Number((new Date(jour)).getDay() === 0 ? 7 : ((new Date(jour)).getDay())));
      })) return true;
      return bloc.groupes.some(g => {
        if (estFixe(g) || !g.modifie || !(g.eleves || []).includes(id)) return false;
        const gc = norm(g.classeId || g.classe || "");
        const ec = classeEleve(e);
        return gc && ec && (gc === ec || gc.includes(ec) || ec.includes(gc));
      });
    };

    let nbAjouts = 0;
    let nbGroupes = 0;
    let nbGroupesEnseignant = 0;
    let nbGroupesAesh = 0;
    let nbGroupesAutonomie = 0;

    function profilPour(e, g) {
      const ng = niveauDe(g.niveau || g.classeId || "");
      const n = estFrancais(g) ? niveauEquivalentSujet(e, "francais")
        : estMaths(g) ? niveauEquivalentSujet(e, "mathematiques")
        : niveauEleve(e);
      const besoin = besoinsEleve(e);
      let score = 0;
      if (n && n === ng) score += 100;
      if (estFrancais(g) && /franc|lecture|ecriture|oral|comprehension/.test(besoin)) score += 20;
      if (estMaths(g) && /math|nombre|calcul|grandeur|geometr/.test(besoin)) score += 20;
      if (estLectureEcriture(g) && /lecture|ecriture|comprehension|production/.test(besoin)) score += 25;
      return score;
    }

    function choisirGroupe(bloc, e, groupes) {
      const id = e.identifiantSynapses;
      const n = niveauEleve(e);
      const h = heureVersMin(bloc.debut);
      const duree = minutes(bloc.debut, bloc.fin);
      const estMatin = h < 12 * 60;
      const estDebutAPM = h >= 12 * 60 && h < 14 * 60 && duree === 30;

      let eligibles = groupes.filter(g => !estFixe(g) && !(g.eleves || []).includes(id));
      if (!eligibles.length) return null;

      // Ne pas multiplier les groupes : on réutilise en priorité un groupe
      // automatique du même niveau et du même domaine.
      const objectif = estMatin
        ? (stats[id].francais < (cible[n]?.francais || 0) ? "francais" : "maths")
        : (estDebutAPM ? "lectureEcriture" : null);

      const scoreG = g => {
        let s = profilPour(e, g);
        if (objectif === "francais" && estFrancais(g)) s += 60;
        if (objectif === "maths" && estMaths(g)) s += 60;
        if (objectif === "lectureEcriture" && estLectureEcriture(g)) s += 70;
        if (!objectif && besoinsEleve(e) && domaine(g).split(/\s+/).some(m => besoinsEleve(e).includes(m))) s += 20;
        if (niveauDe(g.niveau || "") === n) s += 30;
        s -= ((g.eleves || []).length * 0.1);
        return s;
      };

      eligibles.sort((a,b) => scoreG(b) - scoreG(a));
      return eligibles[0] || null;
    }

    semaines.forEach(sem => {
      JOURS.forEach(j => {
        if (!joursTravail.has(j.n)) return;
        const iso = dateISO(addDays(sem.lundi, j.n - 1));
        const jour = genererJournalDepuisGrille(
          iso, config, grilles, affectations || {}, {}
        );

        // Chaque nouvelle répartition est recalculée à partir de zéro pour
        // les groupes créés automatiquement : on les SUPPRIME et on les
        // reconstruit entièrement (pas seulement leur liste d'élèves), afin
        // que la structure elle-même (groupes de niveau, AESH, autonomie)
        // reflète l'algorithme actuel et les données réelles du coffre.
        // Seule exception, conforme à la « priorité cahier journal » : un
        // groupe automatique que l'enseignant a explicitement personnalisé
        // (personnalise=true, posé par planning-jour.html dès qu'il modifie
        // le titre, l'adulte, la séance ou les élèves à la main) est
        // entièrement préservé, structure ET élèves compris. Ce filtrage a
        // lieu AVANT le calcul des blocs (regrouperParBloc), pour que les
        // références de groupes utilisées plus bas soient à jour.
        jour.groupes = jour.groupes.filter(g => !(g.repartitionAuto && !g.personnalise));

        // genererJournalDepuisGrille n'a pas besoin de la banque pour créer
        // les groupes si les affectations sont déjà présentes ; on récupère
        // néanmoins les groupes existants dans le journal.
        const blocs = regrouperParBloc(jour).filter(bloc => heureVersMin(bloc.fin) <= (16 * 60 + 30));

        // La journée scolaire se termine à 16h30 : aucun groupe automatique
        // n'est créé ni alimenté sur un créneau qui dépasse cette limite.


        blocs.forEach(bloc => {
          const recreations = bloc.groupes.filter(estRecreation);
          const travail = bloc.groupes.filter(g => !estFixe(g));

          // Les élèves de classe en récréation ne peuvent pas être placés
          // dans un groupe pédagogique sur ce créneau.
          const disponibles = eleves.filter(e => {
            const id = e.identifiantSynapses;
            if (!id) return false;
            if (recreations.some(r => {
              const rc = norm(r.classeId || r.classe || "");
              const ec = classeEleve(e);
              const rn = niveauDe(r.niveau || r.classeId || "");
              return (rc && ec && (rc === ec || rc.includes(ec) || ec.includes(rc))) ||
                     (!ec && rn && rn === niveauEleve(e));
            })) return false;
            if (estDansSaClasse(jour, e, bloc)) return false;
            return true;
          });

          if (!disponibles.length) return;

          // On privilégie les groupes déjà créés automatiquement. À défaut,
          // on crée au maximum 3 groupes dans cette plage, en réservant en
          // priorité une place à un groupe AESH et/ou un groupe autonomie
          // lorsque de vraies données du coffre le justifient (voir §"Ajouter
          // et répartir automatiquement les élèves" dans Planning — Gestion).
          let auto = travail.filter(g => g.repartitionAuto);
          const MAX_GROUPES = 3;

          // Élèves accompagnés par une AESH sur ce créneau (donnée réelle du
          // coffre : e.accompagnements) : ils vont dans un groupe dédié avec
          // un adulte de type "aesh", quel que soit leur niveau.
          const elevesAesh = disponibles.filter(aAesh);
          // Élèves déclarés capables de travailler seuls (donnée réelle du
          // coffre) et non AESH sur ce créneau : groupe en autonomie, sans
          // adulte affecté.
          const elevesAutonomes = disponibles.filter(e => !aAesh(e) && autonomieDeclaree(e));
          const elevesStandard = disponibles.filter(e => !aAesh(e) && !autonomieDeclaree(e));

          function assurerGroupeSpecial(profil, titre, adulte) {
            if (auto.length >= MAX_GROUPES) return auto.find(g => g.profilAuto === profil) || null;
            let g = auto.find(g => g.profilAuto === profil);
            if (g) return g;
            g = {
              id: uid("grp"),
              debut: bloc.debut,
              fin: bloc.fin,
              origine: null,
              modifie: true,
              adulte: adulte,
              titre: titre,
              domaineCle: "",
              niveau: "",
              classeId: "",
              seanceRef: null,
              eleves: [],
              remarque: profil === "AESH"
                ? "Groupe créé automatiquement : élèves accompagnés par une AESH sur ce créneau (donnée du coffre)."
                : "Groupe créé automatiquement : élèves déclarés en autonomie sur ce créneau (donnée du coffre).",
              fixe: false,
              repartitionAuto: true,
              personnalise: false,
              profilAuto: profil
            };
            jour.groupes.push(g);
            auto.push(g);
            nbGroupes++;
            if (profil === "AESH") nbGroupesAesh++; else nbGroupesAutonomie++;
            return g;
          }

          let groupeAesh = null, groupeAutonomie = null;
          if (elevesAesh.length) groupeAesh = assurerGroupeSpecial("AESH", "Groupe AESH", { type: "aesh", nom: "" });
          if (elevesAutonomes.length) groupeAutonomie = assurerGroupeSpecial("AUTONOMIE", "Groupe autonomie", null);

          // Places de groupes de niveau restantes (enseignant), sur les
          // élèves ne relevant ni de l'AESH ni de l'autonomie déclarée.
          const placesRestantes = Math.max(0, MAX_GROUPES - auto.length);
          const niveaux = [...new Set(elevesStandard.map(niveauEleve).filter(Boolean))];
          niveaux.sort((a,b) =>
            elevesStandard.filter(e => niveauEleve(e) === b).length -
            elevesStandard.filter(e => niveauEleve(e) === a).length
          );
          const profils = niveaux.slice(0, placesRestantes);
          if (niveaux.length > placesRestantes && placesRestantes > 0) profils[placesRestantes - 1] = "BESOINS_CIBLES";

          profils.forEach(profil => {
            if (auto.length >= MAX_GROUPES) return;
            const existe = auto.find(g => String(g.profilAuto || "") === profil);
            if (existe) return;

            // Le groupe est créé sur la plage déjà prévue dans le planning.
            const g = {
              id: uid("grp"),
              debut: bloc.debut,
              fin: bloc.fin,
              origine: null,
              modifie: true,
              adulte: { type: "enseignant", nom: "" },
              titre: profil === "BESOINS_CIBLES"
                ? "Groupe besoins ciblés"
                : "Groupe " + profil,
              domaineCle: "",
              niveau: profil === "BESOINS_CIBLES" ? "" : profil,
              classeId: "",
              seanceRef: null,
              eleves: [],
              remarque: "Groupe créé automatiquement selon niveau, besoins et objectifs.",
              fixe: false,
              repartitionAuto: true,
              personnalise: false,
              profilAuto: profil
            };
            jour.groupes.push(g);
            auto.push(g);
            nbGroupes++;
            nbGroupesEnseignant++;
          });

          const groupesDisponibles = jour.groupes.filter(g => !estFixe(g) && !estRecreation(g))
            .filter(g => g.repartitionAuto || !g.classeId)
            .filter(g => g.profilAuto !== "AESH" && g.profilAuto !== "AUTONOMIE");

          function placerEleve(e, g, note) {
            const id = e.identifiantSynapses;
            g.eleves = g.eleves || [];
            if (g.eleves.includes(id)) return;
            g.eleves.push(id);
            nbAjouts++;
            if (estFrancais(g)) stats[id].francais += minutes(bloc.debut, bloc.fin);
            else if (estMaths(g)) stats[id].maths += minutes(bloc.debut, bloc.fin);
            else if (estLectureEcriture(g)) stats[id].lectureEcriture += minutes(bloc.debut, bloc.fin);
            else stats[id].autres += minutes(bloc.debut, bloc.fin);
          }

          // Placement prioritaire : AESH puis autonomie, avec repli sur le
          // circuit standard si le groupe spécial n'a pas pu être créé
          // (limite de 3 groupes déjà atteinte par des créneaux fixes).
          elevesAesh.forEach(e => { if (ids.has(e.identifiantSynapses)) { if (groupeAesh) placerEleve(e, groupeAesh); else elevesStandard.push(e); } });
          elevesAutonomes.forEach(e => { if (ids.has(e.identifiantSynapses)) { if (groupeAutonomie) placerEleve(e, groupeAutonomie); else elevesStandard.push(e); } });

          elevesStandard.forEach(e => {
            const id = e.identifiantSynapses;
            if (!ids.has(id)) return;
            const g = choisirGroupe(bloc, e, groupesDisponibles);
            if (!g) return;

            // Un groupe auto de niveau différent n'est accepté que si aucun
            // groupe du bon niveau n'est disponible.
            const n = niveauEleve(e);
            const bonNiveau = groupesDisponibles.find(x =>
              x !== g && niveauDe(x.niveau || "") === n
            );
            if (bonNiveau) {
              const g2 = choisirGroupe(bloc, e, [bonNiveau]);
              if (g2 && (g2.eleves || []).length <= (g.eleves || []).length + 2) {
                placerEleve(e, g2);
                return;
              }
            }

            placerEleve(e, g);
          });
        });

        journal[iso] = jour;
      });
    });

    sauverJournal(journal);
    return {
      jours: Object.keys(journal).length,
      ajouts: nbAjouts,
      groupes: nbGroupes,
      groupesEnseignant: nbGroupesEnseignant,
      groupesAesh: nbGroupesAesh,
      groupesAutonomie: nbGroupesAutonomie,
      objectifs: {
        cycle2: { francais: "10 h/semaine", maths: "5 h/semaine" },
        cycle3: { francais: "8 h/semaine", maths: "5 h/semaine" }
      }
    };
  }

  // ========================================================================
  // GROUPES DE BESOIN ULIS — élèves du coffre, selon leur classe de référence
  // ========================================================================
  //
  // Modèle de données réel (synapses-coffre.js) : chaque élève du coffre a
  // un champ `classe`, la CLASSE DE RÉFÉRENCE (ex. "CM2A"), qui peut être
  // vide (élève suivi à temps plein par l'enseignant, sans inclusion) ou
  // renseignée (élève partiellement inclus dans cette classe). Il n'existe
  // PAS de champ `niveau` séparé : la classe de référence est la seule
  // source fiable pour connaître le niveau (donc le cycle BO) de l'élève
  // et pour savoir, créneau par créneau, s'il est en inclusion dans sa
  // classe ou disponible pour l'enseignant.
  //
  // La répartition prend donc la classe en compte à trois niveaux :
  //  1. DISPONIBILITÉ : un créneau n'est proposé à un élève que si SA
  //     classe de référence (si elle correspond à une classe connue de la
  //     configuration) n'y a pas déjà cours — sinon l'élève y est présumé
  //     en inclusion. Un élève sans classe de référence connue est
  //     considéré disponible dès lors que l'enseignant lui-même est libre.
  //  2. NIVEAU / CYCLE : le niveau (et donc le cycle BO n°44) est déduit en
  //     priorité de la classe de référence (ex. "CM2A" → CM2 → cycle3),
  //     avec repli sur l'équivalence scolaire si la classe est inconnue.
  //  3. REGROUPEMENT : les groupes de besoin mélangent les élèves
  //     disponibles au même moment, quelle que soit leur classe de
  //     référence, par domaine BO prioritaire puis par niveau.
  //
  // Cette fonction ÉCRASE le cahier journal sur les créneaux qu'elle
  // gère : elle fait partie de la génération du planning et non d'une
  // simple suggestion consultée à part. Elle ne touche jamais :
  //  - aux créneaux de classe (fixe ou non) ;
  //  - à un groupe ULIS que l'enseignant a modifié à la main
  //    (modifie:true sans repartitionAuto).

  /**
   * Découpe la journée (jourSemaine) en segments contigus délimités par
   * TOUS les points de début/fin de créneau de TOUTES les classes de la
   * configuration ce jour-là. Chaque segment est donc assez fin pour que
   * la classe de référence d'un élève soit constamment "en cours" ou
   * constamment "libre" sur toute sa durée.
   *
   * Retourne { segments: [{debut, fin} en minutes], creneauxParClasse }
   * où creneauxParClasse associe classeId -> [{debut, fin}] pour ce jour.
   */
  function segmenterJourneeParClasses(jourSemaine, config, grilles) {
    const classes = (config.classes && config.classes.length) ? config.classes : [];
    const points = new Set();
    const creneauxParClasse = {};
    let debutJournee = null, finJournee = null;

    classes.forEach(classe => {
      const cxs = (grilles[classe.id] || [])
        .filter(c => c.jour === jourSemaine)
        .map(c => ({ debut: heureVersMin(c.debut), fin: heureVersMin(c.fin) }));
      creneauxParClasse[classe.id] = cxs;
      cxs.forEach(({ debut, fin }) => {
        points.add(debut);
        points.add(fin);
        debutJournee = debutJournee === null ? debut : Math.min(debutJournee, debut);
        finJournee = finJournee === null ? fin : Math.max(finJournee, fin);
      });
    });

    if (debutJournee === null) return { segments: [], creneauxParClasse };

    const bornes = Array.from(points)
      .filter(p => p >= debutJournee && p <= finJournee)
      .sort((a, b) => a - b);

    const segments = [];
    for (let i = 0; i < bornes.length - 1; i++) {
      const debut = bornes[i], fin = bornes[i + 1];
      if (fin - debut < 15) continue; // on ignore les micro-interstices
      segments.push({ debut, fin });
    }
    return { segments, creneauxParClasse };
  }

  /**
   * Retrouve la classe de la configuration correspondant au libellé de
   * classe de référence d'un élève (ex. "CM2A"), par id ou par nom,
   * comparaison normalisée (accents/casse ignorés).
   */
  function classeDeReferenceCorrespondante(nomClasse, config) {
    if (!nomClasse) return null;
    const n = String(nomClasse).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    return (config.classes || []).find(c => {
      const idN = String(c.id || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const nomN = String(c.nom || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      return idN === n || nomN === n;
    }) || null;
  }

  /**
   * Détermine, pour un jour donné, les plages horaires « libres » pour
   * l'enseignant ULIS : les intervalles de temps sur lesquels AUCUNE
   * classe de la configuration n'a de créneau dans sa grille ce jour-là.
   * Conservée pour affichage / usages externes ; la génération des
   * groupes de besoin ULIS ci-dessous raisonne désormais créneau par
   * créneau et classe de référence par classe de référence (plus fin).
   */
  function plagesLibresEnseignant(jourSemaine, config, grilles) {
    const { segments, creneauxParClasse } = segmenterJourneeParClasses(jourSemaine, config, grilles);
    const toutesOccupations = Object.values(creneauxParClasse).flat();
    const minToHeure = m => pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
    return segments
      .filter(s => !toutesOccupations.some(o => o.debut < s.fin && o.fin > s.debut))
      .map(s => ({ debut: minToHeure(s.debut), fin: minToHeure(s.fin) }));
  }

  /**
   * Construit les groupes de besoin ULIS sur les créneaux libres du
   * cahier journal, semaine par semaine, en tenant compte de la classe de
   * référence de chaque élève (disponibilité + niveau), et en écrasant
   * les groupes automatiques ULIS précédemment générés (repartitionAuto +
   * profilUlis).
   */
  function genererGroupesBesoinULIS(config, grilles, coffre) {
    if (!coffre || !coffre.ouvert) {
      throw new Error("Ouvrez le coffre avant de générer les groupes ULIS.");
    }

    const norm = v => String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const niveauDe = v => {
      const s = norm(v);
      const m = s.match(/\b(tps|ps|ms|gs|cp|ce1|ce2|cm1|cm2)\b/);
      return m ? m[1].toUpperCase() : "";
    };

    // Niveau de l'élève : déduit en priorité de sa classe de référence
    // (seule donnée réellement présente dans le coffre pour cela), avec
    // repli sur l'équivalence scolaire (français puis mathématiques) si
    // la classe de référence est absente ou ne permet pas d'isoler un
    // niveau (ex. libellé libre non standard).
    const niveauEleve = e => {
      const parClasse = niveauDe(e.classe);
      if (parClasse) return parClasse;
      const eq = e.equivalenceScolaire || {};
      return niveauDe((eq.francais && eq.francais.niveauEquivalent) ||
        (eq.mathematiques && eq.mathematiques.niveauEquivalent) || "");
    };

    const niveauEquivalentSujet = (e, matiere) => {
      const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
      const v = eq && eq.niveauEquivalent;
      return v ? niveauDe(v) || niveauEleve(e) : niveauEleve(e);
    };

    const besoinsEtObjectifs = e => {
      const besoins = (e.besoins || []).map(x =>
        x && typeof x === "object" ? (x.hypothese || x.domaine || x.champ || "") : x
      );
      const objectifs = (e.objectifs || [])
        .filter(x => !x || !x.statut || x.statut === "actif")
        .map(x => x && typeof x === "object" ? (x.libelle || x.domaine || "") : x);
      return besoins.concat(objectifs).map(norm).filter(Boolean);
    };

    const eleves = coffre.listerEleves ? coffre.listerEleves() : [];
    if (!eleves.length) {
      return { jours: 0, groupes: 0, ajouts: 0, message: "Aucun élève dans le coffre." };
    }

    // Classe de référence de chaque élève, résolue une fois pour toutes
    // face à la configuration (id de classe ou null si non trouvée /
    // élève sans classe de référence).
    const classeRefParEleve = new Map(
      eleves.map(e => [e.identifiantSynapses, classeDeReferenceCorrespondante(e.classe, config)])
    );

    const semaines = calculerSemaines(config || {});
    const joursTravail = new Set((config.joursTravailles || [1, 2, 3, 4, 5]).map(Number));
    const journal = chargerJournal();
    // Le planning individuel stocké dans le coffre de chaque élève est la
    // seule source de vérité pour savoir si l'élève occupe déjà un créneau.
    const eleveOccupeSurSegment = (e, jourN, debut, fin) => {
      const plan = Array.isArray(e.planning) ? e.planning : [];
      return plan.some(p =>
        Number(p.jour) === Number(jourN) &&
        heureVersMin(p.debut) < fin &&
        heureVersMin(p.fin) > debut
      );
    };

    // Domaines BO à couvrir, dans l'ordre de priorité (français/maths
    // d'abord, comme pour les classes), pour chaque cycle représenté
    // parmi les élèves ULIS suivis.
    const ORDRE_DOMAINES = [
      "francais", "mathematiques", "eps", "languesVivantes",
      "questionnerLeMonde", "histoireGeographie", "sciencesTechnologie",
      "artsEducationMusicale", "emc"
    ];

    const libelleDomaine = {
      francais: "Français", mathematiques: "Mathématiques", eps: "EPS",
      languesVivantes: "Langues vivantes", questionnerLeMonde: "Questionner le monde",
      histoireGeographie: "Histoire-géographie", sciencesTechnologie: "Sciences et technologie",
      artsEducationMusicale: "Arts / éducation musicale", emc: "EMC", mixte: "Besoins ciblés"
    };

    let nbJours = 0;
    let nbGroupes = 0;
    let nbAjouts = 0;

    // Minutes déjà couvertes par élève et par domaine BO, remises à zéro
    // à chaque semaine (le volume horaire du BO n°44 est hebdomadaire).
    let stats = new Map();
    function initStats() {
      stats = new Map(eleves.map(e => [e.identifiantSynapses, {}]));
    }

    function domaineCibleDe(e) {
      const cycle = cycleDuNiveau(niveauEleve(e)) || "cycle2";
      const cibles = BO_VOLUMES_HEBDO[cycle];
      const fait = stats.get(e.identifiantSynapses) || {};
      const besoins = besoinsEtObjectifs(e);

      let meilleur = null, meilleurEcart = -Infinity;
      ORDRE_DOMAINES.forEach(dom => {
        if (cibles[dom] === undefined) return;
        const restant = cibles[dom] - (fait[dom] || 0);
        if (restant <= 0) return;
        // Un domaine explicitement mentionné dans les besoins/objectifs
        // actifs de l'élève est favorisé.
        const bonus = besoins.some(b => domaineBoDe(b) === dom) ? 200 : 0;
        const ecart = restant + bonus;
        if (ecart > meilleurEcart) { meilleurEcart = ecart; meilleur = dom; }
      });
      return meilleur || "francais";
    }

    const minToHeure = m => pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);

    semaines.forEach(sem => {
      initStats();

      JOURS.forEach(j => {
        if (!joursTravail.has(j.n)) return;

        const { segments, creneauxParClasse } = segmenterJourneeParClasses(j.n, config, grilles);
        if (!segments.length) return;

        const iso = dateISO(addDays(sem.lundi, j.n - 1));
        const jour = journalPourDate(iso, journal);
        nbJours++;

        // On repart de zéro pour les groupes ULIS automatiques de ce
        // jour : ils sont entièrement reconstruits (écrasés), pas
        // seulement leur liste d'élèves — sauf ceux retouchés à la main.
        jour.groupes = jour.groupes.filter(g => !(g.profilUlis && g.repartitionAuto && !g.personnalise));

        // Élève disponible sur un segment : sa classe de référence (si
        // connue de la configuration) n'y a pas cours ce jour-là.
        function eleveDisponible(e, segment) {
          const id = e.identifiantSynapses;
          if (eleveOccupeSurSegment(e, j.n, segment.debut, segment.fin)) {
            return false; // déjà affecté à un créneau enregistré dans son coffre
          }
          const classeRef = classeRefParEleve.get(id);
          if (!classeRef) return true; // pas de classe de référence connue -> suivi enseignant
          const plan = Array.isArray(e.planning) ? e.planning : [];
          const planClasse = plan.filter(p => p.classeId === classeRef.id);
          if (planClasse.length) return true; // le planning individuel fait foi
          const cxs = creneauxParClasse[classeRef.id] || [];
          return !cxs.some(c => c.debut < segment.fin && c.fin > segment.debut);
        }

        // Propositions de groupes segment par segment, avant fusion des
        // segments consécutifs identiques (même domaine, mêmes élèves).
        const propositions = [];

        segments.forEach(segment => {
          // Un créneau ULIS n'est généré que s'il est réellement libre
          // dans le cahier journal de l'enseignant : aucun groupe (fixe
          // ou non) n'y chevauche déjà, hormis les anciens groupes ULIS
          // auto qu'on vient de retirer ci-dessus.
          const occupe = jour.groupes.some(g => {
            const dg = heureVersMin(g.debut), fg = heureVersMin(g.fin);
            return dg < segment.fin && fg > segment.debut;
          });
          if (occupe) return;

          const disponibles = eleves.filter(e => eleveDisponible(e, segment));
          if (!disponibles.length) return;

          // Regroupement par domaine cible puis par niveau d'équivalence
          // scolaire dans ce domaine (groupes de besoin), avec un maximum
          // de 3 groupes simultanés sur le segment, comme pour les classes.
          const parGroupe = new Map(); // clé "domaine|niveau" -> {eleves, domaine, niveau}
          disponibles.forEach(e => {
            const dom = domaineCibleDe(e);
            const niv = /francais|mathematiques/.test(dom)
              ? niveauEquivalentSujet(e, dom === "francais" ? "francais" : "mathematiques")
              : niveauEleve(e);
            const cle = dom + "|" + (niv || "");
            if (!parGroupe.has(cle)) parGroupe.set(cle, { domaine: dom, niveau: niv, eleves: [] });
            parGroupe.get(cle).eleves.push(e);
          });

          let entrees = Array.from(parGroupe.values());
          if (entrees.length > 3) {
            // On fusionne les groupes les moins fournis pour tenir dans
            // la limite de 3 groupes simultanés.
            entrees.sort((a, b) => b.eleves.length - a.eleves.length);
            const gardes = entrees.slice(0, 2);
            const reste = entrees.slice(2);
            const fusion = { domaine: "mixte", niveau: "", eleves: [] };
            reste.forEach(x => fusion.eleves.push(...x.eleves));
            entrees = gardes.concat([fusion]);
          }

          entrees.forEach(entree => {
            if (!entree.eleves.length) return;
            propositions.push({
              debut: segment.debut,
              fin: segment.fin,
              domaine: entree.domaine,
              niveau: entree.niveau || "",
              eleveIds: entree.eleves.map(e => e.identifiantSynapses).filter(Boolean).sort()
            });
            const dureeMin = segment.fin - segment.debut;
            entree.eleves.forEach(e => {
              const fait = stats.get(e.identifiantSynapses) || {};
              fait[entree.domaine] = (fait[entree.domaine] || 0) + dureeMin;
              stats.set(e.identifiantSynapses, fait);
            });
          });
        });

        // Fusion des segments consécutifs portant exactement le même
        // groupe (domaine + composition d'élèves), pour éviter de
        // fragmenter une même séance ULIS en une multitude de créneaux
        // de quelques minutes.
        propositions.sort((a, b) => a.debut - b.debut);
        const fusionnees = [];
        propositions.forEach(p => {
          const precedent = fusionnees[fusionnees.length - 1];
          const memeGroupe = precedent &&
            precedent.fin === p.debut &&
            precedent.domaine === p.domaine &&
            precedent.niveau === p.niveau &&
            precedent.eleveIds.length === p.eleveIds.length &&
            precedent.eleveIds.every((id, i) => id === p.eleveIds[i]);
          if (memeGroupe) {
            precedent.fin = p.fin;
          } else {
            fusionnees.push(Object.assign({}, p));
          }
        });

        fusionnees.forEach(entree => {
          const titre = "ULIS — " + (libelleDomaine[entree.domaine] || entree.domaine) +
            (entree.niveau ? " (" + entree.niveau + ")" : "");
          const g = {
            id: uid("grp"),
            debut: minToHeure(entree.debut),
            fin: minToHeure(entree.fin),
            origine: null,
            modifie: true,
            adulte: { type: "enseignant", nom: "" },
            titre: titre,
            domaineCle: entree.domaine,
            niveau: entree.niveau || "",
            classeId: "",
            seanceRef: null,
            eleves: entree.eleveIds,
            remarque: "Groupe de besoin ULIS généré automatiquement (créneau libre au regard des classes de référence, référentiel BO n°44 du 26/11/2015).",
            fixe: false,
            repartitionAuto: true,
            personnalise: false,
            profilUlis: true
          };
          jour.groupes.push(g);
          nbGroupes++;
          nbAjouts += g.eleves.length;
        });

        journal[iso] = jour;
      });
    });

    sauverJournal(journal);
    return {
      jours: nbJours,
      groupes: nbGroupes,
      ajouts: nbAjouts,
      eleves: eleves.length,
      referentiel: "BO n°44 du 26/11/2015 (MENE1526553A)"
    };
  }

  /**
   * Génère les groupes des dispositifs rattachés aux classes.
   *
   * Les dispositifs disposent de leur propre grille horaire, sans niveau.
   * À chaque génération, un créneau de dispositif peut accueillir les
   * élèves des classes rattachées qui sont libres à cet horaire selon leur
   * planning individuel stocké dans leur coffre. Aucune donnée nominative
   * n'est écrite dans le stockage local du planning.
   */
  function genererGroupesDispositifs(config, grilles, coffre) {
    const dispositifsConfigures = config.dispositifs || [];
    if (!dispositifsConfigures.length) {
      return { dispositifs: 0, groupes: 0, eleves: 0, raisons: [] };
    }
    if (!coffre || !coffre.ouvert) {
      return { dispositifs: 0, groupes: 0, eleves: 0, raisons: ["Ouvrez le coffre pour générer le planning des dispositifs."] };
    }

    const eleves = coffre.listerEleves ? coffre.listerEleves() : [];
    if (!eleves.length) {
      return { dispositifs: 0, groupes: 0, eleves: 0, raisons: ["Aucun élève dans le coffre ouvert."] };
    }

    const classes = config.classes || [];
    const semaines = calculerSemaines(config || {});
    const joursTravail = new Set((config.joursTravailles || [1,2,3,4,5]).map(Number));
    const journal = chargerJournal();
    let groupes = 0, nbEleves = 0, nbDispositifs = 0;
    const raisons = [];

    const planningDe = e => Array.isArray(e.planning) ? e.planning : [];
    const chevauche = (a,b,c,d) => a < d && c < b;

    dispositifsConfigures.forEach(disp => {
      const classesLiees = classes.filter(cl => (cl.dispositifs || []).includes(disp.id));
      if (!classesLiees.length) {
        raisons.push(`« ${disp.nom} » n'est rattaché à aucune classe (Configuration générale → Classes → Dispositifs).`);
        return;
      }
      const classeIds = new Set(classesLiees.map(cl => cl.id));
      const grille = (grilles[disp.id] || []).filter(c => c.type === "seance" || c.type === "autre");
      if (!grille.length) {
        raisons.push(`La grille horaire de « ${disp.nom} » est vide (onglet Génération → « Générer le planning du dispositif »).`);
        return;
      }
      nbDispositifs++;
      let nbEleveConcernesDisp = 0;

      semaines.forEach(sem => {
        JOURS.forEach(j => {
          if (!joursTravail.has(j.n)) return;
          const iso = dateISO(addDays(sem.lundi, j.n - 1));
          const jour = journalPourDate(iso, journal);

          // Les groupes générés précédemment pour ce dispositif sont
          // reconstruits, sauf s'ils ont été retouchés dans le cahier journal.
          jour.groupes = jour.groupes.filter(g =>
            !(g.profilDispositif && g.dispositifId === disp.id &&
              g.repartitionAuto && !g.personnalise)
          );

          grille.filter(c => c.jour === j.n)
            .sort((a,b) => heureVersMin(a.debut)-heureVersMin(b.debut))
            .forEach(c => {
              const debut = heureVersMin(c.debut), fin = heureVersMin(c.fin);
              // N'est « occupé » qu'un créneau où le DISPOSITIF possède déjà
              // un groupe (conservé ci-dessus car personnalisé) sur cet
              // horaire exact. Les groupes des CLASSES à cette même heure ne
              // comptent pas : c'est précisément le principe d'un dispositif
              // comme ULIS que d'accueillir des élèves PENDANT que leur
              // classe a cours ailleurs — sinon aucun créneau de dispositif
              // ne serait jamais généré, puisqu'à toute heure de la journée
              // une classe ou une autre a nécessairement cours.
              const occupe = jour.groupes.some(g =>
                g.profilDispositif && g.dispositifId === disp.id &&
                heureVersMin(g.debut) < fin && heureVersMin(g.fin) > debut
              );
              if (occupe) return;

              // Sécurité : les créneaux du dispositif sont persistés sans
              // identité d'élève. Les élèves sont rechargés exclusivement
              // depuis le coffre et leur planning individuel fait foi.
              const disponibles = eleves.filter(e => {
                const plan = planningDe(e);
                const planClasses = plan.filter(p => classeIds.has(p.classeId));
                if (planClasses.length) {
                  return !planClasses.some(p =>
                    Number(p.jour) === j.n &&
                    chevauche(heureVersMin(p.debut), heureVersMin(p.fin), debut, fin)
                  );
                }
                const classeRef = classeDeReferenceCorrespondante(e.classe, config);
                if (!classeRef || !classeIds.has(classeRef.id)) return false;
                return !(grilles[classeRef.id] || []).some(cx =>
                  cx.jour === j.n &&
                  chevauche(heureVersMin(cx.debut), heureVersMin(cx.fin), debut, fin)
                );
              });
              if (!disponibles.length) return;

              const nom = (c.type === "seance" ? c.titre : c.libelle) || disp.nom;
              jour.groupes.push({
                id: uid("grp"),
                debut: c.debut, fin: c.fin,
                origine: disp.id + "__" + c.id,
                modifie: false,
                adulte: { type: "enseignant", nom: "" },
                titre: nom,
                domaineCle: "",
                niveau: "",
                classeId: "",
                dispositifId: disp.id,
                dispositifType: disp.type,
                seanceRef: null,
                eleves: disponibles.map(e => e.identifiantSynapses).filter(Boolean),
                remarque: `Groupe ${disp.type} généré à partir du créneau libre du dispositif.`,
                fixe: false,
                repartitionAuto: true,
                personnalise: false,
                profilDispositif: true
              });
              groupes++;
              nbEleves += disponibles.length;
              nbEleveConcernesDisp += disponibles.length;
            });
        });
      });

      if (!nbEleveConcernesDisp) {
        raisons.push(`Aucun élève du coffre n'est disponible sur les créneaux de « ${disp.nom} » (vérifiez la classe de référence des élèves et leur planning individuel dans l'onglet Affectation).`);
      }
    });

    sauverJournal(journal);
    return { dispositifs: nbDispositifs, groupes, eleves: nbEleves, raisons };
  }

  /**
   * Répartit les élèves d'un dispositif (ULIS, SEGPA, RASED, …) en
   * groupes de besoin, créneau par créneau, sur les créneaux « séance »
   * de sa grille horaire — dans la limite de 3 groupes simultanés, comme
   * pour les créneaux composés à la main dans le cahier journal.
   *
   * Principe : pour chaque créneau de la grille du dispositif, on
   * retrouve les élèves disponibles (même calcul de disponibilité que
   * genererGroupesDispositifs, à partir du planning individuel du
   * coffre), puis on les regroupe par domaine BO ciblé en priorité
   * (français/mathématiques d'abord), en tenant compte du volume horaire
   * hebdomadaire déjà couvert (BO n°44 du 26/11/2015) et des besoins /
   * objectifs actifs déclarés dans le coffre. S'il reste plus de 3
   * groupes de besoin distincts sur un même créneau, les plus petits sont
   * fusionnés en un groupe « Besoins ciblés » pour respecter la limite.
   *
   * Cette fonction ne touche jamais un créneau dont un des groupes de
   * besoin a été personnalisé à la main (personnalise:true) : l'enseignant
   * garde toujours la main sur une répartition qu'il a retouchée.
   */
  function repartirGroupesBesoinDispositif(config, grilles, coffre, dispositifId) {
    const disp = dispositifById(config, dispositifId);
    if (!disp) {
      return { groupes: 0, eleves: 0, jours: 0, raisons: ["Dispositif introuvable."] };
    }
    if (!coffre || !coffre.ouvert) {
      return { groupes: 0, eleves: 0, jours: 0, raisons: ["Ouvrez le coffre avant de répartir les élèves."] };
    }

    const classes = config.classes || [];
    const classesLiees = classes.filter(cl => (cl.dispositifs || []).includes(disp.id));
    if (!classesLiees.length) {
      return { groupes: 0, eleves: 0, jours: 0, raisons: [`« ${disp.nom} » n'est rattaché à aucune classe (Configuration générale → Classes → Dispositifs).`] };
    }
    const classeIds = new Set(classesLiees.map(cl => cl.id));

    const grille = (grilles[disp.id] || []).filter(c => c.type === "seance");
    if (!grille.length) {
      return { groupes: 0, eleves: 0, jours: 0, raisons: [`La grille horaire de « ${disp.nom} » ne contient aucun créneau de séance à répartir.`] };
    }

    const eleves = coffre.listerEleves ? coffre.listerEleves() : [];
    if (!eleves.length) {
      return { groupes: 0, eleves: 0, jours: 0, raisons: ["Aucun élève dans le coffre ouvert."] };
    }

    const norm = v => String(v || "")
      .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
    const niveauDe = v => {
      const s = norm(v);
      const m = s.match(/\b(tps|ps|ms|gs|cp|ce1|ce2|cm1|cm2)\b/);
      return m ? m[1].toUpperCase() : "";
    };
    const niveauEleve = e => {
      const parClasse = niveauDe(e.classe);
      if (parClasse) return parClasse;
      const eq = e.equivalenceScolaire || {};
      return niveauDe((eq.francais && eq.francais.niveauEquivalent) ||
        (eq.mathematiques && eq.mathematiques.niveauEquivalent) || "");
    };
    const niveauEquivalentSujet = (e, matiere) => {
      const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
      const v = eq && eq.niveauEquivalent;
      return v ? (niveauDe(v) || niveauEleve(e)) : niveauEleve(e);
    };
    const besoinsEtObjectifs = e => {
      const besoins = (e.besoins || []).map(x =>
        x && typeof x === "object" ? (x.hypothese || x.domaine || x.champ || "") : x
      );
      const objectifs = (e.objectifs || [])
        .filter(x => !x || !x.statut || x.statut === "actif")
        .map(x => x && typeof x === "object" ? (x.libelle || x.domaine || "") : x);
      return besoins.concat(objectifs).map(norm).filter(Boolean);
    };

    const ORDRE_DOMAINES = [
      "francais", "mathematiques", "eps", "languesVivantes",
      "questionnerLeMonde", "histoireGeographie", "sciencesTechnologie",
      "artsEducationMusicale", "emc"
    ];
    const libelleDomaine = {
      francais: "Français", mathematiques: "Mathématiques", eps: "EPS",
      languesVivantes: "Langues vivantes", questionnerLeMonde: "Questionner le monde",
      histoireGeographie: "Histoire-géographie", sciencesTechnologie: "Sciences et technologie",
      artsEducationMusicale: "Arts / éducation musicale", emc: "EMC", mixte: "Besoins ciblés"
    };

    let stats = new Map();
    function initStats() { stats = new Map(eleves.map(e => [e.identifiantSynapses, {}])); }
    function domaineCibleDe(e) {
      const cycle = cycleDuNiveau(niveauEleve(e)) || "cycle2";
      const cibles = BO_VOLUMES_HEBDO[cycle];
      const fait = stats.get(e.identifiantSynapses) || {};
      const besoins = besoinsEtObjectifs(e);
      let meilleur = null, meilleurEcart = -Infinity;
      ORDRE_DOMAINES.forEach(dom => {
        if (cibles[dom] === undefined) return;
        const restant = cibles[dom] - (fait[dom] || 0);
        if (restant <= 0) return;
        const bonus = besoins.some(b => domaineBoDe(b) === dom) ? 200 : 0;
        const ecart = restant + bonus;
        if (ecart > meilleurEcart) { meilleurEcart = ecart; meilleur = dom; }
      });
      return meilleur || "francais";
    }

    const planningDe = e => Array.isArray(e.planning) ? e.planning : [];
    const chevauche = (a, b, c, d) => a < d && c < b;
    const disponiblesSurCreneau = (debut, fin, jourN) => eleves.filter(e => {
      const plan = planningDe(e);
      const planClasses = plan.filter(p => classeIds.has(p.classeId));
      if (planClasses.length) {
        return !planClasses.some(p =>
          Number(p.jour) === jourN && chevauche(heureVersMin(p.debut), heureVersMin(p.fin), debut, fin)
        );
      }
      const classeRef = classeDeReferenceCorrespondante(e.classe, config);
      if (!classeRef || !classeIds.has(classeRef.id)) return false;
      return !(grilles[classeRef.id] || []).some(cx =>
        cx.jour === jourN && chevauche(heureVersMin(cx.debut), heureVersMin(cx.fin), debut, fin)
      );
    });

    const semaines = calculerSemaines(config || {});
    const joursTravail = new Set((config.joursTravailles || [1,2,3,4,5]).map(Number));
    const journal = chargerJournal();
    let nbJours = 0, nbGroupes = 0, nbEleves = 0;
    const raisons = [];
    let creneauxIgnoresPersonnalises = 0;

    semaines.forEach(sem => {
      initStats();
      JOURS.forEach(j => {
        if (!joursTravail.has(j.n)) return;
        const iso = dateISO(addDays(sem.lundi, j.n - 1));
        const jour = journalPourDate(iso, journal);
        nbJours++;

        grille.filter(c => c.jour === j.n)
          .sort((a, b) => heureVersMin(a.debut) - heureVersMin(b.debut))
          .forEach(c => {
            const origine = disp.id + "__" + c.id;
            if (jour.exclusions.indexOf(origine) !== -1) return;

            const groupesActuels = jour.groupes.filter(g => g.origine === origine);
            if (groupesActuels.some(g => g.personnalise)) {
              creneauxIgnoresPersonnalises++;
              return; // l'enseignant a retouché ce créneau : on n'y touche plus
            }

            const debut = heureVersMin(c.debut), fin = heureVersMin(c.fin);
            const disponibles = disponiblesSurCreneau(debut, fin, j.n);
            if (!disponibles.length) return;

            // On repart de zéro pour ce créneau (groupe fusionné unique
            // OU précédente répartition automatique non personnalisée).
            jour.groupes = jour.groupes.filter(g => !groupesActuels.includes(g));

            const parGroupe = new Map(); // "domaine|niveau" -> {domaine, niveau, eleves}
            disponibles.forEach(e => {
              const dom = domaineCibleDe(e);
              const niv = /francais|mathematiques/.test(dom)
                ? niveauEquivalentSujet(e, dom === "francais" ? "francais" : "mathematiques")
                : niveauEleve(e);
              const cle = dom + "|" + (niv || "");
              if (!parGroupe.has(cle)) parGroupe.set(cle, { domaine: dom, niveau: niv, eleves: [] });
              parGroupe.get(cle).eleves.push(e);
            });

            let entrees = Array.from(parGroupe.values());
            if (entrees.length > 3) {
              entrees.sort((a, b) => b.eleves.length - a.eleves.length);
              const gardes = entrees.slice(0, 2);
              const reste = entrees.slice(2);
              const fusion = { domaine: "mixte", niveau: "", eleves: [] };
              reste.forEach(x => fusion.eleves.push(...x.eleves));
              entrees = gardes.concat([fusion]);
            }

            const dureeMin = fin - debut;
            entrees.forEach(entree => {
              if (!entree.eleves.length) return;
              const titre = disp.nom + " — " + (libelleDomaine[entree.domaine] || entree.domaine) +
                (entree.niveau ? " (" + entree.niveau + ")" : "");
              jour.groupes.push({
                id: uid("grp"),
                debut: c.debut, fin: c.fin,
                origine, modifie: false,
                adulte: { type: "enseignant", nom: "" },
                titre,
                domaineCle: entree.domaine,
                niveau: entree.niveau || "",
                classeId: "",
                dispositifId: disp.id,
                dispositifType: disp.type,
                seanceRef: null,
                eleves: entree.eleves.map(e => e.identifiantSynapses).filter(Boolean),
                remarque: "Groupe de besoin généré automatiquement au sein du créneau du dispositif (référentiel BO n°44 du 26/11/2015).",
                fixe: false,
                repartitionAuto: true,
                personnalise: false,
                profilDispositif: true,
                groupeBesoin: true
              });
              nbGroupes++;
              nbEleves += entree.eleves.length;
              entree.eleves.forEach(e => {
                const fait = stats.get(e.identifiantSynapses) || {};
                fait[entree.domaine] = (fait[entree.domaine] || 0) + dureeMin;
                stats.set(e.identifiantSynapses, fait);
              });
            });
          });

        journal[iso] = jour;
      });
    });

    if (creneauxIgnoresPersonnalises) {
      raisons.push(`${creneauxIgnoresPersonnalises} créneau(x) déjà personnalisé(s) à la main ont été conservés tels quels.`);
    }

    sauverJournal(journal);
    return { dispositif: disp.nom, jours: nbJours, groupes: nbGroupes, eleves: nbEleves, raisons };
  }

  /**
   * Génération complète et unifiée du planning.
   *
   *  1. Séquences/séances de classe, uniquement sur les créneaux encore
   *     libres du cahier journal (genererAffectations).
   *  2. Reconstruction du cahier journal à partir des grilles de classe
   *     pour toutes les semaines de l'année (genererJournalDepuisGrille),
   *     dans le respect des retouches manuelles déjà enregistrées.
   *  3. Groupes de besoin ULIS pour les élèves du coffre non affectés à
   *     une classe, sur les créneaux qui restent libres (dans l'emploi du
   *     temps de l'enseignant), au regard du volume horaire BO n°44.
   *
   * Cette fonction ÉCRASE le cahier journal existant sur tous les
   * créneaux qu'elle génère (elle ne touche jamais un créneau que
   * l'enseignant a modifié à la main).
   */
  async function genererPlanningComplet(config, grilles, affectationsExistantes, coffre) {
    if (!config.rentree) throw new Error("Renseignez une date de rentrée avant de générer.");
    if (!config.classes || !config.classes.length) throw new Error("Créez au moins une classe.");

    // 1) Séquences/séances de classe (créneaux libres uniquement).
    const affectations = await genererAffectations(config.classes, config, grilles, affectationsExistantes || {});
    sauverAffectations(affectations);

    // 2) Cahier journal reconstruit à partir des grilles, pour chaque
    // semaine/jour de l'année, avec la banque de séquences chargée.
    const banque = await chargerBanque();
    const semaines = calculerSemaines(config);
    const joursTravail = new Set((config.joursTravailles || [1, 2, 3, 4, 5]).map(Number));
    semaines.forEach(sem => {
      JOURS.forEach(j => {
        if (!joursTravail.has(j.n)) return;
        const iso = dateISO(addDays(sem.lundi, j.n - 1));
        genererJournalDepuisGrille(iso, config, grilles, affectations, banque, coffre);
      });
    });

    // 3) Les dispositifs (dont ULIS) suivent exactement la même logique que
    // les classes : leur grille est une source de créneaux, et le cahier
    // journal est synchronisé depuis cette grille. Il n'y a plus de
    // génération parallèle « par trous » du planning individuel.
    const dispositifs = (config.dispositifs || []).map(d => d.id).filter(id => Array.isArray(grilles[id]) && grilles[id].length).length;

    return { affectations, ulis: { jours: 0, groupes: 0, ajouts: 0, eleves: 0 }, dispositifs: { dispositifs, groupes: 0, eleves: 0 } };
  }

  // ========================================================================
  // IMPORT / EXPORT JSON DU PLANNING (fichier téléchargeable, hors USB)
  // ========================================================================

  // ========================================================================
  // EXPORT / IMPORT SÉCURISÉ DU PLANNING
  // ------------------------------------------------------------------------
  // Le coffre élèves utilise un fichier chiffré et un mot de passe. Le
  // planning complet peut contenir des identifiants d'élèves dans les
  // affectations et le cahier journal : il suit donc la même philosophie.
  // Le mot de passe n'est jamais stocké dans le paquet ni dans localStorage.
  // ========================================================================

  function exporterPlanningJSON(config, grilles, affectations, journal) {
    return {
      format: "synapses-planning",
      version: 5,
      maj: new Date().toISOString(),
      config: config || {},
      grilles: grilles || {},
      affectations: affectations || {},
      journal: journal || {}
    };
  }

  function _b64FromBytes(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for(let i=0;i<bytes.length;i+=chunk){
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+chunk, bytes.length)));
    }
    return btoa(binary);
  }

  function _bytesFromB64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function _derivePlanningKey(motDePasse, salt) {
    if(!window.crypto || !window.crypto.subtle) {
      throw new Error("Le chiffrement sécurisé n'est pas disponible dans ce navigateur.");
    }
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(String(motDePasse)), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name:"PBKDF2", salt, iterations:310000, hash:"SHA-256" },
      baseKey,
      { name:"AES-GCM", length:256 },
      false,
      ["encrypt","decrypt"]
    );
  }

  async function chiffrerPlanningJSON(paquet, motDePasse) {
    if(!motDePasse) throw new Error("Saisissez un mot de passe pour protéger le planning.");
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await _derivePlanningKey(motDePasse, salt);
    const clair = enc.encode(JSON.stringify(paquet));
    const chiffre = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, clair);
    return {
      format: "synapses-planning-secure",
      version: 1,
      algorithme: "AES-256-GCM",
      derivation: "PBKDF2-SHA-256",
      iterations: 310000,
      salt: _b64FromBytes(salt),
      iv: _b64FromBytes(iv),
      data: _b64FromBytes(new Uint8Array(chiffre))
    };
  }

  async function dechiffrerPlanningJSON(enveloppe, motDePasse) {
    if(!enveloppe || enveloppe.format !== "synapses-planning-secure") {
      throw new Error("Ce fichier n'est pas un export sécurisé de planning Synapses.");
    }
    if(!motDePasse) throw new Error("Saisissez le mot de passe du planning.");
    try{
      const salt = _bytesFromB64(enveloppe.salt);
      const iv = _bytesFromB64(enveloppe.iv);
      const chiffre = _bytesFromB64(enveloppe.data);
      const key = await _derivePlanningKey(motDePasse, salt);
      const clair = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, chiffre);
      const paquet = JSON.parse(new TextDecoder().decode(clair));
      if(!paquet || paquet.format !== "synapses-planning") throw new Error("Contenu de planning invalide.");
      return paquet;
    }catch(e){
      throw new Error("Mot de passe incorrect ou fichier de planning endommagé.");
    }
  }

  async function telechargerPlanningJSON(config, grilles, affectations, journal, motDePasse) {
    const paquet = exporterPlanningJSON(config, grilles, affectations, journal);
    const securise = await chiffrerPlanningJSON(paquet, motDePasse);
    const blob = new Blob([JSON.stringify(securise, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "synapses-planning-" + dateISO(new Date()) + ".synapses";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 0);
    return securise;
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
   * Applique un paquet de planning déjà déchiffré au stockage local courant.
   * Les anciens exports JSON en clair restent importables pour compatibilité,
   * mais tous les nouveaux exports complets sont chiffrés.
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
  // IMPORT DE SÉQUENCES / SÉANCES
  // ========================================================================

  /**
   * Importe une bibliothèque JSON de séquences/séances dans le stockage
   * local utilisé par chargerBanque(). Plusieurs formats sont acceptés :
   *  - { sequences: [...], seances: [...] }
   *  - { planif_sequences: [...], planif_seances: [...] }
   *  - { sequence: {...}, seances: [...] }
   *  - tableau de séquences, chacune pouvant contenir `seances`.
   *
   * L'import est un ajout/fusion par identifiant : les éléments existants
   * sont remplacés seulement lorsqu'un même identifiant est réimporté.
   */
  function importerBibliothequeJSON(payload) {
    if (!payload) throw new Error("Fichier de séquences/séances vide.");

    let sequences = [];
    let seances = [];

    if (Array.isArray(payload)) {
      if (payload.some(x => Array.isArray(x && x.seances))) {
        sequences = payload;
        payload.forEach(seq => (seq.seances || []).forEach(sea => {
          seances.push(Object.assign({}, sea, {
            sequence_id: sea.sequence_id || seq.id
          }));
        }));
      } else {
        seances = payload;
      }
    } else if (typeof payload === "object") {
      sequences = Array.isArray(payload.sequences)
        ? payload.sequences
        : Array.isArray(payload.planif_sequences)
          ? payload.planif_sequences
          : payload.sequence
            ? [payload.sequence]
            : [];
      seances = Array.isArray(payload.seances)
        ? payload.seances
        : Array.isArray(payload.planif_seances)
          ? payload.planif_seances
          : [];

      sequences.forEach(seq => (seq.seances || []).forEach(sea => {
        seances.push(Object.assign({}, sea, {
          sequence_id: sea.sequence_id || seq.id
        }));
      }));
    }

    const anciensSeq = JSON.parse(localStorage.getItem("planif_sequences") || "[]");
    const anciennesSea = JSON.parse(localStorage.getItem("planif_seances") || "[]");

    const fusion = (anciens, nouveaux) => {
      const map = new Map(anciens.filter(Boolean).map(x => [x.id, x]));
      nouveaux.filter(x => x && x.id).forEach(x => map.set(x.id, x));
      return Array.from(map.values());
    };

    const seqFinales = fusion(anciensSeq, sequences);
    const seaFinales = fusion(anciennesSea, seances);

    localStorage.setItem("planif_sequences", JSON.stringify(seqFinales));
    localStorage.setItem("planif_seances", JSON.stringify(seaFinales));

    return {
      sequences: sequences.filter(x => x && x.id).length,
      seances: seances.filter(x => x && x.id).length,
      totalSequences: seqFinales.length,
      totalSeances: seaFinales.length
    };
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
   * Un créneau du cahier journal est considéré « libre » pour la
   * génération automatique tant que personne n'y a touché à la main.
   *
   * On retrouve le groupe correspondant via son origine
   * (classeId + "__" + creneauId, voir genererJournalDepuisGrille) : s'il
   * existe et porte modifie:true, l'enseignant l'a explicitement retouché
   * dans le cahier journal (contenu, adulte, élèves, suppression…) et la
   * génération automatique ne doit pas l'écraser. Sinon, le créneau est
   * libre et peut recevoir la prochaine séance de la séquence en cours.
   */
  function creneauLibreDansJournal(journal, iso, classeId, creneauId) {
    const jour = journal[iso];
    if (!jour || !jour.groupes) return true;
    const origine = classeId + "__" + creneauId;
    const g = jour.groupes.find(x => x.origine === origine);
    return !g || !g.modifie;
  }

  /**
   * Génère automatiquement les séances dans les créneaux correspondants.
   *
   * Les affectations marquées manuel:true sont conservées, ainsi que tout
   * créneau que l'enseignant a modifié à la main dans le cahier journal :
   * la génération de séquences/séances n'a lieu QUE sur les créneaux
   * encore libres du cahier journal (voir creneauLibreDansJournal).
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


    // Le cahier journal fait foi : un créneau déjà retouché à la main
    // (contenu, groupes, élèves…) n'est jamais réécrit par la génération
    // automatique des séquences/séances, même si l'affectation brute ne
    // porte pas manuel:true.
    const journalActuel =
      chargerJournal();


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


                      // La génération de séquences/séances n'a lieu que
                      // sur les créneaux encore libres du cahier journal
                      // (aucune retouche manuelle enregistrée dessus).

                      if (
                        !creneauLibreDansJournal(
                          journalActuel,
                          iso,
                          niveau,
                          creneau.id
                        )
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


  // ------------------------------------------------------------------------
  // Coffre Synapses
  // ------------------------------------------------------------------------
  // Le core ne fabrique jamais de données individuelles. Les fonctions qui
  // répartissent les élèves prennent une instance Coffre réelle en argument.
  // Si aucun coffre ouvert n'est fourni, elles ne doivent produire aucune
  // donnée individuelle de secours.
  function elevesReelsDuCoffre(coffre) {
    if (!coffre || !coffre.ouvert || typeof coffre.listerEleves !== "function") {
      return [];
    }
    return coffre.listerEleves();
  }

  // ========================================================================
  // API PUBLIQUE
  // ========================================================================

  global.PlanningCore = {

    // Coffre
    elevesReelsDuCoffre,

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
    chevaucheMin,

    // Banque
    chargerBanque,
    chargerDerouleDeItem,
    importerBibliothequeJSON,

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
    dispositifById,
    classesDuService,

    // Grilles
    chargerGrilles,
    sauverGrilles,
    migrerStockageClasses,
    appliquerCreneauxFixes,

    // Affectations
    chargerAffectations,
    sauverAffectations,

    // Affectations manuelles élève ↔ créneau (onglet « Affectation »)
    STORE_AFFECT_ELEVES,
    chargerAffectationsEleves,
    sauverAffectationsEleves,
    cleAffectationEleve,
    elevesAffectesCreneau,
    affecterEleveCreneau,
    retirerEleveCreneau,
    eleveAffecteSurSegment,

    // Grille de présence créneau × élève (opt-out, roster de la classe)
    STORE_EXCLUSIONS_CRENEAU,
    chargerExclusionsCreneau,
    sauverExclusionsCreneau,
    estEleveExcluCreneau,
    definirPresenceEleveCreneau,

    // Calendrier
    cleCreneau,
    calculerSemaines,

    // Génération
    genererAffectations,
    genererGroupesDispositifs,
    repartirGroupesBesoinDispositif,
    genererPlanningComplet,

    // Référentiel horaire BO n°44 du 26/11/2015
    BO_VOLUMES_HEBDO,
    cycleDuNiveau,
    domaineBoDe,

    // Cahier journal
    chargerJournal,
    sauverJournal,
    journalPourDate,
    cleBloc,
    regrouperParBloc,
    libelleBloc,
    genererJournalDepuisGrille,
    repartirElevesAuto,
    repartirElevesSemaineAuto,
    genererGroupesBesoinULIS,
    plagesLibresEnseignant,
    segmenterJourneeParClasses,
    classeDeReferenceCorrespondante,

    // Import / export JSON
    exporterPlanningJSON,
    chiffrerPlanningJSON,
    dechiffrerPlanningJSON,
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
