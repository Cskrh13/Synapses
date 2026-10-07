/**
 * Synapses 2.0 — core/repartition-jour-manager.js
 * ============================================================================
 * Portage fidèle de repartirElevesAuto (planning-core.js, l. 2128) :
 * répartition automatique des élèves sur UNE SEULE journée déjà présente
 * dans le cahier journal (bouton « Répartir » de planning-jour.html).
 *
 * Différence de fond avec RepartitionHebdoManager (repartirElevesSemaineAuto) :
 *   - ne reconstruit RIEN depuis les grilles horaires : travaille sur les
 *     groupes déjà présents dans journalJour, tels que l'enseignant les a
 *     laissés (y compris ses propres groupes personnalisés) ;
 *   - scinde un groupe de travail UNIQUE en 2-3 groupes de besoin quand il
 *     reste plus d'un élève à placer sur ce créneau, pour éviter que
 *     « Répartir » ne se contente de reproduire le cahier journal existant ;
 *   - ne crée jamais de groupe AESH/autonomie séparé (contrairement au
 *     moteur hebdomadaire) : une répartition « rapide », pensée pour un
 *     ajustement ponctuel d'une journée, pas pour la programmation de fond.
 *
 * RGPD — la liste des élèves vient du Coffre (DataManager.getProtege si
 * fourni, sinon coffre.listerEleves() par compatibilité) ; seuls des
 * identifiants Synapses sont écrits dans les groupes du journal.
 *
 * Dépendances : core/referentiel-horaire.js (heureVersMin, via
 * cahier-journal-manager), core/adapters/journal-adapter.js,
 * core/cahier-journal-manager.js (regrouperParBloc).
 */
