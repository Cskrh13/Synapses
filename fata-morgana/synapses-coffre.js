/**
 * synapses-coffre.js
 * ---------------------------------------------------------------------------
 * Gestion du cycle de vie du coffre Synapses (.synapses) et du modèle de
 * données individuelles confidentielles (voir synthèse projet, §2, §3, §12).
 *
 * Règles de confidentialité STRICTES :
 *  - Les données individuelles ne sont JAMAIS écrites dans localStorage,
 *    dans l'URL, dans des paramètres d'URL, dans des logs console, ou
 *    envoyées à des outils de statistiques/analytics.
 *  - Elles n'existent qu'en mémoire JS (this._data), pour la durée de
 *    la session, et uniquement après déchiffrement explicite par
 *    l'enseignant (mot de passe).
 *  - purger() est la seule façon de faire disparaître ces données ; elle
 *    doit être appelée explicitement par l'utilisateur (bouton dédié)
 *    et idéalement aussi sur fermeture de page (voir coffre.html).
 *  - Le fichier .synapses chiffré (via synapses-crypto.js) est le SEUL
 *    support persistant autorisé pour ces données.
 *
 * Tout module métier (suivi-individuel.js, grille-analyse.js,
 * parcours-eleve.js, injection dans sequences.html, etc.) doit passer
 * par l'instance de Coffre exposée ici plutôt que de manipuler des
 * données élève directement.
 *
 * Dépend de synapses-crypto.js, qui doit être chargé avant ce fichier.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  if (!global.SynapsesCrypto) {
    throw new Error('synapses-coffre.js nécessite synapses-crypto.js (à charger avant ce script).');
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /**
   * @param {string} [nomEtablissement] - libre, jamais transmis à une IA (voir grille-analyse.js)
   * @param {string} [dispositif] - type de dispositif d'école inclusive (ex: "ULIS école"),
   *   donnée générique (pas d'identité), seule autorisée à être transmise en contexte IA.
   */
  function coffreVide(nomEtablissement, dispositif) {
    return {
      version: 1,
      creeLe: nowIso(),
      modifieLe: nowIso(),
      etablissement: nomEtablissement || '',
      dispositif: dispositif || '',
      // Le référentiel public (programmes, BARRY, S4C, séances...) N'EST
      // JAMAIS recopié ici : seules les données propres à l'élève y figurent.
      eleves: []
    };
  }

  /**
   * @param {string} identifiantSynapses
   * @param {object} [identite] - { nom, prenom, dateNaissance, classe, ... } — TOUT nominatif, jamais transmis à une IA.
   * @param {number|null} [age] - donnée stockée uniquement dans le coffre local, pour affichage/
   *   usage interne de l'application. NE JAMAIS transmettre à une IA, même anonymisée par
   *   ailleurs : grille-analyse.js l'exclut explicitement de MoteurAnalyse.anonymiser() (voir
   *   la note dans ce fichier pour le raisonnement RGPD).
   */
  function eleveVide(identifiantSynapses, identite, age) {
    return {
      identifiantSynapses,
      identite: identite || {}, // { nom, prenom, dateNaissance, classe, ... }
      age: (typeof age === 'number' && isFinite(age) && age >= 0) ? Math.round(age) : null,
      parcoursScolaire: {},
      accompagnements: [],
      domainesAnalyse: {
        affectif: {},
        social: {},
        cognitif: {},
        sensorimoteur: {},
        mathematiques: {}, // s'appuie sur S4C (référentiel public)
        francais: {}       // s'appuie sur S4C (référentiel public)
      },
      // Chaîne d'analyse §4 : situation observée -> points d'appui ->
      // difficulté -> hypothèse de besoin -> adaptation -> apprentissage
      // -> objectif -> nouvelle observation -> évaluation de l'efficacité.
      observations: [],
      besoins: [],
      adaptations: [],
      objectifs: [],
      // Parcours longitudinal §9, §11 : chronologie pédagogique, pas une
      // simple fiche de commentaires.
      parcours: { seances: [], observations: [], progres: [], bilans: [] }
    };
  }

  class Coffre {
    constructor() {
      this._data = null;  // état déchiffré, EN MÉMOIRE UNIQUEMENT
      this._ouvert = false;
    }

    get ouvert() {
      return this._ouvert;
    }

    /** Instantané en lecture seule de l'état courant (pour l'UI). */
    get donnees() {
      return this._data;
    }

    /** Crée un nouveau coffre vide en mémoire. Rien n'est écrit sur disque
     *  tant que exporter()/telecharger() n'est pas appelé explicitement.
     *  @param {string} [nomEtablissement]
     *  @param {string} [dispositif] - requis côté UI avant l'appel (voir coffre.html) */
    creer(nomEtablissement, dispositif) {
      this._data = coffreVide(nomEtablissement, dispositif);
      this._ouvert = true;
      return this._data;
    }

    /**
     * Ouvre un coffre à partir d'un fichier .synapses (File/Blob ou
     * ArrayBuffer) et d'un mot de passe.
     */
    async ouvrir(fichier, motDePasse) {
      const buffer = fichier instanceof ArrayBuffer ? fichier : await fichier.arrayBuffer();
      const data = await global.SynapsesCrypto.decryptCoffre(motDePasse, new Uint8Array(buffer));
      this._data = data;
      this._ouvert = true;
      return this._data;
    }

    /** Sérialise et chiffre le coffre courant ; renvoie un Blob prêt à être
     *  téléchargé / enregistré sur une clé USB, etc. */
    async exporter(motDePasse) {
      this._assertOuvert();
      this._data.modifieLe = nowIso();
      const bytes = await global.SynapsesCrypto.encryptCoffre(motDePasse, this._data);
      return new Blob([bytes], { type: 'application/octet-stream' });
    }

    /** Déclenche le téléchargement du coffre chiffré sous forme de .synapses. */
    async telecharger(motDePasse, nomFichier) {
      const blob = await this.exporter(motDePasse);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomFichier || 'coffre.synapses';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Détruit explicitement toutes les données confidentielles en mémoire.
     * À appeler sur clic du bouton "Détruire les données confidentielles"
     * et, par sécurité, sur fermeture/déchargement de la page.
     */
    purger() {
      if (this._data) {
        // Écrasement best-effort des références avant suppression.
        for (const k of Object.keys(this._data)) delete this._data[k];
      }
      this._data = null;
      this._ouvert = false;
    }

    _assertOuvert() {
      if (!this._ouvert || !this._data) {
        throw new Error('Aucun coffre ouvert. Créez ou ouvrez un coffre au préalable.');
      }
    }

    // ------------------------------------------------------------------
    // API métier — point d'entrée unique pour les futurs modules
    // (suivi-individuel.js, grille-analyse.js, parcours-eleve.js, ...)
    // ------------------------------------------------------------------

    listerEleves() {
      this._assertOuvert();
      return this._data.eleves.map((e) => ({
        identifiantSynapses: e.identifiantSynapses,
        identite: e.identite
      }));
    }

    ajouterEleve(identifiantSynapses, identite, age) {
      this._assertOuvert();
      if (this._data.eleves.some((e) => e.identifiantSynapses === identifiantSynapses)) {
        throw new Error('Identifiant Synapses déjà utilisé : ' + identifiantSynapses);
      }
      const e = eleveVide(identifiantSynapses, identite, age);
      this._data.eleves.push(e);
      return e;
    }

    /** Modifie uniquement l'âge (seule donnée d'identité re-modifiable isolément
     *  sans passer par une refonte de l'identité nominative). */
    definirAge(identifiantSynapses, age) {
      const e = this.getEleve(identifiantSynapses);
      e.age = (typeof age === 'number' && isFinite(age) && age >= 0) ? Math.round(age) : null;
      return e;
    }

    getEleve(identifiantSynapses) {
      this._assertOuvert();
      const e = this._data.eleves.find((e) => e.identifiantSynapses === identifiantSynapses);
      if (!e) throw new Error('Élève introuvable : ' + identifiantSynapses);
      return e;
    }

    supprimerEleve(identifiantSynapses) {
      this._assertOuvert();
      const idx = this._data.eleves.findIndex((e) => e.identifiantSynapses === identifiantSynapses);
      if (idx === -1) throw new Error('Élève introuvable : ' + identifiantSynapses);
      this._data.eleves.splice(idx, 1);
    }

    /** Enregistre une observation suivant la chaîne d'analyse (§4, §6). */
    ajouterObservation(identifiantSynapses, observation) {
      const e = this.getEleve(identifiantSynapses);
      const obs = Object.assign(
        {
          date: nowIso(),
          domaine: null,
          competence: null,
          situation: '',
          pointsAppui: [],
          difficulte: '',
          besoin: '',
          adaptationProposee: '',
          adaptationUtilisee: '',
          resultat: '',
          autonomie: null,
          priorite: null
        },
        observation
      );
      e.observations.push(obs);
      return obs;
    }

    ajouterBesoin(identifiantSynapses, besoin) {
      const e = this.getEleve(identifiantSynapses);
      const b = Object.assign({ id: 'B-' + Date.now(), hypothese: '', priorite: null, evolution: [] }, besoin);
      e.besoins.push(b);
      return b;
    }

    ajouterAdaptation(identifiantSynapses, adaptation) {
      const e = this.getEleve(identifiantSynapses);
      const a = Object.assign({ id: 'A-' + Date.now(), libelle: '', proposee: true, utilisee: false, efficacite: null }, adaptation);
      e.adaptations.push(a);
      return a;
    }

    /** Bascule utilisee (true <-> false) pour une adaptation donnée — ex :
     *  clic sur la cellule "Utilisée" dans l'onglet Adaptations. */
    toggleAdaptationUtilisee(identifiantSynapses, adaptationId) {
      const e = this.getEleve(identifiantSynapses);
      const a = e.adaptations.find((x) => x.id === adaptationId);
      if (!a) throw new Error('Adaptation introuvable : ' + adaptationId);
      a.utilisee = !a.utilisee;
      return a;
    }

    /** Les objectifs sont une conséquence de l'analyse (§8) : à créer
     *  seulement après validation explicite de l'enseignant. */
    ajouterObjectif(identifiantSynapses, objectif) {
      const e = this.getEleve(identifiantSynapses);
      const o = Object.assign({ id: 'O-' + Date.now(), libelle: '', statut: 'actif', historique: [] }, objectif);
      e.objectifs.push(o);
      return o;
    }

    ajouterEvenementParcours(identifiantSynapses, type, evenement) {
      const e = this.getEleve(identifiantSynapses);
      const cle = { seance: 'seances', observation: 'observations', progres: 'progres', bilan: 'bilans' }[type];
      if (!cle) throw new Error('Type d\'événement de parcours inconnu : ' + type);
      const ev = Object.assign({ date: nowIso() }, evenement);
      e.parcours[cle].push(ev);
      return ev;
    }
  }

  global.SynapsesCoffre = { Coffre, eleveVide, coffreVide };
})(window);
