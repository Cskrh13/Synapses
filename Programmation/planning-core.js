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

      niveauxActifs:
        []

    };

  }


  function sauverConfig(c) {

    localStorage.setItem(
      STORE_CONFIG,
      JSON.stringify(c)
    );

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
    niveaux,
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


    niveaux.forEach(
      niveau => {

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
              banque[niveau] &&
              banque[niveau][domaineCle]
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

    // Stockage
    STORE_CONFIG,
    STORE_GRILLES,
    STORE_AFFECT,

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

    // Grilles
    chargerGrilles,
    sauverGrilles,

    // Affectations
    chargerAffectations,
    sauverAffectations,

    // Calendrier
    cleCreneau,
    calculerSemaines,

    // Génération
    genererAffectations,

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
