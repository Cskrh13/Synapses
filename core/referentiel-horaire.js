/**
 * Synapses 2.0 — core/referentiel-horaire.js
 * ============================================================================
 * Portage fidèle (aucun changement de valeur ni de logique) des constantes
 * et fonctions pures de planning-core.js utilisées par le moteur de
 * répartition ULIS : volumes hebdomadaires du BO n°44 du 26/11/2015,
 * association domaine → cycle, conversion horaire, segmentation de journée.
 *
 * Regroupées ici en classe car réutilisées par plusieurs futurs modules
 * (ProgrammationManager, futur RepartitionUlisManager, validateur).
 *
 * Ce fichier ne modifie AUCUNE valeur métier : les volumes BO_VOLUMES_HEBDO
 * sont recopiés à l'identique de planning-core.js.
 */
(function (global) {
  "use strict";

  // Valeurs en minutes / semaine — identiques à planning-core.js.
  const BO_VOLUMES_HEBDO = {
    cycle2: { // CP, CE1, CE2
      francais: 600,
      mathematiques: 300,
      eps: 180,
      languesVivantes: 90,
      artsEducationMusicale: 120,
      emc: 30,
      questionnerLeMonde: 120
    },
    cycle3: { // CM1, CM2
      francais: 480,
      mathematiques: 300,
      eps: 180,
      languesVivantes: 90,
      artsEducationMusicale: 120,
      emc: 30,
      histoireGeographie: 120,
      sciencesTechnologie: 120
    }
  };

  const LIBELLE_DOMAINE_BO = {
    francais: "Français", mathematiques: "Mathématiques", eps: "EPS",
    languesVivantes: "Langues vivantes", questionnerLeMonde: "Questionner le monde",
    histoireGeographie: "Histoire-géographie", sciencesTechnologie: "Sciences et technologie",
    artsEducationMusicale: "Arts / éducation musicale", emc: "EMC", mixte: "Besoins ciblés"
  };

  class ReferentielHoraire {
    static pad2(n) {
      return String(n).padStart(2, "0");
    }

    static heureVersMin(h) {
      const morceaux = String(h || "0:0").split(":").map(Number);
      const hh = morceaux[0] || 0;
      const mm = morceaux[1] || 0;
      return hh * 60 + mm;
    }

    static minVersHeure(m) {
      return `${ReferentielHoraire.pad2(Math.floor(m / 60))}:${ReferentielHoraire.pad2(m % 60)}`;
    }

    /** Deux plages [aDebut,aFin) et [bDebut,bFin) (en minutes) se chevauchent-elles ? */
    static chevaucheMin(aDebut, aFin, bDebut, bFin) {
      return aDebut < bFin && bDebut < aFin;
    }

    static cycleDuNiveau(niveau) {
      const n = String(niveau || "").toUpperCase();
      if (["CP", "CE1", "CE2"].includes(n)) return "cycle2";
      if (["CM1", "CM2"].includes(n)) return "cycle3";
      return null; // TPS/PS/MS/GS (cycle 1) : hors grille horaire BO n°44
    }

    static domaineBoDe(texte) {
      const t = String(texte || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (/franc|lecture|ecriture|oral|vocabulaire|grammaire/.test(t)) return "francais";
      if (/math|nombre|calcul|grandeur|geometr/.test(t)) return "mathematiques";
      if (/\beps\b|sport|motric|education physique/.test(t)) return "eps";
      if (/langue|anglais|lve/.test(t)) return "languesVivantes";
      if (/art|musi|chant|dessin/.test(t)) return "artsEducationMusicale";
      if (/\bemc\b|moral|civi/.test(t)) return "emc";
      if (/histoire|geographie/.test(t)) return "histoireGeographie";
      if (/science|technolog/.test(t)) return "sciencesTechnologie";
      if (/questionner le monde|decouverte du monde|\bqlm\b/.test(t)) return "questionnerLeMonde";
      return null;
    }

    static volumesCycle(cycle) {
      return BO_VOLUMES_HEBDO[cycle] || null;
    }

    static libelleDomaine(cleDomaine) {
      return LIBELLE_DOMAINE_BO[cleDomaine] || cleDomaine;
    }

    /**
     * Segmente la journée en intervalles homogènes à partir des bornes de
     * créneaux de toutes les classes (mêmes règles que planning-core.js :
     * micro-interstices < 15 min ignorés).
     * @param {string} jourSemaine
     * @param {{classes: object[]}} config - ecole().classes (instances Classe)
     * @param {object} grilles - { [classeId]: [{jour, debut, fin}, ...] }
     */
    static segmenterJourneeParClasses(jourSemaine, config, grilles) {
      const classes = (config.classes && config.classes.length) ? config.classes : [];
      const points = new Set();
      const creneauxParClasse = {};
      let debutJournee = null, finJournee = null;

      classes.forEach(classe => {
        const cxs = (grilles[classe.id] || [])
          .filter(c => c.jour === jourSemaine)
          .map(c => ({ debut: ReferentielHoraire.heureVersMin(c.debut), fin: ReferentielHoraire.heureVersMin(c.fin) }));
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
        if (fin - debut < 15) continue;
        segments.push({ debut, fin });
      }
      return { segments, creneauxParClasse };
    }

    /** Retrouve la Classe correspondant à un libellé (id ou nom), accent/casse ignorés. */
    static classeDeReferenceCorrespondante(nomClasse, config) {
      if (!nomClasse) return null;
      const norm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const n = norm(nomClasse);
      return (config.classes || []).find(c => norm(c.id) === n || norm(c.nom) === n) || null;
    }

    /** Plages horaires sans aucun créneau de classe ce jour-là. */
    static plagesLibresEnseignant(jourSemaine, config, grilles) {
      const { segments, creneauxParClasse } = ReferentielHoraire.segmenterJourneeParClasses(jourSemaine, config, grilles);
      const toutesOccupations = Object.values(creneauxParClasse).flat();
      return segments
        .filter(s => !toutesOccupations.some(o => o.debut < s.fin && o.fin > s.debut))
        .map(s => ({ debut: ReferentielHoraire.minVersHeure(s.debut), fin: ReferentielHoraire.minVersHeure(s.fin) }));
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.ReferentielHoraire = ReferentielHoraire;
})(typeof window !== "undefined" ? window : globalThis);
