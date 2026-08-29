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
    /** @param {object} referentielGeneral - contenu de grille-analyse-generale.json */
    constructor(referentielGeneral) {
      this.referentiel = referentielGeneral;
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
     *  - puis des suggestions d'objectifs, triées par score décroissant.
     * Chaque étape porte les adaptations associées au besoin d'origine,
     * pour que le parcours reste actionnable (pas seulement une liste
     * d'intitulés).
     * @param {object} [options] - { maxEtapes }
     */
    proposerParcours(eleve, options) {
      options = options || {};
      const maxEtapes = options.maxEtapes || 8;

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
  ]
}`;

      const dispositifTxt = (dispositif || '').trim();
      const intro = dispositifTxt
        ? `Tu es un conseiller pédagogique spécialisé dans l'école inclusive, dans le cadre d'un dispositif de type « ${dispositifTxt} ». Tu analyses des observations totalement anonymisées d'un élève (aucun nom, aucune identité, aucun établissement ni classe ne te sont communiqués et tu ne dois en demander aucun).`
        : `Tu es un conseiller pédagogique spécialisé dans l'école inclusive. Tu analyses des observations totalement anonymisées d'un élève (aucun nom, aucune identité, aucun établissement ni classe ne te sont communiqués et tu ne dois en demander aucun).`;

      return `${intro}

RÈGLES :
- Ne cherche jamais à identifier l'élève, son établissement ou sa classe, ni à demander des informations personnelles.
- Respecte exactement la structure JSON demandée, sans texte avant ou après.
- Appuie-toi sur les observations et les besoins/adaptations déjà compilés pour proposer, en complément (pas en remplacement) : des hypothèses de besoins supplémentaires, des adaptations, des objectifs formulés de façon observable, et un parcours de compétences ordonné.
- Toute proposition reste une suggestion : ne formule rien comme une certitude ou un diagnostic.
- Reste concret et évite les formulations génériques.

DONNÉES ANONYMISÉES DE L'ÉLÈVE :
${JSON.stringify(donnees, null, 2)}

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
      return {
        hypothesesBesoins: Array.isArray(obj.hypothesesBesoins) ? obj.hypothesesBesoins : [],
        adaptationsSuggerees: Array.isArray(obj.adaptationsSuggerees) ? obj.adaptationsSuggerees : [],
        objectifsSuggeres: Array.isArray(obj.objectifsSuggeres) ? obj.objectifsSuggeres : [],
        parcoursPropose: Array.isArray(obj.parcoursPropose) ? obj.parcoursPropose : []
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
     */
    constructor(coffre, referentielGeneral) {
      this.coffre = coffre;
      this.moteur = new MoteurAnalyse(referentielGeneral);
    }

    /** Rend l'onglet "Analyse & IA" pour un élève donné dans un conteneur. */
    render(container, eleve) {
      container.innerHTML = '';
      container.appendChild(this._sectionBesoinsAdaptations(eleve));
      container.appendChild(this._sectionParcours(eleve));
      container.appendChild(this._sectionAtelierIA(eleve, container));
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
          'Aucune clé API, aucun envoi automatique. Copiez le prompt ci-dessous (il précise le type de dispositif mais ne contient ni nom, ni identifiant élève, ni établissement, ni classe), ' +
          'collez-le dans le chat IA gratuit de votre choix, puis collez sa réponse pour l\'examiner — rien n\'est ajouté au coffre sans validation.'
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

      wrap.appendChild(el('p', { class: 'si-hint' }, [
        'Chaque élément doit être retenu individuellement : rien n\'est ajouté au coffre automatiquement.'
      ]));
      return wrap;
    }
  }

  global.SynapsesGrilleAnalyse = { MoteurAnalyse, GrilleAnalyseUI };
})(window);