(function (global) {
  "use strict";

  const { JournalAdapter, CahierJournalManager } = global.SynapsesCore;

  const norm = v => String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  // ⚠ Fidèle à la V1 : contrairement au moteur ULIS (niveauDe y retombe sur
  // "" si aucun niveau standard n'est reconnu), ici la capture NON trouvée
  // retombe sur la chaîne normalisée entière (pas de .toUpperCase() non
  // plus). Comportement différent des deux autres moteurs, conservé tel
  // quel : signalé, pas corrigé silencieusement.
  const niveauDe = v => {
    const s = norm(v);
    const m = s.match(/\b(tps|ps|ms|gs|cp|ce1|ce2|cm1|cm2)\b/);
    return m ? m[1] : s;
  };

  const mots = v => norm(v).split(/\s+/).filter(x => x.length >= 3);

  const besoinsEtObjectifs = e => {
    const besoins = (e.besoins || []).map(x => x && typeof x === "object"
      ? (x.domaine || x.champ || x.hypothese || x.libelle || "") : x);
    const objectifs = (e.objectifs || [])
      .filter(x => !x || !x.statut || x.statut === "actif")
      .map(x => x && typeof x === "object"
        ? (x.domaine || x.libelle || x.contexte || x.champ || "") : x);
    return besoins.concat(objectifs).map(norm).filter(Boolean);
  };

  const niveauEleve = e => niveauDe(
    e.niveau || e.classeNiveau || e.classe || e.niveauScolaire || ""
  );

  const niveauEquivalentSujet = (e, matiere) => {
    const eq = e.equivalenceScolaire && e.equivalenceScolaire[matiere];
    const v = eq && eq.niveauEquivalent;
    return v ? niveauDe(v) : niveauEleve(e);
  };

  const classeEleve = e => norm(
    e.classeId || e.classe || e.classeNom || e.groupeClasse || ""
  );

  const classeDuGroupe = g => norm(g.classeId || g.classe || g.niveau || "");

  // ⚠ Fidèle à la V1 : cette condition, telle qu'écrite dans
  // planning-core.js, évalue la même chose dans ses deux branches
  // (le test sur `origine` ne change rien au résultat). Comportement
  // reproduit sans simplification, pour rester rigoureusement identique.
  const estRecreation = g => g.fixe && String(g.origine || "").indexOf("__fixe_") === -1
    ? String(g.titre || "").toLowerCase().indexOf("récré") !== -1
    : g.fixe && String(g.titre || "").toLowerCase().indexOf("récré") !== -1;

  class RepartitionJourManager {
    /**
     * @param {object} options
     * @param {object} [options.dataManager]   - DataManager (lecture protégée)
     * @param {object} [options.journalAdapter]
     * @param {function} [options.uid]
     */
    constructor(options) {
      options = options || {};
      this.data = options.dataManager || null;
      this.journalAdapter = options.journalAdapter || new JournalAdapter();
      this.uid = options.uid || RepartitionJourManager.uidParDefaut;
    }

    static uidParDefaut(prefixe) {
      return prefixe + "_" + Date.now().toString(36) + "_" +
        Math.random().toString(36).slice(2, 8);
    }

    _lireEleves(coffre) {
      if (this.data && typeof this.data.getProtege === "function") {
        const liste = this.data.getProtege("eleves");
        return Array.isArray(liste) ? liste : [];
      }
      if (!coffre || !coffre.ouvert) return [];
      return coffre.listerEleves ? coffre.listerEleves() : [];
    }

    static scoreBesoin(e, g) {
      const besoins = besoinsEtObjectifs(e);
      if (!besoins.length) return 0;
      const cible = norm(String(g.domaineCle || "") + " " + String(g.titre || ""));
      const cibleMots = mots(cible);
      let score = 0;
      besoins.forEach(b => {
        if (!b) return;
        if (cible.indexOf(b) !== -1 || b.indexOf(cible) !== -1) { score += 8; return; }
        mots(b).forEach(m => {
          if (cibleMots.some(x => x === m || x.indexOf(m) === 0 || m.indexOf(x) === 0)) score += 3;
          else if (m.length >= 4 && cible.indexOf(m.slice(0, 4)) !== -1) score += 2;
        });
      });
      return score;
    }

    static scoreNiveau(e, g) {
      const cible = norm(String(g.domaineCle || "") + " " + String(g.titre || ""));
      const estFrancaisG = /franc|lecture|ecriture|oral|comprehension/.test(cible);
      const estMathsG = /math|nombre|calcul|grandeur|geometr/.test(cible);
      const ne = estFrancaisG ? niveauEquivalentSujet(e, "francais")
        : estMathsG ? niveauEquivalentSujet(e, "mathematiques") : niveauEleve(e);
      const ng = niveauDe(g.niveau || g.classeId || "");
      if (!ne || !ng) return 0;
      return ne === ng ? 4 : 0;
    }

    static groupeScore(e, g) {
      return RepartitionJourManager.scoreBesoin(e, g) + RepartitionJourManager.scoreNiveau(e, g);
    }

    static classesRecreation(bloc) {
      return bloc.groupes.filter(g => {
        if (!g.fixe) return false;
        const t = norm(g.titre);
        return t.includes("recre") || t.includes("récré");
      });
    }

    static appartientARecreation(e, g) {
      const ec = classeEleve(e);
      const gc = classeDuGroupe(g);
      const en = niveauEleve(e);
      const gn = niveauDe(g.niveau || g.classeId || "");
      if (ec && gc && (ec === gc || gc.indexOf(ec) !== -1 || ec.indexOf(gc) !== -1)) return true;
      return !!(en && gn && en === gn && !ec);
    }

    /**
     * @param {string} iso           - date ISO de la journée à répartir
     * @param {object} journalJour   - l'objet journée du cahier journal, MUTÉ en place
     * @param {object} [coffre]      - Coffre ouvert (repli sans DataManager)
     * @returns {object} journalJour, après répartition et sauvegarde
     */
    repartirJournee(iso, journalJour, coffre) {
      const eleves = this._lireEleves(coffre);
      if (!eleves.length) return journalJour;

      CahierJournalManager.regrouperParBloc(journalJour).forEach(bloc => {
        this._traiterBloc(bloc, journalJour, eleves);
      });

      journalJour.groupes.forEach(g => { delete g._repartitionInactif; });

      const journal = this.journalAdapter.charger();
      journal[iso] = journalJour;
      this.journalAdapter.sauver(journal);
      return journalJour;
    }

    _traiterBloc(bloc, journalJour, eleves) {
      const recreations = RepartitionJourManager.classesRecreation(bloc);
      const travail = bloc.groupes.filter(g => !g.fixe);

      travail.forEach(g => { g.eleves = []; });
      bloc.groupes.filter(g => g.fixe).forEach(g => { g.eleves = []; });

      const places = new Map();

      // 1) Récréations : priorité absolue.
      eleves.forEach(e => {
        const id = e.identifiantSynapses;
        if (!id) return;
        const rec = recreations.find(g => RepartitionJourManager.appartientARecreation(e, g));
        if (rec) { rec.eleves.push(id); places.set(id, rec.id); }
      });

      // 1 bis) Scission d'un groupe de travail unique en groupes de besoin.
      if (travail.length === 1) {
        this._scinderGroupeUnique(travail, journalJour, eleves, places);
      }

      // 2) Jusqu'à 3 groupes de travail candidats.
      let candidats = travail.slice();
      if (candidats.length > 3) {
        const restants = eleves.filter(e => !places.has(e.identifiantSynapses));
        const choisis = [];
        while (choisis.length < 3 && candidats.length) {
          let meilleur = null, meilleurGain = -1;
          candidats.forEach(g => {
            let gain = 0;
            restants.forEach(e => {
              const s = RepartitionJourManager.groupeScore(e, g);
              if (s > gain) gain = s;
            });
            if (g.adulte && norm(g.adulte.type) === "enseignant") gain += 1;
            if (gain > meilleurGain) { meilleurGain = gain; meilleur = g; }
          });
          if (!meilleur) break;
          choisis.push(meilleur);
          candidats = candidats.filter(g => g !== meilleur);
        }
        travail.forEach(g => { g._repartitionInactif = !choisis.includes(g); });
        candidats = choisis;
      } else {
        travail.forEach(g => { g._repartitionInactif = false; });
      }

      // Groupe de secours si aucun candidat n'existe.
      if (!candidats.length) {
        const g = {
          id: this.uid("grp"), debut: bloc.debut, fin: bloc.fin, origine: null, modifie: true,
          adulte: { type: "enseignant", nom: "" }, titre: "Groupe avec l'enseignant",
          domaineCle: "", niveau: "", classeId: "", seanceRef: null, eleves: [],
          remarque: "Créé automatiquement pour les élèves hors récréation.",
          fixe: false, repartitionAuto: true, personnalise: false
        };
        journalJour.groupes.push(g);
        candidats = [g];
      }

      // 3) Attribution : besoins d'abord, niveau ensuite, équilibrage en dernier.
      const restants = eleves.filter(e => !places.has(e.identifiantSynapses));
      restants.forEach(e => {
        const id = e.identifiantSynapses;
        if (!id) return;
        let meilleur = null, meilleurScore = -Infinity;
        candidats.forEach(g => {
          const score = RepartitionJourManager.groupeScore(e, g);
          const charge = (g.eleves || []).length;
          const total = score * 100 - charge;
          if (total > meilleurScore) { meilleurScore = total; meilleur = g; }
        });
        if (meilleur) {
          meilleur.eleves = meilleur.eleves || [];
          meilleur.eleves.push(id);
          places.set(id, meilleur.id);
        }
      });

      // 4) Nettoyage des groupes automatiques restés vides.
      journalJour.groupes = journalJour.groupes.filter(g =>
        !g.repartitionAuto || (g.eleves && g.eleves.length)
      );
    }

    _scinderGroupeUnique(travail, journalJour, eleves, places) {
      const modele = travail[0];
      const restantsAScinder = eleves.filter(e => !places.has(e.identifiantSynapses));
      if (restantsAScinder.length <= 1) return;

      const cible = norm(String(modele.domaineCle || "") + " " + String(modele.titre || ""));
      const estFrancaisG = /franc|lecture|ecriture|oral|comprehension/.test(cible);
      const estMathsG = /math|nombre|calcul|grandeur|geometr/.test(cible);

      const clusters = new Map();
      restantsAScinder.forEach(e => {
        const niv = estFrancaisG ? niveauEquivalentSujet(e, "francais")
          : estMathsG ? niveauEquivalentSujet(e, "mathematiques") : niveauEleve(e);
        const cle = niv || "?";
        if (!clusters.has(cle)) clusters.set(cle, []);
        clusters.get(cle).push(e);
      });

      let cles = Array.from(clusters.keys());
      if (cles.length <= 1) return;

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
        id: this.uid("grp"),
        titre: modele.titre + (cle && cle !== "mixte" && cle !== "?"
          ? " — " + cle.toUpperCase() : " — Groupe " + (i + 1)),
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

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.RepartitionJourManager = RepartitionJourManager;
})(typeof window !== "undefined" ? window : globalThis);
