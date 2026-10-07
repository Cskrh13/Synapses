/**
 * Synapses 2.0 — core/affectation-manager.js
 * ============================================================================
 * Consolide en UN SEUL endroit la règle de résolution d'un créneau pour un
 * élève, spécifiée par Vincent (17/09/2026) :
 *
 *   1. Prise en charge extérieure (PEC) active sur ce créneau  -> "pec"
 *   2. Sinon, présent dans sa classe de référence à ce moment,
 *      et pas décoché sur ce créneau précis                   -> "classe"
 *   3. Sinon (pas de classe de référence connue, pas cours en
 *      classe à ce moment, ou décoché par l'enseignant)        -> "dispositif"
 *
 * Avant ce manager, cette même déduction était refaite en plusieurs endroits
 * légèrement différents (repartition-ulis-manager, repartition-hebdo-manager,
 * cahier-journal-manager._idsPlanningDispositif) — aucun n'appliquait
 * EXACTEMENT la règle ci-dessus (aucun ne consulte la PEC, par exemple).
 * Voir la note de livraison : les managers existants n'ont PAS été
 * rebranchés sur celui-ci pour l'instant (ça changerait un comportement déjà
 * testé conforme à la V1) — c'est une décision à prendre explicitement,
 * séparée du fait de disposer enfin de la règle correcte, écrite une fois.
 *
 * RGPD — n'accepte QUE des objets élève déjà en mémoire (issus de
 * DataManager.getProtege("eleves") ou coffre.listerEleves()) : ce manager ne
 * touche jamais lui-même le Coffre. Ne renvoie et n'écrit que des libellés
 * de statut ("pec"/"classe"/"dispositif") et, en lecture, le détail de la
 * PEC trouvée (déjà non-nominatif : jour/horaire/lieu, jamais de nom).
 *
 * Le registre d'exclusions (créneau × élève, opt-out : présent par défaut)
 * reste celui de la V1 — mêmes clés `classeId__creneauId`, voir
 * estEleveExcluCreneau/definirPresenceEleveCreneau dans planning-core.js.
 *
 * Dépendances : core/referentiel-horaire.js (heureVersMin,
 * classeDeReferenceCorrespondante).
 */
