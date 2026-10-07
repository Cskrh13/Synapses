/**
 * Synapses 2.0 — core/repartition-hebdo-manager.js
 * ============================================================================
 * Portage fidèle de repartirElevesSemaineAuto (planning-core.js, l. 2496) :
 * répartition hebdomadaire automatique des élèves dans les groupes du cahier
 * journal, semaine par semaine.
 *
 * Référentiel horaire (BO n°44 du 26/11/2015) :
 *   - CP/CE1/CE2 : Français 10 h, Mathématiques 5 h / semaine ;
 *   - CM1/CM2    : Français  8 h, Mathématiques 5 h / semaine.
 *
 * Le moteur ne remplace pas les choix manuels :
 *   - un élève déjà affecté manuellement dans sa classe sur un créneau n'est
 *     pas ajouté à un groupe de soutien sur ce créneau ;
 *   - les récréations sont prioritaires ;
 *   - maximum 3 groupes automatiques par créneau ;
 *   - groupes constitués par niveau, puis affinés par besoins / objectifs ;
 *   - le matin, priorité Français / Mathématiques ;
 *   - en début d'après-midi, une plage de 30 min va prioritairement à
 *     lecture / écriture ;
 *   - un groupe automatique personnalisé à la main est entièrement préservé.
 *
 * RGPD — la liste des élèves vient du Coffre (DataManager.getProtege) et n'en
 * sort jamais : seuls des identifiants Synapses (ELEVE-xxxx) sont écrits dans
 * le cahier journal. Ce manager n'écrit jamais dans le Coffre.
 *
 * Dépendances : core/referentiel-horaire.js, core/calendrier-scolaire.js,
 *               core/adapters/local-adapter.js, core/adapters/journal-adapter.js,
 *               core/cahier-journal-manager.js
 */
