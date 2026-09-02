/**
 * grille-analyse.js
 * ---------------------------------------------------------------------------
 * Moteur d'analyse individuelle, annoncé comme "à venir" dans
 * suivi-individuel.js. S'appuie sur :
 *  - le référentiel PUBLIC grille-analyse-generale.json (BARRY) pour relier
 *    difficultés -> besoins -> adaptations -> objectifs-types ;
 *  - les données de l'élève fournies par le Coffre (synapses-coffre.js).
 *
 * Rôle :
 *  1. Compiler les besoins et les adaptations déjà enregistrés pour un
 *     élève (observations + entrées dédiées besoins/adaptations).
 *  2. Suggérer des objectifs à partir des besoins compilés (objectifsTypes
 *     du référentiel), sans jamais les imposer.
 *  3. Proposer un parcours de compétences à travailler (mise en ordre des
 *     objectifs retenus/suggérés selon la chaîne d'analyse).
 *  4. Permettre de mobiliser une IA externe pour enrichir ces propositions,
 *     SANS jamais transmettre l'identité de l'élève : seul un prompt
 *     anonymisé (domaines, situations, difficultés, besoins, adaptations —
 *     aucun nom, aucun identifiant Synapses) est généré, sur le modèle de
 *     l'atelier IA de generateur-sequences-projet.html (copier/coller vers
 *     un chat gratuit, aucune clé API, aucun appel réseau depuis ce module).
 *     Toute proposition importée reste une SUGGESTION : l'enseignant choisit
 *     explicitement ce qu'il retient avant tout ajout au coffre.
 *
 * Dépend de synapses-coffre.js (pour les helpers de validation) mais ne
 * modifie jamais le coffre lui-même : c'est l'appelant (UI) qui décide
 * d'appeler coffre.ajouterBesoin / ajouterAdaptation / ajouterObjectif
 * une fois une suggestion validée par l'enseignant.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // ==========================================================================
  // 1. Moteur pur (aucune dépendance au DOM) — testable indépendamment
  // ==========================================================================

  class MoteurAnalyse {
    /**
     * @param {object} referentielGeneral - contenu de grille-analyse-generale.json (BARRY,
     *   domaines transversaux : besoins/adaptations/objectifsTypes)
     * @param {object} [referentielDisciplinaire] - contenu de Programmation/data/competences.json
     *   (S4C, programmes disciplinaires : { domaines:[...], competences:[{id,discipline,intitule,...}] }).
     *   Public, non nominatif → peut être consulté par le moteur ET transmis (en extrait) à l'IA.
     */
    constructor(referentielGeneral, referentielDisciplinaire) {
      this.referentiel = referentielGeneral;
      this.referentielDisciplinaire = referentielDisciplinaire || null;
    }

    _domaine(domaineId) {
      return (this.referentiel?.domaines || []).find((d) => d.id === domaineId) || null;
    }

    _besoinParId(domaineId, besoinId) {
      const d = this._domaine(domaineId);
      return d ? (d.besoins || []).find((b) => b.id === besoinId) : null;
    }

    _adaptationParId(domaineId, adaptationId) {
      const d = this._domaine(domaineId);
      return d ? (d.adaptations || []).find((a) => a.id === adaptationId) : null;
    }

    /** Retrouve un besoin/une adaptation du référentiel à partir de son libellé
     *  (les observations stockent des libellés, pas toujours des ids). */
    _parLibelle(liste, libelle) {
      if (!libelle) return null;
      const norm = (s) => (s || '').trim().toLowerCase();
      return (liste || []).find((it) => norm(it.libelle) === norm(libelle)) || null;
    }

    // ------------------------------------------------------------------
    // Compilation des besoins / adaptations déjà connus pour un élève
    // ------------------------------------------------------------------

    /**
     * Compile les besoins d'un élève à partir de :
     *  - eleve.besoins (entrées dédiées, avec priorité/évolution) ;
     *  - eleve.observations (champ "besoin", texte libre ou issu du référentiel).
     * Regroupe par libellé + domaine, avec un compteur d'occurrences et,
     * quand c'est possible, le rattachement au référentiel (adaptations
     * liées, objectifs-types).
     */
    compilerBesoins(eleve) {
      const parCle = new Map();

      const enregistrer = (domaineId, libelle, source, extra) => {
        if (!libelle) return;
        const cle = (domaineId || '?') + '|' + libelle.trim().toLowerCase();
        if (!parCle.has(cle)) {
          const domaine = this._domaine(domaineId);
          const refBesoin = domaine ? this._parLibelle(domaine.besoins, libelle) : null;
          parCle.set(cle, {
            domaineId,
            domaineNom: domaine ? domaine.nom : domaineId,
            libelle: libelle.trim(),
            refId: refBesoin ? refBesoin.id : null,
            occurrences: 0,
            sources: [],
            priorite: null,
            adaptationsLiees: refBesoin ? refBesoin.adaptationsLiees || [] : [],
            objectifsTypes: refBesoin ? refBesoin.objectifsTypes || [] : []
          });
        }
        const entree = parCle.get(cle);
        entree.occurrences += 1;
        entree.sources.push(source);
        if (extra && extra.priorite != null && entree.priorite == null) entree.priorite = extra.priorite;
      };

      (eleve.besoins || []).forEach((b) => enregistrer(b.domaine || null, b.libelle || b.hypothese, 'besoin', { priorite: b.priorite }));
      (eleve.observations || []).forEach((o) => enregistrer(o.domaine || null, o.besoin, 'observation du ' + this._dateCourte(o.date)));

      return Array.from(parCle.values()).sort((a, b) => b.occurrences - a.occurrences);
    }

    /** Même logique que compilerBesoins, pour les adaptations, en tenant
     *  compte de l'efficacité déjà observée quand elle est renseignée. */
    compilerAdaptations(eleve) {
      const parCle = new Map();

      const enregistrer = (domaineId, libelle, source, extra) => {
        if (!libelle) return;
        const cle = (domaineId || '?') + '|' + libelle.trim().toLowerCase();
        if (!parCle.has(cle)) {
          const domaine = this._domaine(domaineId);
          const refAdaptation = domaine ? this._parLibelle(domaine.adaptations, libelle) : null;
          parCle.set(cle, {
            domaineId,
            domaineNom: domaine ? domaine.nom : domaineId,
            libelle: libelle.trim(),
            refId: refAdaptation ? refAdaptation.id : null,
            occurrences: 0,
            utilisee: false,
            efficacites: [],
            sources: []
          });
        }
        const entree = parCle.get(cle);
        entree.occurrences += 1;
        entree.sources.push(source);
        if (extra && extra.utilisee) entree.utilisee = true;
        if (extra && extra.efficacite != null) entree.efficacites.push(extra.efficacite);
      };

      (eleve.adaptations || []).forEach((a) =>
        enregistrer(a.domaine || null, a.libelle, 'adaptation suivie', { utilisee: a.utilisee, efficacite: a.efficacite })
      );
      (eleve.observations || []).forEach((o) =>
        enregistrer(o.domaine || null, o.adaptationUtilisee || o.adaptationProposee, 'observation du ' + this._dateCourte(o.date), {
          utilisee: !!o.adaptationUtilisee
        })
      );

      return Array.from(parCle.values())
        .map((e) => Object.assign(e, {
          efficaciteMoyenne: e.efficacites.length
            ? e.efficacites.reduce((s, v) => s + v, 0) / e.efficacites.length
            : null
        }))
        .sort((a, b) => b.occurrences - a.occurrences);
    }

    _dateCourte(iso) {
      try { return new Date(iso).toLocaleDateString('fr-FR'); } catch (e) { return '?'; }
    }

    // ------------------------------------------------------------------
    // Compétences disciplinaires prioritaires (Programmation/data/competences.json)
    // ------------------------------------------------------------------

    _competenceParId(id) {
      return (this.referentielDisciplinaire?.competences || []).find((c) => c.id === id) || null;
    }

    /**
     * Compile les compétences disciplinaires (S4C — lecture/écriture/oral,
     * mathématiques, etc.) à travailler en priorité, à partir des observations
     * où l'enseignant a explicitement rattaché une compétence du référentiel
     * public (champ observation.competence, renseigné dans le formulaire pour
     * les domaines 'mathematiques'/'francais'). Plus une compétence revient
     * dans les observations, plus elle est jugée prioritaire.
     * Ne renvoie rien si le référentiel disciplinaire n'a pas été fourni.
     */
    competencesPrioritaires(eleve) {
      if (!this.referentielDisciplinaire) return [];
      const parId = new Map();
      (eleve.observations || []).forEach((o) => {
        if (!o.competence) return;
        const ref = this._competenceParId(o.competence);
        if (!ref) return;
        if (!parId.has(o.competence)) {
          parId.set(o.competence, {
            id: o.competence,
            discipline: ref.discipline || '',
            intitule: ref.intitule || ref.libelle || o.competence,
            occurrences: 0
          });
        }
        parId.get(o.competence).occurrences += 1;
      });
      return Array.from(parId.values()).sort((a, b) => b.occurrences - a.occurrences);
    }

    /**
     * Extrait, depuis le référentiel disciplinaire PUBLIC (competences.json,
     * S4C), l'ensemble des compétences de français et de mathématiques,
     * organisées par niveau (CP, CE1, CE2, CM1, CM2, 6e...). Sert de base de
     * comparaison pour estimer une équivalence scolaire (voir
     * genererPromptIA) : uniquement des données de programme, non
     * nominatives, donc transmissibles sans restriction à une IA externe.
     * Renvoie null si aucun référentiel disciplinaire n'a été fourni.
     */
    _extraitReferentielEquivalence() {
      if (!this.referentielDisciplinaire) return null;
      const liste = this.referentielDisciplinaire.competences || [];
      const parDiscipline = { francais: [], mathematiques: [] };
      liste.forEach((c) => {
        const disc = (c.discipline || '').toLowerCase();
        const cle = disc.startsWith('math') ? 'mathematiques' : (disc.startsWith('fran') ? 'francais' : null);
        if (!cle) return;
        parDiscipline[cle].push({
          niveau: c.niveau || c.cycle || null,
          domaine: c.domaine || null,
          intitule: c.intitule || c.libelle || c.id
        });
      });
      if (!parDiscipline.francais.length && !parDiscipline.mathematiques.length) return null;
      return parDiscipline;
    }

    // ------------------------------------------------------------------
    // Suggestion d'objectifs à partir des besoins compilés
    // ------------------------------------------------------------------

    /**
     * Pour chaque besoin compilé rattaché au référentiel, propose les
     * objectifs-types associés, en excluant ceux déjà présents (même
     * libellé) dans eleve.objectifs. Chaque suggestion garde une trace du
     * besoin dont elle découle, pour respecter la chaîne d'analyse.
     */
    suggererObjectifs(eleve) {
      const besoinsCompiles = this.compilerBesoins(eleve);
      const objectifsExistants = new Set((eleve.objectifs || []).map((o) => (o.libelle || '').trim().toLowerCase()));

      const suggestions = [];
      besoinsCompiles.forEach((b) => {
        (b.objectifsTypes || []).forEach((ot) => {
          if (objectifsExistants.has(ot.libelle.trim().toLowerCase())) return;
          suggestions.push({
            domaineId: b.domaineId,
            domaineNom: b.domaineNom,
            besoinOrigine: b.libelle,
            besoinRefId: b.refId,
            libelle: ot.libelle,
            refId: ot.id,
            // score simple : occurrences du besoin + priorité déclarée
            score: b.occurrences + (b.priorite || 0)
          });
        });
      });

      return suggestions.sort((a, b) => b.score - a.score);
    }

    // ------------------------------------------------------------------
    // Parcours de compétences à travailler
    // ------------------------------------------------------------------

    /**
     * Construit un parcours ordonné à partir :
     *  - des objectifs déjà actifs de l'élève (statut 'actif'), en premier,
     *    dans leur ordre de création (ce qui est engagé continue) ;
     *  - puis des compétences disciplinaires prioritaires (S4C/competences.json),
     *    quand le référentiel disciplinaire a été fourni ;
     *  - puis des suggestions transversales (BARRY), triées par score décroissant.
     * Chaque étape porte les adaptations associées au besoin d'origine,
     * pour que le parcours reste actionnable (pas seulement une liste
     * d'intitulés). C'est cette méthode qui alimente l'onglet "Parcours".
     * @param {object} [options] - { maxEtapes }
     */
    proposerParcours(eleve, options) {
      options = options || {};
      const maxEtapes = options.maxEtapes || 10;

      const etapes = [];

      (eleve.objectifs || [])
        .filter((o) => o.statut === 'actif')
        .forEach((o) => {
          etapes.push({
            statut: 'en cours',
            domaineId: o.domaine || null,
            domaineNom: this._domaine(o.domaine)?.nom || o.domaine || '—',
            objectif: o.libelle,
            origine: 'objectif déjà retenu par l\'enseignant',
            adaptationsAssociees: []
          });
        });

      this.competencesPrioritaires(eleve).forEach((c) => {
        if (etapes.length >= maxEtapes) return;
        etapes.push({
          statut: 'à valider',
          domaineId: c.discipline === 'Français' ? 'francais' : c.discipline === 'Mathématiques' ? 'mathematiques' : null,
          domaineNom: c.discipline || 'Discipline',
          objectif: c.intitule,
          origine: 'compétence disciplinaire (S4C/competences.json) observée à ' + c.occurrences + ' reprise' + (c.occurrences > 1 ? 's' : ''),
          adaptationsAssociees: []
        });
      });

      const suggestions = this.suggererObjectifs(eleve);
      suggestions.forEach((s) => {
        if (etapes.length >= maxEtapes) return;
        const besoinRef = s.besoinRefId ? this._besoinParId(s.domaineId, s.besoinRefId) : null;
        const adaptations = (besoinRef?.adaptationsLiees || [])
          .map((id) => this._adaptationParId(s.domaineId, id))
          .filter(Boolean)
          .map((a) => a.libelle);
        etapes.push({
          statut: 'à valider',
          domaineId: s.domaineId,
          domaineNom: s.domaineNom,
          objectif: s.libelle,
          origine: 'suggéré à partir du besoin « ' + s.besoinOrigine + ' »',
          adaptationsAssociees: adaptations
        });
      });

      return etapes.slice(0, maxEtapes).map((e, i) => Object.assign({ ordre: i + 1 }, e));
    }

    // ------------------------------------------------------------------
    // Mobilisation d'une IA externe, avec anonymat garanti
    // ------------------------------------------------------------------

    /**
     * Réduit l'élève à un instantané STRICTEMENT anonyme : aucun nom, aucune
     * identité, aucun identifiantSynapses, et JAMAIS l'établissement/la classe
     * (coffre.donnees.etablissement) — cette fonction ne les lit d'ailleurs
     * jamais, par construction : elle ne reçoit que l'objet "eleve", pas le
     * coffre. Seules les données d'analyse (domaine, situations, difficultés,
     * besoins, adaptations, objectifs actifs) sont conservées, sans dates
     * précises (juste l'ordre relatif).
     *
     * L'ÂGE (eleve.age) et la CLASSE DE RÉFÉRENCE (eleve.classe) sont
     * INTENTIONNELLEMENT EXCLUS de cet instantané, malgré leur disponibilité
     * sur l'objet élève. Décision : combinés aux observations
     * détaillées (données de santé/handicap au sens de l'art. 9 RGPD) et au
     * contexte d'un dispositif à faible effectif (ULIS, UPE2A, SEGPA...), l'âge
     * et la classe agissent comme quasi-identifiants et augmentent le risque de
     * ré-identification par recoupement — d'autant qu'aucun contrat de
     * sous-traitance (art. 28 RGPD) ne lie l'enseignant au service IA externe
     * utilisé. Le principe de minimisation (art. 5.1.c RGPD) prévaut sur le
     * confort de calibrage que ces données apporteraient aux suggestions.
     * L'âge et la classe restent néanmoins consultables/modifiables localement
     * dans le coffre (aucun souci RGPD à cet usage), simplement jamais
     * transmis hors de l'application.
     */
    anonymiser(eleve) {
      const observations = (eleve.observations || []).map((o) => ({
        domaine: o.domaine,
        situation: o.situation,
        pointsAppui: o.pointsAppui,
        difficulte: o.difficulte,
        besoin: o.besoin,
        adaptationProposee: o.adaptationProposee,
        adaptationUtilisee: o.adaptationUtilisee,
        resultat: o.resultat,
        autonomie: o.autonomie
      }));
      const besoinsCompiles = this.compilerBesoins(eleve).map((b) => ({
        domaine: b.domaineNom, besoin: b.libelle, occurrences: b.occurrences, priorite: b.priorite
      }));
      const adaptationsCompilees = this.compilerAdaptations(eleve).map((a) => ({
        domaine: a.domaineNom, adaptation: a.libelle, occurrences: a.occurrences,
        utilisee: a.utilisee, efficaciteMoyenne: a.efficaciteMoyenne
      }));
      const objectifsActifs = (eleve.objectifs || [])
        .filter((o) => o.statut === 'actif')
        .map((o) => ({ domaine: o.domaine, libelle: o.libelle }));

      return { observations, besoinsCompiles, adaptationsCompilees, objectifsActifs };
    }

    /**
     * Construit le prompt à copier/coller dans un chat IA gratuit, sur le
     * modèle exact de l'atelier IA de generateur-sequences-projet.html :
     * aucune clé API, aucun appel réseau — juste un texte que l'enseignant
     * transmet lui-même, hors de toute donnée nominative.
     *
     * @param {object} eleve
     * @param {string} [dispositif] - type de dispositif d'école inclusive
     *   (ex: "ULIS école"), donnée générique utile au contexte pédagogique.
     *   IMPORTANT : n'accepte QUE ce libellé de dispositif, jamais l'objet
     *   coffre ni son champ "etablissement" — voir le garde-fou dans
     *   GrilleAnalyseUI._sectionAtelierIA(), qui ne lit jamais ce champ.
     */
    genererPromptIA(eleve, dispositif) {
      const donnees = this.anonymiser(eleve);
      const schema = `{
  "hypothesesBesoins": [
    {"domaine": "…", "besoin": "…", "justification": "…"}
  ],
  "adaptationsSuggerees": [
    {"domaine": "…", "adaptation": "…", "pourBesoin": "…"}
  ],
  "objectifsSuggeres": [
    {"domaine": "…", "objectif": "…", "criteresReussite": "…", "pourBesoin": "…"}
  ],
  "parcoursPropose": [
    {"ordre": 1, "domaine": "…", "objectif": "…", "pourquoiCetOrdre": "…"}
  ],
  "equivalenceScolaire": {
    "francais": {"niveauEquivalent": "…", "compteRendu": "…"},
    "mathematiques": {"niveauEquivalent": "…", "compteRendu": "…"},
    "transversal": {"compteRendu": "…"}
  }
}`;

      const dispositifTxt = (dispositif || '').trim();
      const intro = dispositifTxt
        ? `Tu es un conseiller pédagogique spécialisé dans l'école inclusive, dans le cadre d'un dispositif de type « ${dispositifTxt} ». Tu analyses des observations totalement anonymisées d'un élève (aucun nom, aucune identité, aucun âge, aucun établissement ni classe ne te sont communiqués et tu ne dois en demander aucun).`
        : `Tu es un conseiller pédagogique spécialisé dans l'école inclusive. Tu analyses des observations totalement anonymisées d'un élève (aucun nom, aucune identité, aucun âge, aucun établissement ni classe ne te sont communiqués et tu ne dois en demander aucun).`;

      // Extrait PUBLIC du référentiel de compétences disciplinaires
      // (Programmation/data/competences.json) : uniquement les compétences déjà
      // rattachées par l'enseignant à une observation. On ne transmet jamais le
      // fichier entier (inutilement volumineux), seulement ce qui est pertinent —
      // et comme il s'agit d'un référentiel public (aucune donnée élève), il n'y
      // a pas d'enjeu de confidentialité à le transmettre.
      const competencesPub = this.competencesPrioritaires(eleve).map((c) => ({
        discipline: c.discipline, competence: c.intitule, occurrencesObservees: c.occurrences
      }));
      const blocCompetences = competencesPub.length
        ? `\n\nEXTRAIT DU RÉFÉRENTIEL PUBLIC DE COMPÉTENCES DÉJÀ OBSERVÉES CHEZ CET ÉLÈVE (Programmation/data/competences.json — non nominatif) :\n${JSON.stringify(competencesPub, null, 2)}`
        : '';

      // Base de comparaison PUBLIQUE et complète (tous niveaux, français et
      // mathématiques) pour permettre à l'IA de situer un niveau moyen
      // équivalent — distincte de blocCompetences qui ne liste que ce qui a
      // déjà été observé chez cet élève précis.
      const refEquivalence = this._extraitReferentielEquivalence();
      const blocEquivalence = refEquivalence
        ? `\n\nRÉFÉRENTIEL PUBLIC DE COMPÉTENCES PAR NIVEAU, POUR COMPARAISON (Programmation/data/competences.json — non nominatif, couvre plusieurs niveaux du programme) :\n${JSON.stringify(refEquivalence, null, 2)}`
        : '';

      return `${intro}

RÈGLES :
- Ne cherche jamais à identifier l'élève, son établissement, sa classe ou son âge, ni à demander des informations personnelles.
- Respecte exactement la structure JSON demandée, sans texte avant ou après.
- Appuie-toi sur les observations et les besoins/adaptations déjà compilés, ainsi que sur l'extrait du référentiel public de compétences ci-dessous s'il est fourni, pour proposer, en complément (pas en remplacement) : des hypothèses de besoins supplémentaires, des adaptations, des objectifs formulés de façon observable (en priorité alignés sur les intitulés du référentiel public quand c'est pertinent), et un parcours de compétences ordonné.
- En t'appuyant sur le référentiel public de compétences par niveau fourni ci-dessous (s'il est présent) et sur l'ensemble des observations anonymisées, estime également une ÉQUIVALENCE SCOLAIRE : un niveau moyen équivalent en français et un niveau moyen équivalent en mathématiques, obtenus en comparant ce que l'élève maîtrise ou non aux compétences attendues à chaque niveau du programme. Indique le niveau le plus proche (ex. « CP », « milieu de CE1 », « fin de CE2 ») accompagné d'un compte rendu de quelques lignes justifiant cette estimation pour chaque discipline, puis rédige une troisième description, transversale, qui ne se limite pas au disciplinaire mais couvre l'ensemble des domaines (affectif, social, cognitif, sensorimoteur...).
- Si les données disponibles sont insuffisantes pour estimer un niveau de façon fiable, dis-le explicitement dans le compte rendu correspondant plutôt que d'inventer un niveau précis.
- Toute proposition reste une suggestion : ne formule rien comme une certitude ou un diagnostic.
- Reste concret et évite les formulations génériques.

DONNÉES ANONYMISÉES DE L'ÉLÈVE :
${JSON.stringify(donnees, null, 2)}${blocCompetences}${blocEquivalence}

FORMAT JSON EXACT ATTENDU :
${schema}`;
    }

    /**
     * Extrait et valide le JSON collé en retour par l'enseignant après avoir
     * utilisé le prompt ci-dessus. Ne modifie jamais le coffre : renvoie un
     * objet de propositions que l'UI présente pour validation individuelle.
     */
    importerReponseIA(texte) {
      let brut = (texte || '').trim().replace(/```json/gi, '').replace(/```/g, '').trim();
      const a = brut.indexOf('{');
      const b = brut.lastIndexOf('}');
      if (a < 0 || b < 0) throw new Error('Aucun objet JSON trouvé dans la réponse collée.');
      let obj;
      try {
        obj = JSON.parse(brut.slice(a, b + 1));
      } catch (e) {
        throw new Error('Réponse IA illisible (JSON invalide) : ' + e.message);
      }
      const eq = obj.equivalenceScolaire && typeof obj.equivalenceScolaire === 'object' ? obj.equivalenceScolaire : {};
      const normEq = (v) => (v && typeof v === 'object') ? {
        niveauEquivalent: typeof v.niveauEquivalent === 'string' ? v.niveauEquivalent : '',
        compteRendu: typeof v.compteRendu === 'string' ? v.compteRendu : ''
      } : null;
      const normTransversal = (v) => (v && typeof v === 'object') ? {
        compteRendu: typeof v.compteRendu === 'string' ? v.compteRendu : ''
      } : null;

      return {
        hypothesesBesoins: Array.isArray(obj.hypothesesBesoins) ? obj.hypothesesBesoins : [],
        adaptationsSuggerees: Array.isArray(obj.adaptationsSuggerees) ? obj.adaptationsSuggerees : [],
        objectifsSuggeres: Array.isArray(obj.objectifsSuggeres) ? obj.objectifsSuggeres : [],
        parcoursPropose: Array.isArray(obj.parcoursPropose) ? obj.parcoursPropose : [],
        equivalenceScolaire: {
          francais: normEq(eq.francais),
          mathematiques: normEq(eq.mathematiques),
          transversal: normTransversal(eq.transversal)
        }
      };
    }
  }

  // ==========================================================================
  // 2. Interface optionnelle — onglet "Analyse & IA", branchée sur le Coffre
  // ==========================================================================

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach((c) => { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  class GrilleAnalyseUI {
    /**
     * @param {SynapsesCoffre.Coffre} coffre
     * @param {object} referentielGeneral - grille-analyse-generale.json déjà chargé
     * @param {object} [referentielDisciplinaire] - Programmation/data/competences.json déjà
     *   chargé (public, S4C) — permet au parcours d'inclure les compétences disciplinaires
     *   (lecture/écriture/oral, mathématiques...) observées en priorité chez l'élève.
     */
    constructor(coffre, referentielGeneral, referentielDisciplinaire) {
      this.coffre = coffre;
      this.moteur = new MoteurAnalyse(referentielGeneral, referentielDisciplinaire);
    }

    /** Rend l'onglet "Analyse & IA" pour un élève donné dans un conteneur. */
    render(container, eleve) {
      container.innerHTML = '';
      container.appendChild(this._sectionBesoinsAdaptations(eleve));
      container.appendChild(this._sectionParcours(eleve));
      container.appendChild(this._sectionAtelierIA(eleve, container));
    }

    /** Rend uniquement la section "Équivalence scolaire" (niveau moyen
     *  estimé en français/mathématiques + description transversale), pour
     *  être réutilisée telle quelle dans l'onglet dédié de suivi-individuel.js. */
    renderEquivalenceScolaire(eleve) {
      return this._sectionEquivalenceScolaire(eleve);
    }

    _sectionEquivalenceScolaire(eleve) {
      const eq = eleve.equivalenceScolaire || {};
      const bloc = (titre, contenu) => el('div', { class: 'ga-equiv-bloc' }, [
        el('h4', {}, [titre]),
        contenu
      ]);
      const rendreDiscipline = (d) => d
        ? el('div', {}, [
            d.niveauEquivalent ? el('p', {}, [el('strong', {}, ['Niveau équivalent : ']), d.niveauEquivalent]) : null,
            el('p', {}, [d.compteRendu || '—'])
          ])
        : el('p', { class: 'si-empty' }, ['Pas encore estimé.']);
      const rendreTransversal = (t) => t
        ? el('p', {}, [t.compteRendu || '—'])
        : el('p', { class: 'si-empty' }, ['Pas encore estimé.']);

      return el('div', { class: 'ga-section ga-equivalence' }, [
        el('h3', {}, ['Équivalence scolaire']),
        el('p', { class: 'si-hint' }, [
          'Estimation d\'un niveau moyen équivalent en français et en mathématiques, obtenue par comparaison avec les compétences du programme (référentiel public), plus une description transversale à tous les domaines. ' +
          'Généré et mis à jour depuis l\'atelier IA ci-dessous ; toujours une suggestion à valider, jamais un diagnostic.'
        ]),
        eq.dateMaj ? el('p', { class: 'si-hint' }, ['Dernière mise à jour : ' + new Date(eq.dateMaj).toLocaleDateString('fr-FR')]) : null,
        bloc('Français', rendreDiscipline(eq.francais)),
        bloc('Mathématiques', rendreDiscipline(eq.mathematiques)),
        bloc('Description transversale', rendreTransversal(eq.transversal))
      ]);
    }

    /** Rend uniquement la section "Parcours de compétences proposé", pour être
     *  réutilisée telle quelle dans l'onglet "Parcours" de suivi-individuel.js. */
    renderParcours(eleve) {
      return this._sectionParcours(eleve);
    }

    _sectionBesoinsAdaptations(eleve) {
      const besoins = this.moteur.compilerBesoins(eleve);
      const adaptations = this.moteur.compilerAdaptations(eleve);
      return el('div', { class: 'ga-section' }, [
        el('h3', {}, ['Besoins compilés']),
        besoins.length
          ? el('ul', {}, besoins.map((b) => el('li', {}, [
              `${b.domaineNom} — ${b.libelle} (×${b.occurrences}${b.priorite ? ', priorité ' + b.priorite : ''})`
            ])))
          : el('p', { class: 'si-empty' }, ['Aucun besoin enregistré pour l\'instant.']),
        el('h3', {}, ['Adaptations compilées']),
        adaptations.length
          ? el('ul', {}, adaptations.map((a) => el('li', {}, [
              `${a.domaineNom} — ${a.libelle} (×${a.occurrences}${a.efficaciteMoyenne != null ? ', efficacité moy. ' + a.efficaciteMoyenne.toFixed(1) : ''})`
            ])))
          : el('p', { class: 'si-empty' }, ['Aucune adaptation enregistrée pour l\'instant.'])
      ]);
    }

    _sectionParcours(eleve) {
      const parcours = this.moteur.proposerParcours(eleve);
      return el('div', { class: 'ga-section' }, [
        el('h3', {}, ['Parcours de compétences proposé']),
        parcours.length
          ? el('ol', {}, parcours.map((e) => el('li', {}, [
              el('strong', {}, [`[${e.domaineNom}] ${e.objectif}`]),
              ` — ${e.statut} (${e.origine})`,
              e.adaptationsAssociees.length ? el('div', { class: 'si-hint' }, ['Adaptations utiles : ' + e.adaptationsAssociees.join(', ')]) : null,
              e.statut === 'à valider'
                ? el('button', {
                    class: 'si-btn',
                    onclick: () => {
                      this.coffre.ajouterObjectif(eleve.identifiantSynapses, { domaine: e.domaineId, libelle: e.objectif, statut: 'actif' });
                      alert('Objectif ajouté au parcours de ' + eleve.identifiantSynapses + '.');
                    }
                  }, ['Retenir cet objectif'])
                : null
            ])))
          : el('p', { class: 'si-empty' }, ['Pas encore assez de données pour proposer un parcours.'])
      ]);
    }

    _sectionAtelierIA(eleve, containerParent) {
      // GARDE-FOU : on ne lit ici QUE coffre.donnees.dispositif (donnée
      // générique de contexte pédagogique). coffre.donnees.etablissement
      // n'est JAMAIS lu dans cette section, ni transmis à genererPromptIA —
      // pour des raisons de sécurité/confidentialité, il ne doit jamais
      // atteindre un prompt IA.
      const dispositif = this.coffre.donnees?.dispositif || '';
      const prompt = this.moteur.genererPromptIA(eleve, dispositif);
      const promptBox = el('div', { class: 'prompt-box' }, [prompt]);
      const reponseBox = el('textarea', { rows: 10, placeholder: 'Collez ici le JSON renvoyé par l\'IA…', class: 'ga-textarea' });
      const resultats = el('div', { class: 'ga-resultats-ia' });

      const importer = () => {
        let props;
        try {
          props = this.moteur.importerReponseIA(reponseBox.value);
        } catch (e) {
          alert(e.message);
          return;
        }
        resultats.innerHTML = '';
        resultats.appendChild(this._renderPropositionsIA(eleve, props));
      };

      return el('div', { class: 'ga-section ga-atelier-ia' }, [
        el('h3', {}, ['Mobiliser une IA (anonymisée)']),
        el('p', { class: 'si-hint' }, [
          'Aucune clé API, aucun envoi automatique. Le prompt ci-dessous précise le type de dispositif et, si disponible, un extrait du référentiel public de compétences ; il ne contient jamais nom, identifiant élève, âge, établissement ou classe (l\'âge, bien que stocké dans le coffre, n\'est jamais transmis à une IA — voir la note dans grille-analyse.js). ' +
          'Copiez-le dans le chat IA gratuit de votre choix, puis collez sa réponse pour l\'examiner — rien n\'est ajouté au coffre sans validation.'
        ]),
        promptBox,
        el('div', { class: 'ga-toolbar' }, [
          el('button', { class: 'si-btn si-btn-primary', onclick: () => navigator.clipboard?.writeText(prompt).then(() => alert('Prompt copié.')) }, ['📋 Copier le prompt anonymisé'])
        ]),
        el('label', {}, ['Réponse de l\'IA (JSON)']),
        reponseBox,
        el('button', { class: 'si-btn', onclick: importer }, ['Examiner la réponse']),
        resultats
      ]);
    }

    _renderPropositionsIA(eleve, props) {
      const wrap = el('div', {});

      const ligneValidable = (label, onValider) =>
        el('li', {}, [label, ' ', el('button', { class: 'si-btn si-btn-small', onclick: onValider }, ['Retenir'])]);

      wrap.appendChild(el('h4', {}, ['Hypothèses de besoins proposées']));
      wrap.appendChild(props.hypothesesBesoins.length
        ? el('ul', {}, props.hypothesesBesoins.map((h) => ligneValidable(
            `[${h.domaine}] ${h.besoin}${h.justification ? ' — ' + h.justification : ''}`,
            () => { this.coffre.ajouterBesoin(eleve.identifiantSynapses, { domaine: h.domaine, libelle: h.besoin, hypothese: h.justification || '' }); alert('Besoin ajouté.'); }
          )))
        : el('p', { class: 'si-empty' }, ['Aucune.']));

      wrap.appendChild(el('h4', {}, ['Adaptations suggérées']));
      wrap.appendChild(props.adaptationsSuggerees.length
        ? el('ul', {}, props.adaptationsSuggerees.map((a) => ligneValidable(
            `[${a.domaine}] ${a.adaptation}${a.pourBesoin ? ' (pour : ' + a.pourBesoin + ')' : ''}`,
            () => { this.coffre.ajouterAdaptation(eleve.identifiantSynapses, { domaine: a.domaine, libelle: a.adaptation }); alert('Adaptation ajoutée.'); }
          )))
        : el('p', { class: 'si-empty' }, ['Aucune.']));

      wrap.appendChild(el('h4', {}, ['Objectifs suggérés']));
      wrap.appendChild(props.objectifsSuggeres.length
        ? el('ul', {}, props.objectifsSuggeres.map((o) => ligneValidable(
            `[${o.domaine}] ${o.objectif}${o.criteresReussite ? ' — critères : ' + o.criteresReussite : ''}`,
            () => { this.coffre.ajouterObjectif(eleve.identifiantSynapses, { domaine: o.domaine, libelle: o.objectif, statut: 'actif' }); alert('Objectif ajouté.'); }
          )))
        : el('p', { class: 'si-empty' }, ['Aucun.']));

      wrap.appendChild(el('h4', {}, ['Parcours proposé par l\'IA']));
      wrap.appendChild(props.parcoursPropose.length
        ? el('ol', {}, props.parcoursPropose
            .slice().sort((a, b) => (a.ordre || 0) - (b.ordre || 0))
            .map((p) => el('li', {}, [`[${p.domaine}] ${p.objectif}${p.pourquoiCetOrdre ? ' — ' + p.pourquoiCetOrdre : ''}`])))
        : el('p', { class: 'si-empty' }, ['Aucun.']));

      wrap.appendChild(el('h4', {}, ['Équivalence scolaire proposée']));
      const eq = props.equivalenceScolaire || {};
      const rendreApercu = (d) => d
        ? (d.niveauEquivalent ? `Niveau équivalent : ${d.niveauEquivalent} — ` : '') + (d.compteRendu || '')
        : null;
      const lignesEquiv = [];
      if (eq.francais) lignesEquiv.push({ label: '[Français] ' + rendreApercu(eq.francais) });
      if (eq.mathematiques) lignesEquiv.push({ label: '[Mathématiques] ' + rendreApercu(eq.mathematiques) });
      if (eq.transversal) lignesEquiv.push({ label: '[Transversal] ' + (eq.transversal.compteRendu || '') });

      wrap.appendChild(lignesEquiv.length
        ? el('ul', {}, lignesEquiv.map((l) => el('li', {}, [l.label])))
        : el('p', { class: 'si-empty' }, ['Aucune.']));
      if (lignesEquiv.length) {
        wrap.appendChild(el('button', {
          class: 'si-btn',
          onclick: () => {
            this.coffre.enregistrerEquivalenceScolaire(eleve.identifiantSynapses, eq);
            alert('Équivalence scolaire enregistrée dans l\'onglet dédié.');
          }
        }, ['Retenir cette équivalence scolaire']));
      }

      wrap.appendChild(el('p', { class: 'si-hint' }, [
        'Chaque élément doit être retenu individuellement : rien n\'est ajouté au coffre automatiquement.'
      ]));
      return wrap;
    }
  }

  global.SynapsesGrilleAnalyse = { MoteurAnalyse, GrilleAnalyseUI };
})(window);