(function (global) {
  "use strict";

  const { ReferentielHoraire } = global.SynapsesCore;
  const hm = h => ReferentielHoraire.heureVersMin(h);

  function cleAffectationEleve(classeId, creneauId) {
    return classeId + "__" + creneauId;
  }

  class AffectationManager {
    /**
     * @param {object} options
     * @param {object} options.config     - école (classes, dispositifs, ...)
     * @param {object} options.grilles    - { [classeId]: [créneaux] }
     * @param {object} [options.exclusions] - registre opt-out { "classeId__creneauId": [ids] }
     */
    constructor(options) {
      options = options || {};
      this.config = options.config || {};
      this.grilles = options.grilles || {};
      this.exclusions = options.exclusions || {};
    }

    // ------------------------------------------------------------------
    // Registre d'exclusions — mêmes clés et sémantique que la V1
    // (estEleveExcluCreneau / definirPresenceEleveCreneau).
    // ------------------------------------------------------------------

    estExclu(classeId, creneauId, identifiantSynapses) {
      const cle = cleAffectationEleve(classeId, creneauId);
      return (this.exclusions[cle] || []).includes(identifiantSynapses);
    }

    /** present === false retire l'élève de ce créneau de classe (opt-out). */
    definirPresence(classeId, creneauId, identifiantSynapses, present) {
      const cle = cleAffectationEleve(classeId, creneauId);
      this.exclusions[cle] = this.exclusions[cle] || [];
      const idx = this.exclusions[cle].indexOf(identifiantSynapses);
      if (present) {
        if (idx !== -1) this.exclusions[cle].splice(idx, 1);
        if (!this.exclusions[cle].length) delete this.exclusions[cle];
      } else if (idx === -1) {
        this.exclusions[cle].push(identifiantSynapses);
      }
      return this.exclusions;
    }

    // ------------------------------------------------------------------
    // PEC — même logique de chevauchement que
    // Coffre.priseEnChargeExterieureSurCreneau, appliquée ici à l'objet
    // élève déjà en mémoire (pas de nouvel accès au Coffre).
    // ------------------------------------------------------------------

    /** @returns {object|null} la PEC active qui chevauche ce créneau, ou null. */
    pecSurCreneau(eleve, jour, debut, fin) {
      const dMin = hm(debut), fMin = hm(fin);
      return (eleve.priseEnChargeExterieure || []).find(p => {
        if (p.actif === false) return false;
        if (Number(p.jour) !== Number(jour)) return false;
        const pd = hm(p.debut), pf = hm(p.fin);
        return pd < fMin && dMin < pf;
      }) || null;
    }

    // ------------------------------------------------------------------
    // Classe de référence — chevauchement avec la grille de la classe de
    // l'élève, un jour de semaine donné.
    // ------------------------------------------------------------------

    /** Classe de référence de l'élève (config.classes), ou null si inconnue. */
    classeDeReference(eleve) {
      return ReferentielHoraire.classeDeReferenceCorrespondante(eleve.classe, this.config);
    }

    /**
     * Le créneau de la grille de la classe de référence qui chevauche
     * [debut, fin] ce jour, ou null si la classe n'a rien à ce moment
     * (récréation entre deux créneaux, fin de journée, etc.).
     */
    creneauClasseDeReference(eleve, jour, debut, fin) {
      const classe = this.classeDeReference(eleve);
      if (!classe) return null;
      const dMin = hm(debut), fMin = hm(fin);
      const creneau = (this.grilles[classe.id] || []).find(c =>
        Number(c.jour) === Number(jour) && hm(c.debut) < fMin && dMin < hm(c.fin)
      );
      return creneau ? { classe, creneau } : null;
    }

    // ------------------------------------------------------------------
    // La règle elle-même
    // ------------------------------------------------------------------

    /**
     * @param {object} eleve - objet élève (protégé), avec au moins
     *   identifiantSynapses, classe, priseEnChargeExterieure[].
     * @param {number} jour  - 1 (lundi) à 5 (vendredi)
     * @param {string} debut - "HH:MM"
     * @param {string} fin   - "HH:MM"
     * @returns {{statut:"pec"|"classe"|"dispositif", detail:object|null}}
     *   detail porte la PEC trouvée (statut "pec") ou le {classe, creneau}
     *   de la classe de référence (statut "classe") ; null pour "dispositif".
     */
    resoudreCreneau(eleve, jour, debut, fin) {
      const pec = this.pecSurCreneau(eleve, jour, debut, fin);
      if (pec) return { statut: "pec", detail: pec };

      const enClasse = this.creneauClasseDeReference(eleve, jour, debut, fin);
      if (enClasse) {
        const exclu = this.estExclu(
          enClasse.classe.id, enClasse.creneau.id, eleve.identifiantSynapses
        );
        if (!exclu) return { statut: "classe", detail: enClasse };
      }

      // Pas de PEC, pas (ou plus) de classe à ce moment, ou décoché par
      // l'enseignant : l'élève relève du dispositif sur ce créneau.
      return { statut: "dispositif", detail: null };
    }

    /** Raccourci : l'élève relève-t-il du dispositif sur ce créneau ? */
    estEnDispositif(eleve, jour, debut, fin) {
      return this.resoudreCreneau(eleve, jour, debut, fin).statut === "dispositif";
    }

    /** Filtre une liste d'élèves : ceux à prendre en charge par le dispositif. */
    eligiblesPourDispositif(eleves, jour, debut, fin) {
      return eleves.filter(e => this.estEnDispositif(e, jour, debut, fin));
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.AffectationManager = AffectationManager;
})(typeof window !== "undefined" ? window : globalThis);
