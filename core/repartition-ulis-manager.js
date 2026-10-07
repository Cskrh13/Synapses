/**
 * Synapses 2.0 — core/repartition-ulis-manager.js
 * ============================================================================
 * Portage fidèle de genererGroupesBesoinULIS (planning-core.js, l. 3013) :
 * construction des groupes de besoin ULIS sur les créneaux libres du cahier
 * journal, semaine par semaine, à partir des classes de référence, du profil
 * de chaque élève (besoins / objectifs actifs, équivalences scolaires) et des
 * volumes hebdomadaires du BO n°44 du 26/11/2015.
 *
 * Contrainte RGPD (§4 du document d'architecture) :
 *   - la liste des élèves ne provient JAMAIS de localStorage ; elle est lue
 *     via DataManager.getProtege("eleves"), donc via le Coffre ouvert ;
 *   - seuls des identifiants Synapses (ELEVE-xxxx) sont écrits dans le
 *     journal, jamais un nom ni une donnée nominative ;
 *   - ce manager n'écrit jamais dans le Coffre (lecture seule côté protégé).
 *
 * Aucun changement de logique, de seuil ni de libellé par rapport à la V1 :
 * les mêmes entrées produisent exactement le même journal (voir le test de
 * non-régression qui compare les deux implémentations).
 *
 * Dépendances (à charger avant) :
 *   core/referentiel-horaire.js, core/calendrier-scolaire.js,
 *   core/adapters/local-adapter.js, core/adapters/journal-adapter.js
 */