(function (global) {
  "use strict";

  const { ReferentielHoraire, CalendrierScolaire, JournalAdapter, CahierJournalManager } =
    global.SynapsesCore;

  const hm = h => ReferentielHoraire.heureVersMin(h);

  // Volumes hebdomadaires cibles, en minutes — valeurs de la V1, à l'identique.
  const CIBLES = {
    CP: { francais: 600, maths: 300 },
    CE1: { francais: 600, maths: 300 },
    CE2: { francais: 600, maths: 300 },
    CM1: { francais: 480, maths: 300 },
    CM2: { francais: 480, maths: 300 }
  };

  const MAX_GROUPES = 3;
  const FIN_JOURNEE_MIN = 16 * 60 + 30; // aucun groupe auto au-delà de 16h30

  const REMARQUE_AESH =
    "Groupe créé automatiquement : élèves accompagnés par une AESH sur ce créneau (donnée du coffre).";
  const REMARQUE_AUTONOMIE =
    "Groupe créé automatiquement : élèves déclarés en autonomie sur ce créneau (donnée du coffre).";
  const REMARQUE_NIVEAU =
    "Groupe créé automatiquement selon niveau, besoins et objectifs.";

  // --------------------------------------------------------------------------
  // Helpers purs — portés tels quels
  // --------------------------------------------------------------------------

  const norm = v => String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  // Attention : contrairement au moteur ULIS, ce niveauDe retombe sur la
  // valeur brute en majuscules quand aucun niveau standard n'est reconnu.
  const niveauDe = v => {
    const s = norm(v);
    const m = s.match(/\b(cp|ce1|ce2|cm1|cm2)\b/);
    return m ? m[1].toUpperCase() : String(v || "").trim().toUpperCase();
  };

  const niveauEleve = e => niveauDe(
    e.niveau || e.classeNiveau || e.niveauScolaire || e.classe || ""
  );

  /**
   * Niveau d'équivalence scolaire DISCIPLINAIRE saisi par l'enseignant dans
   * le coffre : c'est la vraie donnée individuelle, prioritaire sur le niveau
   * de classe brut quand elle existe.
   */
  const niveauEquivalentSujet = (e, matiere) => {
    const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
    const v = eq && eq.niveauEquivalent;
    return v ? niveauDe(v) : niveauEleve(e);
  };

  const libelleAccompagnement = a =>
    typeof a === "object" ? (a.type || a.libelle || a.nom || "") : a;

  /** Accompagnement humain déclaré (AESH) — jamais supposé, toujours lu. */
  const aAesh = e => (e.accompagnements || [])
    .some(a => norm(libelleAccompagnement(a)).indexOf("aesh") !== -1);

  /** Autonomie déclarée — seulement si explicitement renseignée dans le coffre. */
  const autonomieDeclaree = e => (e.accompagnements || []).some(a => {
    const n = norm(libelleAccompagnement(a));
    return n.indexOf("autonomie") !== -1 || n.indexOf("autonome") !== -1;
  });

  const classeEleve = e => norm(
    e.classeId || e.classe || e.classeNom || e.groupeClasse || ""
  );

  const besoinsEleve = e => {
    const a = (e.besoins || []).map(x => typeof x === "object"
      ? (x.domaine || x.champ || x.libelle || x.hypothese || "") : x);
    const b = (e.objectifs || [])
      .filter(x => !x || !x.statut || x.statut === "actif")
      .map(x => typeof x === "object"
        ? (x.domaine || x.champ || x.libelle || x.contexte || "") : x);
    return a.concat(b).map(norm).filter(Boolean).join(" ");
  };

  const estFixe = g => !!g.fixe;

  const estRecreation = g => {
    const t = norm(g.titre || g.libelle || "");
    return estFixe(g) && (t.includes("recre") || t.includes("pause meridienne"));
  };

  const domaine = g => norm(
    (g.domaineCle || "") + " " + (g.titre || "") + " " +
    ((g.seanceRef && g.seanceRef.titre) || "")
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

  const minutes = (a, b) => Math.max(0, hm(b) - hm(a));

  // --------------------------------------------------------------------------

  class RepartitionHebdoManager {
    /**
     * @param {object} options
     * @param {object} [options.dataManager] - DataManager (lecture protégée des élèves)
     * @param {object} [options.journalAdapter]
     * @param {object} [options.cahierJournalManager]
     * @param {function} [options.uid]
     */
    constructor(options) {
      options = options || {};
      this.data = options.dataManager || null;
      this.journalAdapter = options.journalAdapter || new JournalAdapter();
      this.uid = options.uid || RepartitionHebdoManager.uidParDefaut;
      this.cahier = options.cahierJournalManager ||
        new CahierJournalManager({ journalAdapter: this.journalAdapter, uid: this.uid });
    }

    static uidParDefaut(prefixe) {
      return prefixe + "_" + Date.now().toString(36) + "_" +
        Math.random().toString(36).slice(2, 8);
    }

    /**
     * Lecture des élèves : par le DataManager (domaine protégé) si présent,
     * sinon par le Coffre passé en argument — compatibilité avec les pages V1.
     */
    _lireEleves(coffre) {
      if (this.data && typeof this.data.getProtege === "function") {
        const liste = this.data.getProtege("eleves");
        return Array.isArray(liste) ? liste : [];
      }
      if (!coffre || !coffre.ouvert) {
        throw new Error("Ouvrez le coffre avant de répartir les élèves.");
      }
      return coffre.listerEleves ? coffre.listerEleves() : [];
    }

    /**
     * @param {object} config      - école (rentree, semaines, vacances, joursTravailles, classes, dispositifs)
     * @param {object} grilles     - { [classeId|dispositifId]: [créneaux] }
     * @param {object} affectations
     * @param {object} [coffre]    - Coffre ouvert (repli sans DataManager)
     * @returns {{jours:number, ajouts:number, groupes:number, groupesEnseignant:number, groupesAesh:number, groupesAutonomie:number, objectifs:object}}
     */
    repartirSemaine(config, grilles, affectations, coffre) {
      const eleves = this._lireEleves(coffre);
      if (!eleves.length) throw new Error("Aucun élève disponible dans le coffre.");

      config = config || {};
      const semaines = CalendrierScolaire.calculerSemaines(config);
      const joursTravail = new Set((config.joursTravailles || [1, 2, 3, 4, 5]).map(Number));
      const journal = this.journalAdapter.charger();

      const ids = new Map(eleves.map(e => [e.identifiantSynapses, e]).filter(x => x[0]));
      const stats = {};
      eleves.forEach(e => {
        stats[e.identifiantSynapses] = { francais: 0, maths: 0, lectureEcriture: 0, autres: 0 };
      });

      const bilan = {
        ajouts: 0, groupes: 0,
        groupesEnseignant: 0, groupesAesh: 0, groupesAutonomie: 0
      };

      semaines.forEach(sem => {
        CalendrierScolaire.JOURS.forEach(j => {
          if (!joursTravail.has(j.n)) return;
          const iso = CalendrierScolaire.dateISO(CalendrierScolaire.addDays(sem.lundi, j.n - 1));

          // Le cahier journal du jour est reconstruit depuis les grilles
          // (sans coffre : la V1 ne le transmet pas ici non plus).
          const jour = this.cahier.genererDepuisGrille(iso, config, grilles, affectations || {}, {});

          // Les groupes créés automatiquement sont SUPPRIMÉS et reconstruits
          // entièrement, structure comprise — sauf ceux que l'enseignant a
          // explicitement personnalisés. Ce filtrage a lieu AVANT le calcul
          // des blocs, pour que les références utilisées plus bas soient à jour.
          jour.groupes = jour.groupes.filter(g => !(g.repartitionAuto && !g.personnalise));

          const blocs = CahierJournalManager.regrouperParBloc(jour)
            .filter(bloc => hm(bloc.fin) <= FIN_JOURNEE_MIN);

          blocs.forEach(bloc => {
            this._traiterBloc({ jour, bloc, eleves, ids, stats, bilan });
          });

          journal[iso] = jour;
        });
      });

      this.journalAdapter.sauver(journal);

      return {
        jours: Object.keys(journal).length,
        ajouts: bilan.ajouts,
        groupes: bilan.groupes,
        groupesEnseignant: bilan.groupesEnseignant,
        groupesAesh: bilan.groupesAesh,
        groupesAutonomie: bilan.groupesAutonomie,
        objectifs: {
          cycle2: { francais: "10 h/semaine", maths: "5 h/semaine" },
          cycle3: { francais: "8 h/semaine", maths: "5 h/semaine" }
        }
      };
    }

    // ----------------------------------------------------------------------
    // Disponibilité
    // ----------------------------------------------------------------------

    /**
     * Le planning individuel du coffre est la source de vérité pour les
     * affectations récurrentes d'un élève dans sa classe.
     */
    _estDansSaClasse(jourRef, e, bloc) {
      const id = e.identifiantSynapses;
      const plan = Array.isArray(e.planning) ? e.planning : [];

      // ⚠ Comportement V1 reproduit tel quel : `jourRef` est l'OBJET journée
      // du cahier journal, pas la date ISO. `new Date(objet)` donne une date
      // invalide, donc jourN vaut NaN et la comparaison ci-dessous est
      // toujours fausse — la branche « planning individuel » de cette
      // fonction est inerte depuis la V1. Voir la note de livraison : à
      // corriger volontairement, pas en catimini dans un portage.
      const jourN = (() => {
        const d = new Date(jourRef);
        return d.getDay() === 0 ? 7 : d.getDay();
      })();

      if (id && plan.length && bloc.groupes.some(g => {
        if (!g.origine) return false;
        const parts = String(g.origine).split("__");
        const classeId = parts[0], creneauId = parts.slice(1).join("__");
        return plan.some(p => p.classeId === classeId && p.creneauId === creneauId &&
          Number(p.jour) === Number(jourN));
      })) return true;

      return bloc.groupes.some(g => {
        if (estFixe(g) || !g.modifie || !(g.eleves || []).includes(id)) return false;
        const gc = norm(g.classeId || g.classe || "");
        const ec = classeEleve(e);
        return gc && ec && (gc === ec || gc.includes(ec) || ec.includes(gc));
      });
    }

    /** Élèves placables sur ce bloc : ni en récréation de classe, ni dans leur classe. */
    _disponiblesSurBloc(jourRef, bloc, eleves) {
      const recreations = bloc.groupes.filter(estRecreation);
      return eleves.filter(e => {
        if (!e.identifiantSynapses) return false;
        const enRecreation = recreations.some(r => {
          const rc = norm(r.classeId || r.classe || "");
          const ec = classeEleve(e);
          const rn = niveauDe(r.niveau || r.classeId || "");
          return (rc && ec && (rc === ec || rc.includes(ec) || ec.includes(rc))) ||
            (!ec && rn && rn === niveauEleve(e));
        });
        if (enRecreation) return false;
        return !this._estDansSaClasse(jourRef, e, bloc);
      });
    }

    // ----------------------------------------------------------------------
    // Création des groupes automatiques
    // ----------------------------------------------------------------------

    _creerGroupe(bloc, champs) {
      return Object.assign({
        id: this.uid("grp"),
        debut: bloc.debut,
        fin: bloc.fin,
        origine: null,
        modifie: true,
        adulte: { type: "enseignant", nom: "" },
        titre: "",
        domaineCle: "",
        niveau: "",
        classeId: "",
        seanceRef: null,
        eleves: [],
        remarque: "",
        fixe: false,
        repartitionAuto: true,
        personnalise: false
      }, champs);
    }

    /** Groupe AESH ou autonomie, dans la limite de 3 groupes automatiques. */
    _assurerGroupeSpecial(ctx, profil, titre, adulte) {
      const { jour, bloc, auto, bilan } = ctx;
      const existant = auto.find(g => g.profilAuto === profil);
      if (auto.length >= MAX_GROUPES) return existant || null;
      if (existant) return existant;

      const g = this._creerGroupe(bloc, {
        adulte: adulte,
        titre: titre,
        remarque: profil === "AESH" ? REMARQUE_AESH : REMARQUE_AUTONOMIE,
        profilAuto: profil
      });
      jour.groupes.push(g);
      auto.push(g);
      bilan.groupes++;
      if (profil === "AESH") bilan.groupesAesh++; else bilan.groupesAutonomie++;
      return g;
    }

    /** Groupes de niveau restants (enseignant) pour les élèves standard. */
    _creerGroupesNiveau(ctx, elevesStandard) {
      const { jour, bloc, auto, bilan } = ctx;

      const placesRestantes = Math.max(0, MAX_GROUPES - auto.length);
      const niveaux = [...new Set(elevesStandard.map(niveauEleve).filter(Boolean))];
      niveaux.sort((a, b) =>
        elevesStandard.filter(e => niveauEleve(e) === b).length -
        elevesStandard.filter(e => niveauEleve(e) === a).length
      );

      const profils = niveaux.slice(0, placesRestantes);
      if (niveaux.length > placesRestantes && placesRestantes > 0) {
        profils[placesRestantes - 1] = "BESOINS_CIBLES";
      }

      profils.forEach(profil => {
        if (auto.length >= MAX_GROUPES) return;
        if (auto.find(g => String(g.profilAuto || "") === profil)) return;

        const g = this._creerGroupe(bloc, {
          titre: profil === "BESOINS_CIBLES" ? "Groupe besoins ciblés" : "Groupe " + profil,
          niveau: profil === "BESOINS_CIBLES" ? "" : profil,
          remarque: REMARQUE_NIVEAU,
          profilAuto: profil
        });
        jour.groupes.push(g);
        auto.push(g);
        bilan.groupes++;
        bilan.groupesEnseignant++;
      });
    }

    // ----------------------------------------------------------------------
    // Choix du groupe pour un élève
    // ----------------------------------------------------------------------

    _profilPour(e, g) {
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

    _choisirGroupe(bloc, e, groupes, stats) {
      const id = e.identifiantSynapses;
      const n = niveauEleve(e);
      const h = hm(bloc.debut);
      const duree = minutes(bloc.debut, bloc.fin);
      const estMatin = h < 12 * 60;
      const estDebutAPM = h >= 12 * 60 && h < 14 * 60 && duree === 30;

      const eligibles = groupes.filter(g => !estFixe(g) && !(g.eleves || []).includes(id));
      if (!eligibles.length) return null;

      // Ne pas multiplier les groupes : on réutilise en priorité un groupe
      // automatique du même niveau et du même domaine.
      const cible = CIBLES[n];
      const objectif = estMatin
        ? (stats[id].francais < ((cible && cible.francais) || 0) ? "francais" : "maths")
        : (estDebutAPM ? "lectureEcriture" : null);

      const besoin = besoinsEleve(e);
      const scoreG = g => {
        let s = this._profilPour(e, g);
        if (objectif === "francais" && estFrancais(g)) s += 60;
        if (objectif === "maths" && estMaths(g)) s += 60;
        if (objectif === "lectureEcriture" && estLectureEcriture(g)) s += 70;
        if (!objectif && besoin && domaine(g).split(/\s+/).some(m => besoin.includes(m))) s += 20;
        if (niveauDe(g.niveau || "") === n) s += 30;
        s -= ((g.eleves || []).length * 0.1);
        return s;
      };

      eligibles.sort((a, b) => scoreG(b) - scoreG(a));
      return eligibles[0] || null;
    }

    _placerEleve(bloc, e, g, stats, bilan) {
      const id = e.identifiantSynapses;
      g.eleves = g.eleves || [];
      if (g.eleves.includes(id)) return;
      g.eleves.push(id);
      bilan.ajouts++;
      const duree = minutes(bloc.debut, bloc.fin);
      if (estFrancais(g)) stats[id].francais += duree;
      else if (estMaths(g)) stats[id].maths += duree;
      else if (estLectureEcriture(g)) stats[id].lectureEcriture += duree;
      else stats[id].autres += duree;
    }

    // ----------------------------------------------------------------------

    _traiterBloc(params) {
      const { jour, bloc, eleves, ids, stats, bilan } = params;

      // On transmet l'objet journée, comme la V1 (voir _estDansSaClasse).
      const disponibles = this._disponiblesSurBloc(jour, bloc, eleves);
      if (!disponibles.length) return;

      const travail = bloc.groupes.filter(g => !estFixe(g));
      const auto = travail.filter(g => g.repartitionAuto);
      const ctx = { jour, bloc, auto, bilan };

      const elevesAesh = disponibles.filter(aAesh);
      const elevesAutonomes = disponibles.filter(e => !aAesh(e) && autonomieDeclaree(e));
      const elevesStandard = disponibles.filter(e => !aAesh(e) && !autonomieDeclaree(e));

      let groupeAesh = null, groupeAutonomie = null;
      if (elevesAesh.length) {
        groupeAesh = this._assurerGroupeSpecial(ctx, "AESH", "Groupe AESH", { type: "aesh", nom: "" });
      }
      if (elevesAutonomes.length) {
        groupeAutonomie = this._assurerGroupeSpecial(ctx, "AUTONOMIE", "Groupe autonomie", null);
      }

      this._creerGroupesNiveau(ctx, elevesStandard);

      const groupesDisponibles = jour.groupes
        .filter(g => !estFixe(g) && !estRecreation(g))
        .filter(g => g.repartitionAuto || !g.classeId)
        .filter(g => g.profilAuto !== "AESH" && g.profilAuto !== "AUTONOMIE");

      // Placement prioritaire : AESH puis autonomie, avec repli sur le circuit
      // standard si le groupe spécial n'a pas pu être créé (limite atteinte).
      elevesAesh.forEach(e => {
        if (!ids.has(e.identifiantSynapses)) return;
        if (groupeAesh) this._placerEleve(bloc, e, groupeAesh, stats, bilan);
        else elevesStandard.push(e);
      });
      elevesAutonomes.forEach(e => {
        if (!ids.has(e.identifiantSynapses)) return;
        if (groupeAutonomie) this._placerEleve(bloc, e, groupeAutonomie, stats, bilan);
        else elevesStandard.push(e);
      });

      elevesStandard.forEach(e => {
        if (!ids.has(e.identifiantSynapses)) return;
        const g = this._choisirGroupe(bloc, e, groupesDisponibles, stats);
        if (!g) return;

        // Un groupe auto de niveau différent n'est accepté que si aucun groupe
        // du bon niveau n'est disponible.
        const n = niveauEleve(e);
        const bonNiveau = groupesDisponibles.find(x => x !== g && niveauDe(x.niveau || "") === n);
        if (bonNiveau) {
          const g2 = this._choisirGroupe(bloc, e, [bonNiveau], stats);
          if (g2 && (g2.eleves || []).length <= (g.eleves || []).length + 2) {
            this._placerEleve(bloc, e, g2, stats, bilan);
            return;
          }
        }

        this._placerEleve(bloc, e, g, stats, bilan);
      });
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.RepartitionHebdoManager = RepartitionHebdoManager;
})(typeof window !== "undefined" ? window : globalThis);
