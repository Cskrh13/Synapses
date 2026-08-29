/**
 * suivi-individuel.js
 * ---------------------------------------------------------------------------
 * Interface de gestion élève par élève, branchée sur :
 *  - le coffre confidentiel (synapses-coffre.js) pour les données individuelles ;
 *  - le référentiel public de la grille d'analyse ULIS pour les domaines
 *    transversaux (Programmation/data/grille-analyse-generale.json, inspiré
 *    de BARRY) et les domaines disciplinaires (Programmation/data/
 *    competences.json, référentiel des programmes — joue le rôle de S4C).
 *
 * Ce module NE CONNAÎT AUCUNE DONNÉE ÉLÈVE en dehors de ce que le Coffre lui
 * fournit en mémoire. Il ne lit/écrit jamais localStorage, l'URL, ou les
 * référentiels publics comme s'ils étaient des données élève : les deux
 * univers (public / confidentiel) restent strictement séparés (§13 de la
 * synthèse projet).
 *
 * Dépend de synapses-coffre.js (classe Coffre), qui doit être chargé avant.
 * Aucune dépendance externe : DOM natif, fetch natif.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  if (!global.SynapsesCoffre) {
    throw new Error('suivi-individuel.js nécessite synapses-coffre.js (à charger avant ce script).');
  }

  const DOMAINES_TRANSVERSAUX = ['affectif', 'social', 'cognitif', 'sensorimoteur'];
  const DOMAINES_DISCIPLINAIRES = ['mathematiques', 'francais'];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue; // ignore les attributs absents (ex: selected: null)
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function optionsFromList(items, valueKey, labelKey, selected) {
    return items.map((it) =>
      el('option', { value: it[valueKey], selected: it[valueKey] === selected ? 'selected' : null }, [it[labelKey]])
    );
  }

  class SuiviIndividuel {
    /**
     * @param {SynapsesCoffre.Coffre} coffre
     * @param {object} [options]
     * @param {string} [options.urlReferentielGeneral] - chemin vers grille-analyse-generale.json
     * @param {string} [options.urlReferentielDisciplinaire] - chemin vers competences.json
     */
    constructor(coffre, options) {
      options = options || {};
      this.coffre = coffre;
      this.urlReferentielGeneral = options.urlReferentielGeneral || 'Programmation/data/grille-analyse-generale.json';
      this.urlReferentielDisciplinaire = options.urlReferentielDisciplinaire || 'Programmation/data/competences.json';
      this.referentielGeneral = null;       // { domaines: [...] }  — BARRY
      this.referentielDisciplinaire = null; // { domaines: [...], competences: [...] } — S4C
      this.eleveSelectionneId = null;
      this._container = null;
    }

    // ------------------------------------------------------------------
    // Chargement des référentiels PUBLICS (non nominatifs)
    // ------------------------------------------------------------------

    async chargerReferentiels() {
      const [general, disciplinaire] = await Promise.all([
        fetch(this.urlReferentielGeneral, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error('Référentiel grille d\'analyse introuvable : ' + this.urlReferentielGeneral);
          return r.json();
        }),
        fetch(this.urlReferentielDisciplinaire, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error('Référentiel de compétences introuvable : ' + this.urlReferentielDisciplinaire);
          return r.json();
        })
      ]);
      this.referentielGeneral = general;
      this.referentielDisciplinaire = disciplinaire;
      return { general, disciplinaire };
    }

    /** Liste unifiée des domaines (transversaux BARRY + disciplinaires S4C) pour l'UI. */
    domaines() {
      const transversaux = (this.referentielGeneral?.domaines || []).map((d) => ({
        id: d.id, nom: d.nom, source: d.source || 'BARRY', couleur: d.couleur, type: 'transversal'
      }));
      // Regroupe les sous-domaines disciplinaires de competences.json par discipline
      const parDiscipline = {};
      (this.referentielDisciplinaire?.domaines || []).forEach((d) => {
        const discId = d.discipline === 'Mathématiques' ? 'mathematiques' : d.discipline === 'Français' ? 'francais' : null;
        if (!discId) return;
        if (!parDiscipline[discId]) parDiscipline[discId] = { id: discId, nom: d.discipline, source: 'S4C', sousDomaines: [] };
        parDiscipline[discId].sousDomaines.push(d);
      });
      const disciplinaires = Object.values(parDiscipline).map((d) => ({
        id: d.id, nom: d.nom, source: 'S4C', couleur: d.sousDomaines[0]?.couleur, type: 'disciplinaire', sousDomaines: d.sousDomaines
      }));
      return [...transversaux, ...disciplinaires];
    }

    _domaineGeneral(domaineId) {
      return (this.referentielGeneral?.domaines || []).find((d) => d.id === domaineId) || null;
    }

    pointsAppuiGeneriques(domaineId) { return this._domaineGeneral(domaineId)?.pointsAppui || []; }
    difficultesGeneriques(domaineId) { return this._domaineGeneral(domaineId)?.difficultes || []; }
    besoinsGeneriques(domaineId) { return this._domaineGeneral(domaineId)?.besoins || []; }
    adaptationsGeneriques(domaineId) { return this._domaineGeneral(domaineId)?.adaptations || []; }

    /** Compétences disciplinaires (S4C) pour un domaine transversal 'mathematiques'/'francais'. */
    competencesDisciplinaires(domaineId) {
      const discipline = domaineId === 'mathematiques' ? 'Mathématiques' : domaineId === 'francais' ? 'Français' : null;
      if (!discipline) return [];
      return (this.referentielDisciplinaire?.competences || []).filter((c) => c.discipline === discipline);
    }

    // ------------------------------------------------------------------
    // Montage de l'interface dans un conteneur DOM
    // ------------------------------------------------------------------

    async mount(container) {
      this._container = container;
      if (!this.referentielGeneral || !this.referentielDisciplinaire) {
        container.innerHTML = '<p class="si-loading">Chargement de la grille d\'analyse (BARRY / S4C)…</p>';
        try {
          await this.chargerReferentiels();
        } catch (e) {
          container.innerHTML = '';
          container.appendChild(el('div', { class: 'si-error' }, [
            'Impossible de charger le référentiel public : ' + e.message
          ]));
          return;
        }
      }
      this._render();
    }

    refresh() {
      if (this._container) this._render();
    }

    _render() {
      const container = this._container;
      container.innerHTML = '';

      const layout = el('div', { class: 'si-layout' });
      layout.appendChild(this._renderSidebar());
      layout.appendChild(this._renderFiche());
      container.appendChild(layout);
    }

    // ---- Colonne de gauche : liste des élèves ----

    _renderSidebar() {
      const eleves = this.coffre.listerEleves();
      const sidebar = el('div', { class: 'si-sidebar' });

      sidebar.appendChild(el('div', { class: 'si-sidebar-head' }, [
        el('h3', {}, ['Élèves']),
        el('button', { class: 'si-btn si-btn-primary', onclick: () => this._ouvrirFormulaireNouvelEleve() }, ['+ Nouvel élève'])
      ]));

      const liste = el('div', { class: 'si-eleves-liste' },
        eleves.length
          ? eleves.map((e) => this._renderEleveItem(e))
          : [el('p', { class: 'si-empty' }, ['Aucun élève dans ce coffre pour le moment.'])]
      );
      sidebar.appendChild(liste);
      return sidebar;
    }

    _renderEleveItem(e) {
      const identite = [e.identite.prenom, e.identite.nom].filter(Boolean).join(' ') || '(identité non renseignée)';
      const actif = e.identifiantSynapses === this.eleveSelectionneId;
      return el('button', {
        class: 'si-eleve-item' + (actif ? ' active' : ''),
        onclick: () => { this.eleveSelectionneId = e.identifiantSynapses; this._render(); }
      }, [
        el('span', { class: 'si-eleve-id' }, [e.identifiantSynapses]),
        el('span', { class: 'si-eleve-nom' }, [identite])
      ]);
    }

    _ouvrirFormulaireNouvelEleve() {
      const id = prompt('Identifiant Synapses (ex. ELEVE-0042) :');
      if (!id) return;
      const nom = prompt('Nom (optionnel) :') || '';
      const prenom = prompt('Prénom (optionnel) :') || '';
      try {
        this.coffre.ajouterEleve(id.trim(), { nom: nom.trim(), prenom: prenom.trim() });
        this.eleveSelectionneId = id.trim();
        this._render();
      } catch (e) {
        alert(e.message);
      }
    }

    // ---- Colonne de droite : fiche élève ----

    _renderFiche() {
      if (!this.eleveSelectionneId) {
        return el('div', { class: 'si-fiche si-fiche-vide' }, [
          el('p', {}, ['Sélectionnez un élève à gauche, ou créez-en un nouveau.'])
        ]);
      }
      let eleve;
      try {
        eleve = this.coffre.getEleve(this.eleveSelectionneId);
      } catch (e) {
        this.eleveSelectionneId = null;
        return this._renderFiche();
      }

      const fiche = el('div', { class: 'si-fiche' });
      fiche.appendChild(this._renderEnTeteEleve(eleve));
      fiche.appendChild(this._renderOnglets(eleve));
      return fiche;
    }

    _renderEnTeteEleve(eleve) {
      const identite = [eleve.identite.prenom, eleve.identite.nom].filter(Boolean).join(' ');
      return el('div', { class: 'si-fiche-entete' }, [
        el('div', {}, [
          el('div', { class: 'si-fiche-id' }, [eleve.identifiantSynapses]),
          el('h2', { class: 'si-fiche-nom' }, [identite || '(identité non renseignée)'])
        ]),
        el('button', {
          class: 'si-btn si-btn-danger-outline',
          onclick: () => {
            if (confirm('Supprimer définitivement ' + eleve.identifiantSynapses + ' de ce coffre ?')) {
              this.coffre.supprimerEleve(eleve.identifiantSynapses);
              this.eleveSelectionneId = null;
              this._render();
            }
          }
        }, ['Supprimer l\'élève'])
      ]);
    }

    _renderOnglets(eleve) {
      if (!this._ongletActif) this._ongletActif = 'observations';
      const onglets = [
        { id: 'observations', label: 'Observations' },
        { id: 'besoins', label: 'Besoins' },
        { id: 'adaptations', label: 'Adaptations' },
        { id: 'objectifs', label: 'Objectifs' },
        { id: 'parcours', label: 'Parcours' },
        { id: 'analyse', label: 'Analyse & IA' }
      ];

      const nav = el('div', { class: 'si-onglets-nav' }, onglets.map((o) =>
        el('button', {
          class: 'si-onglet' + (this._ongletActif === o.id ? ' active' : ''),
          onclick: () => { this._ongletActif = o.id; this._render(); }
        }, [o.label])
      ));

      let contenu;
      switch (this._ongletActif) {
        case 'observations': contenu = this._renderOngletObservations(eleve); break;
        case 'besoins': contenu = this._renderOngletListeSimple(eleve, 'besoins', ['hypothese', 'priorite']); break;
        case 'adaptations': contenu = this._renderOngletListeSimple(eleve, 'adaptations', ['libelle', 'utilisee', 'efficacite']); break;
        case 'objectifs': contenu = this._renderOngletListeSimple(eleve, 'objectifs', ['libelle', 'statut']); break;
        case 'parcours': contenu = this._renderOngletParcours(eleve); break;
        case 'analyse': contenu = this._renderOngletAnalyse(eleve); break;
        default: contenu = el('div', {}, []);
      }

      return el('div', { class: 'si-onglets' }, [nav, el('div', { class: 'si-onglet-contenu' }, [contenu])]);
    }

    // ---- Onglet Observations : cœur de la chaîne d'analyse (§4, §6) ----

    _renderOngletObservations(eleve) {
      const wrap = el('div', { class: 'si-observations' });
      wrap.appendChild(this._renderFormulaireObservation(eleve));

      const table = el('table', { class: 'si-table' }, [
        el('thead', {}, [el('tr', {}, ['Date', 'Domaine', 'Situation', 'Difficulté', 'Besoin', 'Adaptation'].map((h) => el('th', {}, [h])))]),
        el('tbody', {}, eleve.observations.slice().reverse().map((o) => el('tr', {}, [
          el('td', {}, [new Date(o.date).toLocaleDateString('fr-FR')]),
          el('td', {}, [this._labelDomaine(o.domaine)]),
          el('td', {}, [o.situation || '']),
          el('td', {}, [o.difficulte || '']),
          el('td', {}, [o.besoin || '']),
          el('td', {}, [o.adaptationUtilisee || o.adaptationProposee || ''])
        ])))
      ]);
      wrap.appendChild(table);
      return wrap;
    }

    _labelDomaine(id) {
      const d = this.domaines().find((d) => d.id === id);
      return d ? d.nom : (id || '—');
    }

    _renderFormulaireObservation(eleve) {
      const domaineId = this._domaineFormObs || 'cognitif';
      this._domaineFormObs = domaineId;
      const domaine = this._domaineGeneral(domaineId);
      const estDisciplinaire = DOMAINES_DISCIPLINAIRES.includes(domaineId);

      const selectDomaine = el('select', {
        onchange: (ev) => { this._domaineFormObs = ev.target.value; this._render(); }
      }, this.domaines().map((d) => el('option', { value: d.id, selected: d.id === domaineId ? 'selected' : null }, [d.nom + ' (' + d.source + ')'])));

      const champs = { situation: '', pointsAppui: [], difficulte: '', besoin: '', adaptationProposee: '', competence: null };

      const selectPointsAppui = estDisciplinaire
        ? null
        : el('select', { multiple: true, size: 4, id: 'si-obs-pa' },
            optionsFromList(this.pointsAppuiGeneriques(domaineId), 'id', 'libelle'));

      const selectDifficulte = estDisciplinaire
        ? null
        : el('select', { id: 'si-obs-diff' },
            [el('option', { value: '' }, ['— sélectionner —'])].concat(optionsFromList(this.difficultesGeneriques(domaineId), 'id', 'libelle')));

      const selectBesoin = estDisciplinaire
        ? null
        : el('select', { id: 'si-obs-besoin' },
            [el('option', { value: '' }, ['— sélectionner —'])].concat(optionsFromList(this.besoinsGeneriques(domaineId), 'id', 'libelle')));

      const selectAdaptation = estDisciplinaire
        ? null
        : el('select', { id: 'si-obs-adapt' },
            [el('option', { value: '' }, ['— sélectionner —'])].concat(optionsFromList(this.adaptationsGeneriques(domaineId), 'id', 'libelle')));

      const selectCompetence = estDisciplinaire
        ? el('select', { id: 'si-obs-competence' },
            [el('option', { value: '' }, ['— compétence liée —'])].concat(optionsFromList(this.competencesDisciplinaires(domaineId), 'id', 'intitule')))
        : null;

      const inputSituation = el('input', { type: 'text', id: 'si-obs-situation', placeholder: 'Qu\'observes-tu chez cet élève ?' });
      const inputDifficulteLibre = el('input', { type: 'text', id: 'si-obs-diff-libre', placeholder: estDisciplinaire ? 'Difficulté observée' : 'Ou préciser une difficulté non listée' });
      const inputBesoinLibre = el('input', { type: 'text', id: 'si-obs-besoin-libre', placeholder: estDisciplinaire ? 'Hypothèse de besoin' : 'Ou préciser un besoin non listé' });
      const inputAdaptationLibre = el('input', { type: 'text', id: 'si-obs-adapt-libre', placeholder: estDisciplinaire ? 'Adaptation envisagée' : 'Ou préciser une adaptation non listée' });

      const form = el('div', { class: 'si-form-observation' }, [
        el('div', { class: 'si-form-row' }, [el('label', {}, ['Domaine']), selectDomaine]),
        el('div', { class: 'si-form-row' }, [el('label', {}, ['Situation observée']), inputSituation]),
        !estDisciplinaire ? el('div', { class: 'si-form-row' }, [el('label', {}, ['Points d\'appui (existants)']), selectPointsAppui]) : null,
        el('div', { class: 'si-form-row-pair' }, [
          el('div', {}, [el('label', {}, ['Difficulté']), estDisciplinaire ? null : selectDifficulte, inputDifficulteLibre]),
          el('div', {}, [el('label', {}, ['Hypothèse de besoin']), estDisciplinaire ? null : selectBesoin, inputBesoinLibre])
        ]),
        el('div', { class: 'si-form-row-pair' }, [
          el('div', {}, [el('label', {}, ['Adaptation proposée']), estDisciplinaire ? null : selectAdaptation, inputAdaptationLibre]),
          estDisciplinaire ? el('div', {}, [el('label', {}, ['Compétence liée (S4C)']), selectCompetence]) : el('div', {})
        ]),
        el('button', {
          class: 'si-btn si-btn-primary',
          onclick: () => {
            const pointsAppui = selectPointsAppui ? Array.from(selectPointsAppui.selectedOptions).map((o) => o.value) : [];
            const difficulte = (selectDifficulte && selectDifficulte.value ? this._libelleParId(this.difficultesGeneriques(domaineId), selectDifficulte.value) : '') || inputDifficulteLibre.value.trim();
            const besoin = (selectBesoin && selectBesoin.value ? this._libelleParId(this.besoinsGeneriques(domaineId), selectBesoin.value) : '') || inputBesoinLibre.value.trim();
            const adaptationProposee = (selectAdaptation && selectAdaptation.value ? this._libelleParId(this.adaptationsGeneriques(domaineId), selectAdaptation.value) : '') || inputAdaptationLibre.value.trim();
            const competence = selectCompetence && selectCompetence.value ? selectCompetence.value : null;

            if (!inputSituation.value.trim()) { alert('Décrivez au moins la situation observée.'); return; }

            this.coffre.ajouterObservation(eleve.identifiantSynapses, {
              domaine: domaineId,
              competence,
              situation: inputSituation.value.trim(),
              pointsAppui,
              difficulte,
              besoin,
              adaptationProposee
            });
            this._render();
          }
        }, ['Enregistrer l\'observation'])
      ]);
      return form;
    }

    _libelleParId(liste, id) {
      const item = liste.find((i) => i.id === id);
      return item ? item.libelle : '';
    }

    // ---- Onglets Besoins / Adaptations / Objectifs : listes simples ----

    _renderOngletListeSimple(eleve, cle, colonnes) {
      const wrap = el('div', {});
      const table = el('table', { class: 'si-table' }, [
        el('thead', {}, [el('tr', {}, colonnes.map((c) => el('th', {}, [c])))]),
        el('tbody', {}, (eleve[cle] || []).map((item) => el('tr', {}, colonnes.map((c) => el('td', {}, [String(item[c] ?? '')])))))
      ]);
      const vide = (eleve[cle] || []).length === 0;
      wrap.appendChild(vide ? el('p', { class: 'si-empty' }, ['Rien d\'enregistré pour l\'instant.']) : table);
      wrap.appendChild(el('p', { class: 'si-hint' }, [
        'Les ' + cle + ' se créent le plus souvent depuis une observation (module grille-analyse.js, à venir). ' +
        'Cet onglet affiche l\'état actuel pour ' + eleve.identifiantSynapses + '.'
      ]));
      return wrap;
    }

    _renderOngletParcours(eleve) {
      const evenements = []
        .concat(eleve.parcours.seances.map((e) => ({ ...e, type: 'Séance' })))
        .concat(eleve.parcours.observations.map((e) => ({ ...e, type: 'Observation' })))
        .concat(eleve.parcours.progres.map((e) => ({ ...e, type: 'Progrès' })))
        .concat(eleve.parcours.bilans.map((e) => ({ ...e, type: 'Bilan' })))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (!evenements.length) {
        return el('p', { class: 'si-empty' }, ['Aucun événement de parcours enregistré pour l\'instant.']);
      }

      return el('div', { class: 'si-frise' }, evenements.map((e) =>
        el('div', { class: 'si-frise-item' }, [
          el('div', { class: 'si-frise-date' }, [new Date(e.date).toLocaleDateString('fr-FR')]),
          el('div', { class: 'si-frise-type' }, [e.type]),
          el('div', { class: 'si-frise-detail' }, [e.libelle || e.resume || ''])
        ])
      ));
    }

    // ---- Onglet Analyse & IA : compilation, parcours, atelier IA anonymisé ----
    // (voir grille-analyse.js, à charger avant ce script pour activer l'onglet)

    _renderOngletAnalyse(eleve) {
      if (!global.SynapsesGrilleAnalyse) {
        return el('p', { class: 'si-error' }, [
          'Le moteur d\'analyse (grille-analyse.js) n\'est pas chargé sur cette page.'
        ]);
      }
      if (!this._grilleAnalyseUI) {
        this._grilleAnalyseUI = new global.SynapsesGrilleAnalyse.GrilleAnalyseUI(this.coffre, this.referentielGeneral);
      }
      const wrap = el('div', { class: 'si-analyse' });
      this._grilleAnalyseUI.render(wrap, eleve);
      return wrap;
    }
  }

  global.SynapsesSuiviIndividuel = { SuiviIndividuel };
})(window);