(function (global) {
  "use strict";

  const { ReferentielHoraire, CalendrierScolaire, JournalAdapter } = global.SynapsesCore;

  // Domaines BO à couvrir, dans l'ordre de priorité (français/mathématiques
  // d'abord, comme pour les classes). Ordre repris à l'identique de la V1.
  const ORDRE_DOMAINES = [
    "francais", "mathematiques", "eps", "languesVivantes",
    "questionnerLeMonde", "histoireGeographie", "sciencesTechnologie",
    "artsEducationMusicale", "emc"
  ];

  const REMARQUE_AUTO =
    "Groupe de besoin ULIS généré automatiquement (créneau libre au regard " +
    "des classes de référence, référentiel BO n°44 du 26/11/2015).";

  const REFERENTIEL = "BO n°44 du 26/11/2015 (MENE1526553A)";

  const BONUS_BESOIN_DECLARE = 200; // priorité donnée à un domaine déclaré
  const MAX_GROUPES_SIMULTANES = 3;

  class RepartitionUlisManager {
    /**
     * @param {object} options
     * @param {object} options.dataManager   - DataManager (lecture protégée des élèves)
     * @param {object} [options.journalAdapter] - JournalAdapter (défaut : nouveau)
     * @param {function} [options.uid]       - générateur d'identifiants de groupe
     */
    constructor(options) {
      options = options || {};
      this.data = options.dataManager || null;
      this.journalAdapter = options.journalAdapter || new JournalAdapter();
      this.uid = options.uid || RepartitionUlisManager.uidParDefaut;
    }

    static uidParDefaut(prefixe) {
      return prefixe + "_" + Date.now().toString(36) + "_" +
        Math.random().toString(36).slice(2, 8);
    }

    // ------------------------------------------------------------------
    // Normalisation / lecture de profil — helpers purs, portés tels quels
    // ------------------------------------------------------------------

    static normaliser(v) {
      return String(v || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    static niveauDe(v) {
      const s = RepartitionUlisManager.normaliser(v);
      const m = s.match(/\b(tps|ps|ms|gs|cp|ce1|ce2|cm1|cm2)\b/);
      return m ? m[1].toUpperCase() : "";
    }

    /**
     * Niveau de l'élève : déduit en priorité de sa classe de référence
     * (seule donnée réellement présente dans le coffre pour cela), avec
     * repli sur l'équivalence scolaire (français puis mathématiques).
     */
    static niveauEleve(e) {
      const parClasse = RepartitionUlisManager.niveauDe(e.classe);
      if (parClasse) return parClasse;
      const eq = e.equivalenceScolaire || {};
      return RepartitionUlisManager.niveauDe(
        (eq.francais && eq.francais.niveauEquivalent) ||
        (eq.mathematiques && eq.mathematiques.niveauEquivalent) || ""
      );
    }

    static niveauEquivalentSujet(e, matiere) {
      const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
      const v = eq && eq.niveauEquivalent;
      return v
        ? RepartitionUlisManager.niveauDe(v) || RepartitionUlisManager.niveauEleve(e)
        : RepartitionUlisManager.niveauEleve(e);
    }

    /** Besoins + objectifs actifs de l'élève, normalisés, pour le ciblage. */
    static besoinsEtObjectifs(e) {
      const besoins = (e.besoins || []).map(x =>
        x && typeof x === "object" ? (x.hypothese || x.domaine || x.champ || "") : x
      );
      const objectifs = (e.objectifs || [])
        .filter(x => !x || !x.statut || x.statut === "actif")
        .map(x => x && typeof x === "object" ? (x.libelle || x.domaine || "") : x);
      return besoins.concat(objectifs)
        .map(RepartitionUlisManager.normaliser)
        .filter(Boolean);
    }

    /**
     * Le planning individuel stocké dans le coffre de chaque élève est la
     * seule source de vérité pour savoir s'il occupe déjà un créneau.
     */
    static eleveOccupeSurSegment(e, jourN, debut, fin) {
      const plan = Array.isArray(e.planning) ? e.planning : [];
      return plan.some(p =>
        Number(p.jour) === Number(jourN) &&
        ReferentielHoraire.heureVersMin(p.debut) < fin &&
        ReferentielHoraire.heureVersMin(p.fin) > debut
      );
    }

    // ------------------------------------------------------------------
    // Génération
    // ------------------------------------------------------------------

    /**
     * @param {object} config   - école : { classes, dispositifs, rentree, semaines, vacances, joursTravailles }
     * @param {object} grilles  - { [classeId]: [{jour, debut, fin}, ...] }
     * @param {object} [coffre] - Coffre ouvert (repli si aucun DataManager fourni)
     * @returns {{jours:number, groupes:number, ajouts:number, eleves?:number, referentiel?:string, message?:string}}
     */
    genererGroupesBesoin(config, grilles, coffre) {
      const eleves = this._lireEleves(coffre);
      if (!eleves.length) {
        return { jours: 0, groupes: 0, ajouts: 0, message: "Aucun élève dans le coffre." };
      }

      config = config || {};
      grilles = grilles || {};

      // Classe de référence de chaque élève, résolue une fois pour toutes.
      const classeRefParEleve = new Map(eleves.map(e => [
        e.identifiantSynapses,
        ReferentielHoraire.classeDeReferenceCorrespondante(e.classe, config)
      ]));

      const semaines = CalendrierScolaire.calculerSemaines(config);
      const joursTravail = new Set((config.joursTravailles || [1, 2, 3, 4, 5]).map(Number));
      const journal = this.journalAdapter.charger();

      let nbJours = 0, nbGroupes = 0, nbAjouts = 0;

      semaines.forEach(sem => {
        // Le volume horaire du BO n°44 est hebdomadaire : les minutes déjà
        // couvertes sont remises à zéro à chaque semaine.
        const stats = new Map(eleves.map(e => [e.identifiantSynapses, {}]));

        CalendrierScolaire.JOURS.forEach(j => {
          if (!joursTravail.has(j.n)) return;

          const { segments, creneauxParClasse } =
            ReferentielHoraire.segmenterJourneeParClasses(j.n, config, grilles);
          if (!segments.length) return;

          const iso = CalendrierScolaire.dateISO(CalendrierScolaire.addDays(sem.lundi, j.n - 1));
          const jour = this.journalAdapter.pourDate(iso, journal);
          nbJours++;

          // On repart de zéro pour les groupes ULIS automatiques de ce jour :
          // ils sont entièrement reconstruits, sauf ceux retouchés à la main.
          jour.groupes = jour.groupes.filter(
            g => !(g.profilUlis && g.repartitionAuto && !g.personnalise)
          );

          const propositions = this._proposerPourJournee({
            jour, jourN: j.n, segments, creneauxParClasse,
            eleves, classeRefParEleve, stats
          });

          this._fusionnerSegmentsConsecutifs(propositions).forEach(entree => {
            jour.groupes.push(this._construireGroupe(entree));
            nbGroupes++;
            nbAjouts += entree.eleveIds.length;
          });

          journal[iso] = jour;
        });
      });

      this.journalAdapter.sauver(journal);

      return {
        jours: nbJours,
        groupes: nbGroupes,
        ajouts: nbAjouts,
        eleves: eleves.length,
        referentiel: REFERENTIEL
      };
    }

    /**
     * Lecture des élèves : par le DataManager (domaine protégé) si présent,
     * sinon directement par le Coffre passé en argument — compatibilité avec
     * les pages V1 qui ne connaissent pas encore le DataManager.
     */
    _lireEleves(coffre) {
      if (this.data && typeof this.data.getProtege === "function") {
        const liste = this.data.getProtege("eleves");
        return Array.isArray(liste) ? liste : [];
      }
      if (!coffre || !coffre.ouvert) {
        throw new Error("Ouvrez le coffre avant de générer les groupes ULIS.");
      }
      return coffre.listerEleves ? coffre.listerEleves() : [];
    }

    /**
     * Domaine BO ciblé pour un élève : celui dont il reste le plus à couvrir
     * cette semaine, un domaine explicitement présent dans ses besoins ou
     * objectifs actifs étant fortement favorisé.
     */
    _domaineCibleDe(e, stats) {
      const cycle = ReferentielHoraire.cycleDuNiveau(RepartitionUlisManager.niveauEleve(e)) || "cycle2";
      const cibles = ReferentielHoraire.volumesCycle(cycle);
      const fait = stats.get(e.identifiantSynapses) || {};
      const besoins = RepartitionUlisManager.besoinsEtObjectifs(e);

      let meilleur = null, meilleurEcart = -Infinity;
      ORDRE_DOMAINES.forEach(dom => {
        if (cibles[dom] === undefined) return;
        const restant = cibles[dom] - (fait[dom] || 0);
        if (restant <= 0) return;
        const bonus = besoins.some(b => ReferentielHoraire.domaineBoDe(b) === dom)
          ? BONUS_BESOIN_DECLARE : 0;
        const ecart = restant + bonus;
        if (ecart > meilleurEcart) { meilleurEcart = ecart; meilleur = dom; }
      });
      return meilleur || "francais";
    }

    /**
     * Élève disponible sur un segment : il n'est pas déjà affecté à un
     * créneau enregistré dans son coffre, et sa classe de référence (si elle
     * est connue de la configuration) n'y a pas cours ce jour-là.
     */
    _eleveDisponible(e, segment, contexte) {
      const { jourN, classeRefParEleve, creneauxParClasse } = contexte;
      if (RepartitionUlisManager.eleveOccupeSurSegment(e, jourN, segment.debut, segment.fin)) {
        return false;
      }
      const classeRef = classeRefParEleve.get(e.identifiantSynapses);
      if (!classeRef) return true; // pas de classe de référence -> suivi enseignant

      const plan = Array.isArray(e.planning) ? e.planning : [];
      if (plan.some(p => p.classeId === classeRef.id)) return true; // le planning fait foi

      const cxs = creneauxParClasse[classeRef.id] || [];
      return !cxs.some(c => c.debut < segment.fin && c.fin > segment.debut);
    }

    /** Propositions de groupes segment par segment, avant fusion. */
    _proposerPourJournee(contexte) {
      const { jour, segments, eleves, stats } = contexte;
      const propositions = [];

      segments.forEach(segment => {
        // Un créneau ULIS n'est généré que s'il est réellement libre dans le
        // cahier journal : aucun groupe (fixe ou non) n'y chevauche déjà,
        // hormis les anciens groupes ULIS auto retirés plus haut.
        const occupe = jour.groupes.some(g =>
          ReferentielHoraire.heureVersMin(g.debut) < segment.fin &&
          ReferentielHoraire.heureVersMin(g.fin) > segment.debut
        );
        if (occupe) return;

        const disponibles = eleves.filter(e => this._eleveDisponible(e, segment, contexte));
        if (!disponibles.length) return;

        // Regroupement par domaine cible puis par niveau d'équivalence
        // scolaire dans ce domaine (groupes de besoin).
        const parGroupe = new Map(); // "domaine|niveau" -> {domaine, niveau, eleves}
        disponibles.forEach(e => {
          const dom = this._domaineCibleDe(e, stats);
          const niv = /francais|mathematiques/.test(dom)
            ? RepartitionUlisManager.niveauEquivalentSujet(e, dom === "francais" ? "francais" : "mathematiques")
            : RepartitionUlisManager.niveauEleve(e);
          const cle = dom + "|" + (niv || "");
          if (!parGroupe.has(cle)) parGroupe.set(cle, { domaine: dom, niveau: niv, eleves: [] });
          parGroupe.get(cle).eleves.push(e);
        });

        let entrees = Array.from(parGroupe.values());
        if (entrees.length > MAX_GROUPES_SIMULTANES) {
          // On fusionne les groupes les moins fournis pour tenir dans la limite.
          entrees.sort((a, b) => b.eleves.length - a.eleves.length);
          const gardes = entrees.slice(0, MAX_GROUPES_SIMULTANES - 1);
          const reste = entrees.slice(MAX_GROUPES_SIMULTANES - 1);
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

      return propositions;
    }

    /**
     * Fusionne les segments consécutifs portant exactement le même groupe
     * (domaine + niveau + composition), pour ne pas fragmenter une même
     * séance ULIS en une multitude de créneaux de quelques minutes.
     */
    _fusionnerSegmentsConsecutifs(propositions) {
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
      return fusionnees;
    }

    /** Groupe du cahier journal — structure identique à la V1. */
    _construireGroupe(entree) {
      const titre = "ULIS — " + ReferentielHoraire.libelleDomaine(entree.domaine) +
        (entree.niveau ? " (" + entree.niveau + ")" : "");
      return {
        id: this.uid("grp"),
        debut: ReferentielHoraire.minVersHeure(entree.debut),
        fin: ReferentielHoraire.minVersHeure(entree.fin),
        origine: null,
        modifie: true,
        adulte: { type: "enseignant", nom: "" },
        titre: titre,
        domaineCle: entree.domaine,
        niveau: entree.niveau || "",
        classeId: "",
        seanceRef: null,
        eleves: entree.eleveIds,
        remarque: REMARQUE_AUTO,
        fixe: false,
        repartitionAuto: true,
        personnalise: false,
        profilUlis: true
      };
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.RepartitionUlisManager = RepartitionUlisManager;
})(typeof window !== "undefined" ? window : globalThis);
