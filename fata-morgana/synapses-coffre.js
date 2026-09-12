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

  /** Identifiant court unique, utilisé pour pouvoir retrouver un élément
   *  précis (observation, événement de parcours...) afin de le modifier ou
   *  le supprimer. Jamais transmis à une IA, purement technique/local. */
  function genId(prefixe) {
    return prefixe + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
   * @param {string|null} [classe] - classe de référence, donnée stockée uniquement dans le
   *   coffre local, pour affichage/usage interne de l'application (même statut que `age`,
   *   même traitement : jamais transmise à une IA, exclue de MoteurAnalyse.anonymiser()).
   *   Idéalement, ne renseigner que les INITIALES de la classe (ex. "CM2A" plutôt que le
   *   libellé complet), afin de réduire encore le caractère identifiant de la donnée.
   */
  function eleveVide(identifiantSynapses, identite, age, classe) {
    return {
      identifiantSynapses,
      identite: identite || {}, // { nom, prenom, dateNaissance, classe, ... }
      age: (typeof age === 'number' && isFinite(age) && age >= 0) ? Math.round(age) : null,
      classe: (typeof classe === 'string' && classe.trim() !== '') ? classe.trim() : null,
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
      // - seances/observations/progres/bilans : journal manuel, saisi librement.
      // - historiqueParcoursPropose : instantanés DATÉS du "parcours de
      //   compétences proposé" (calculé par grille-analyse.js à partir des
      //   besoins/objectifs). Chaque instantané est figé à l'initiative
      //   explicite de l'enseignant (voir suivi-individuel.js) : le calcul en
      //   direct continue d'évoluer normalement à côté, cet historique ne sert
      //   qu'à observer comment la proposition a changé dans le temps — ce
      //   n'est jamais une validation ni une prescription.
      parcours: { seances: [], observations: [], progres: [], bilans: [], historiqueParcoursPropose: [] },
      // Équivalence scolaire §onglet dédié : estimation, par comparaison avec
      // le référentiel public de compétences (S4C/competences.json), d'un
      // niveau moyen équivalent en français et en mathématiques, accompagnée
      // d'un compte rendu de quelques lignes pour chaque discipline ainsi
      // que d'une description transversale (tous domaines confondus, pas
      // seulement disciplinaire). Ces trois comptes rendus sont conservés
      // comme des VARIABLES réutilisables (ex. pour générer d'autres
      // documents/outils plus tard), pas seulement comme un texte affiché.
      // Toujours une SUGGESTION à valider par l'enseignant (voir
      // grille-analyse.js/genererPromptIA + Coffre.enregistrerEquivalenceScolaire) :
      // jamais un diagnostic ni une donnée figée automatiquement.
      equivalenceScolaire: {
        francais: null,      // { niveauEquivalent, compteRendu }
        mathematiques: null, // { niveauEquivalent, compteRendu }
        transversal: null,   // { compteRendu }  — description transversale à tous les domaines
        dateMaj: null,
        historique: []       // instantanés datés successifs, mêmes trois variables
      },
      // Planning individuel (onglet « Affectation » de Planning — Gestion) :
      // créneaux récurrents d'une classe (grille horaire hebdomadaire)
      // auxquels l'élève est manuellement affecté, par ex. pour une
      // inclusion partielle en classe ordinaire. Principe de
      // confidentialité (§2/§12 de la synthèse projet) : cette donnée est
      // propre à l'élève, elle ne doit donc JAMAIS être enregistrée
      // ailleurs que dans son coffre (pas dans le localStorage du
      // planning, qui ne doit contenir que des données non nominatives).
      // Chaque entrée : { classeId, classeNom, creneauId, jour, debut,
      // fin, domaineCle, dateAffectation }.
      planning: [],
      // Prise en charge extérieure (santé) : 3ᵉ possibilité, à côté de la
      // classe de référence et du dispositif ULIS, pour un créneau
      // hebdomadaire récurrent où l'élève est suivi par un intervenant
      // extérieur à l'école (orthophoniste, psychomotricien, CMPP,
      // hôpital de jour...). Purement déclaratif : aucune grille
      // associée (contrairement à une classe/un dispositif), saisi et
      // géré directement dans le coffre (onglet « Emploi du temps »).
      // Sert à l'afficher dans l'emploi du temps individuel et à exclure
      // l'élève des affectations/répartitions automatiques sur ce
      // créneau (planning-gestion.html), pour ne jamais l'y afficher en
      // double. Chaque entrée : { id, jour, debut, fin, intervenant,
      // lieu, remarque, actif }. `actif` permet de suspendre une prise
      // en charge sans perdre son historique.
      priseEnChargeExterieure: []
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

    /**
     * Liste les élèves du coffre pour les modules internes de l'application
     * (Planning, séquences, cartographie…), qui ont besoin des VRAIES
     * données pédagogiques de chaque élève — pas seulement de son identité.
     *
     * Inclut désormais, en plus de l'identité/âge/classe :
     *  - besoins, adaptations, objectifs actifs (chaîne d'analyse §4-8) ;
     *  - equivalenceScolaire.francais/mathematiques (niveau d'équivalence
     *    scolaire disciplinaire, §"Analyse & IA") ;
     *  - accompagnements (ex. AESH) et parcoursScolaire.
     *
     * Ceci reste strictement un instantané EN MÉMOIRE : rien n'est jamais
     * transmis à un serveur ni persisté hors du fichier .synapses (voir §1-2
     * de la synthèse projet). Les identifiants d'élèves utilisés par ces
     * modules restent ELEVE-xxxx ; l'identité nominative (e.identite) n'est
     * là que pour l'affichage local et ne doit pas être envoyée à un moteur
     * IA (voir grille-analyse.js / MoteurAnalyse.anonymiser()).
     */
    listerEleves() {
      this._assertOuvert();
      return this._data.eleves.map((e) => ({
        identifiantSynapses: e.identifiantSynapses,
        identite: e.identite,
        age: e.age,
        classe: e.classe,
        parcoursScolaire: e.parcoursScolaire || {},
        accompagnements: e.accompagnements || [],
        besoins: e.besoins || [],
        adaptations: e.adaptations || [],
        objectifs: e.objectifs || [],
        equivalenceScolaire: e.equivalenceScolaire || { francais: null, mathematiques: null, transversal: null },
        planning: e.planning || [] // compat. coffres antérieurs à ce champ
      }));
    }

    ajouterEleve(identifiantSynapses, identite, age, classe) {
      this._assertOuvert();
      if (this._data.eleves.some((e) => e.identifiantSynapses === identifiantSynapses)) {
        throw new Error('Identifiant Synapses déjà utilisé : ' + identifiantSynapses);
      }
      const e = eleveVide(identifiantSynapses, identite, age, classe);
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

    /** Modifie uniquement la classe de référence (même statut que l'âge : re-modifiable
     *  isolément sans passer par une refonte de l'identité nominative). Idéalement,
     *  ne renseigner que les initiales de la classe. */
    definirClasse(identifiantSynapses, classe) {
      const e = this.getEleve(identifiantSynapses);
      e.classe = (typeof classe === 'string' && classe.trim() !== '') ? classe.trim() : null;
      return e;
    }

    /**
     * Affecte l'élève à un créneau récurrent d'une classe (onglet
     * « Affectation » de Planning — Gestion), par ex. pour une inclusion
     * partielle en classe ordinaire. Conformément au principe de
     * confidentialité (§2/§12 de la synthèse projet), cette donnée
     * individuelle est enregistrée UNIQUEMENT ici, dans le coffre de
     * l'élève — jamais dans le stockage du planning (localStorage), qui
     * ne doit contenir que des données non nominatives (classes, grilles
     * horaires génériques).
     * @param {string} identifiantSynapses
     * @param {object} affectation - { classeId, classeNom, creneauId,
     *   jour, debut, fin, type, titre, libelle, domaineCle }.
     *   jour/debut/fin/type/titre/libelle/domaineCle sont recopiés au
     *   moment de l'affectation, pour rester lisibles même si la grille
     *   de la classe est modifiée par la suite. type/titre/libelle sont
     *   ce qui permet à l'emploi du temps individuel (coffre.html)
     *   d'afficher le nom et le type de chaque séance plutôt que
     *   seulement le domaine (qui peut être partagé par plusieurs
     *   séances distinctes).
     * @returns {boolean} false si l'élève est déjà affecté à ce créneau
     *   (même classeId + creneauId) — aucun doublon n'est jamais créé.
     */
    affecterCreneau(identifiantSynapses, affectation) {
      const e = this.getEleve(identifiantSynapses);
      if (!Array.isArray(e.planning)) e.planning = []; // compat. coffres antérieurs
      const a = affectation || {};
      if (!a.classeId || !a.creneauId) {
        throw new Error('classeId et creneauId sont requis pour affecter un créneau.');
      }
      const dejaPresent = e.planning.some(
        (p) => p.classeId === a.classeId && p.creneauId === a.creneauId
      );
      if (dejaPresent) return false;
      e.planning.push({
        classeId: a.classeId,
        classeNom: a.classeNom || '',
        creneauId: a.creneauId,
        jour: a.jour != null ? Number(a.jour) : null,
        debut: a.debut || '',
        fin: a.fin || '',
        type: a.type || 'seance',
        titre: a.titre || '',
        libelle: a.libelle || '',
        domaineCle: a.domaineCle || '',
        dateAffectation: nowIso()
      });
      return true;
    }

    /** Retire une affectation créneau précédemment enregistrée dans le
     *  coffre de l'élève (même classeId + creneauId). */
    retirerCreneau(identifiantSynapses, classeId, creneauId) {
      const e = this.getEleve(identifiantSynapses);
      if (!Array.isArray(e.planning)) { e.planning = []; return false; }
      const idx = e.planning.findIndex(
        (p) => p.classeId === classeId && p.creneauId === creneauId
      );
      if (idx === -1) return false;
      e.planning.splice(idx, 1);
      return true;
    }

    /** Liste les affectations créneau enregistrées dans le coffre de l'élève. */
    listerAffectationsCreneaux(identifiantSynapses) {
      const e = this.getEleve(identifiantSynapses);
      if (!Array.isArray(e.planning)) e.planning = [];
      return e.planning.slice();
    }

    // ---- Prise en charge extérieure (santé) — 3ᵉ possibilité ----

    ajouterPriseEnChargeExterieure(identifiantSynapses, pec) {
      const e = this.getEleve(identifiantSynapses);
      const p = Object.assign(
        { id: genId('PEC'), jour: null, debut: '', fin: '', intervenant: '', lieu: '', remarque: '', actif: true },
        pec
      );
      e.priseEnChargeExterieure.push(p);
      return p;
    }

    modifierPriseEnChargeExterieure(identifiantSynapses, pecId, patch) {
      const e = this.getEleve(identifiantSynapses);
      const p = e.priseEnChargeExterieure.find((x) => x.id === pecId);
      if (!p) throw new Error('Prise en charge extérieure introuvable : ' + pecId);
      Object.assign(p, patch || {});
      return p;
    }

    supprimerPriseEnChargeExterieure(identifiantSynapses, pecId) {
      const e = this.getEleve(identifiantSynapses);
      const idx = e.priseEnChargeExterieure.findIndex((x) => x.id === pecId);
      if (idx === -1) throw new Error('Prise en charge extérieure introuvable : ' + pecId);
      e.priseEnChargeExterieure.splice(idx, 1);
    }

    listerPriseEnChargeExterieure(identifiantSynapses) {
      const e = this.getEleve(identifiantSynapses);
      return e.priseEnChargeExterieure.slice();
    }

    /** Renvoie la prise en charge extérieure ACTIVE de l'élève qui
     *  chevauche le créneau [jour, debut, fin] donné (ou null). Ne
     *  dépend d'aucun autre script (pas de PC.heureVersMin ici) : coffre.html
     *  n'a pas besoin de charger planning-core.js pour cette vérification,
     *  et planning-gestion.html peut l'utiliser aussi bien que ses propres
     *  fonctions PC.* pour rester cohérent entre les deux pages. */
    priseEnChargeExterieureSurCreneau(identifiantSynapses, jour, debut, fin) {
      const e = this.getEleve(identifiantSynapses);
      const versMin = (h) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim());
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
      };
      const dMin = versMin(debut), fMin = versMin(fin);
      if (dMin == null || fMin == null) return null;
      return e.priseEnChargeExterieure.find((p) => {
        if (p.actif === false) return false;
        if (Number(p.jour) !== Number(jour)) return false;
        const pd = versMin(p.debut), pf = versMin(p.fin);
        if (pd == null || pf == null) return false;
        return pd < fMin && dMin < pf;
      }) || null;
    }

    getEleve(identifiantSynapses) {
      this._assertOuvert();
      const e = this._data.eleves.find((e) => e.identifiantSynapses === identifiantSynapses);
      if (!e) throw new Error('Élève introuvable : ' + identifiantSynapses);
      if (!Array.isArray(e.priseEnChargeExterieure)) e.priseEnChargeExterieure = []; // compat. coffres antérieurs
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
          id: genId('OBS'),
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

    /** Modifie une observation existante (édition manuelle, §6). Fusionne
     *  `patch` sur l'observation trouvée par son id ; ne touche pas aux
     *  champs non fournis. */
    modifierObservation(identifiantSynapses, observationId, patch) {
      const e = this.getEleve(identifiantSynapses);
      const obs = e.observations.find((o) => o.id === observationId);
      if (!obs) throw new Error('Observation introuvable : ' + observationId);
      Object.assign(obs, patch || {});
      return obs;
    }

    supprimerObservation(identifiantSynapses, observationId) {
      const e = this.getEleve(identifiantSynapses);
      const idx = e.observations.findIndex((o) => o.id === observationId);
      if (idx === -1) throw new Error('Observation introuvable : ' + observationId);
      e.observations.splice(idx, 1);
    }

    ajouterBesoin(identifiantSynapses, besoin) {
      const e = this.getEleve(identifiantSynapses);
      const b = Object.assign({ id: genId('B'), hypothese: '', priorite: null, evolution: [] }, besoin);
      e.besoins.push(b);
      return b;
    }

    modifierBesoin(identifiantSynapses, besoinId, patch) {
      const e = this.getEleve(identifiantSynapses);
      const b = e.besoins.find((x) => x.id === besoinId);
      if (!b) throw new Error('Besoin introuvable : ' + besoinId);
      Object.assign(b, patch || {});
      return b;
    }

    supprimerBesoin(identifiantSynapses, besoinId) {
      const e = this.getEleve(identifiantSynapses);
      const idx = e.besoins.findIndex((x) => x.id === besoinId);
      if (idx === -1) throw new Error('Besoin introuvable : ' + besoinId);
      e.besoins.splice(idx, 1);
    }

    ajouterAdaptation(identifiantSynapses, adaptation) {
      const e = this.getEleve(identifiantSynapses);
      const a = Object.assign({ id: genId('A'), libelle: '', proposee: true, utilisee: false, efficacite: null }, adaptation);
      e.adaptations.push(a);
      return a;
    }

    modifierAdaptation(identifiantSynapses, adaptationId, patch) {
      const e = this.getEleve(identifiantSynapses);
      const a = e.adaptations.find((x) => x.id === adaptationId);
      if (!a) throw new Error('Adaptation introuvable : ' + adaptationId);
      Object.assign(a, patch || {});
      return a;
    }

    supprimerAdaptation(identifiantSynapses, adaptationId) {
      const e = this.getEleve(identifiantSynapses);
      const idx = e.adaptations.findIndex((x) => x.id === adaptationId);
      if (idx === -1) throw new Error('Adaptation introuvable : ' + adaptationId);
      e.adaptations.splice(idx, 1);
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
      const o = Object.assign({ id: genId('O'), libelle: '', statut: 'actif', historique: [] }, objectif);
      e.objectifs.push(o);
      return o;
    }

    modifierObjectif(identifiantSynapses, objectifId, patch) {
      const e = this.getEleve(identifiantSynapses);
      const o = e.objectifs.find((x) => x.id === objectifId);
      if (!o) throw new Error('Objectif introuvable : ' + objectifId);
      Object.assign(o, patch || {});
      return o;
    }

    supprimerObjectif(identifiantSynapses, objectifId) {
      const e = this.getEleve(identifiantSynapses);
      const idx = e.objectifs.findIndex((x) => x.id === objectifId);
      if (idx === -1) throw new Error('Objectif introuvable : ' + objectifId);
      e.objectifs.splice(idx, 1);
    }

    _cleParcours(type) {
      const cle = { seance: 'seances', observation: 'observations', progres: 'progres', bilan: 'bilans' }[type];
      if (!cle) throw new Error('Type d\'événement de parcours inconnu : ' + type);
      return cle;
    }

    ajouterEvenementParcours(identifiantSynapses, type, evenement) {
      const e = this.getEleve(identifiantSynapses);
      const cle = this._cleParcours(type);
      const ev = Object.assign({ id: genId('EVT'), date: nowIso() }, evenement);
      e.parcours[cle].push(ev);
      return ev;
    }

    modifierEvenementParcours(identifiantSynapses, type, evenementId, patch) {
      const e = this.getEleve(identifiantSynapses);
      const cle = this._cleParcours(type);
      const ev = e.parcours[cle].find((x) => x.id === evenementId);
      if (!ev) throw new Error('Événement de parcours introuvable : ' + evenementId);
      Object.assign(ev, patch || {});
      return ev;
    }

    supprimerEvenementParcours(identifiantSynapses, type, evenementId) {
      const e = this.getEleve(identifiantSynapses);
      const cle = this._cleParcours(type);
      const idx = e.parcours[cle].findIndex((x) => x.id === evenementId);
      if (idx === -1) throw new Error('Événement de parcours introuvable : ' + evenementId);
      e.parcours[cle].splice(idx, 1);
    }

    /**
     * Enregistre (après validation explicite de l'enseignant, depuis l'onglet
     * "Analyse & IA") l'équivalence scolaire proposée pour un élève : un
     * niveau moyen équivalent en français, un en mathématiques — chacun
     * comparé aux compétences du programme (référentiel public S4C) — et une
     * description transversale à tous les domaines (pas uniquement
     * disciplinaire). Ces trois comptes rendus deviennent des variables
     * réutilisables (eleve.equivalenceScolaire.francais/.mathematiques/.transversal),
     * exploitables plus tard pour produire d'autres outils (export PDF,
     * synthèse, etc.), tout en conservant un historique daté des versions
     * précédentes.
     * @param {string} identifiantSynapses
     * @param {object} equivalence - { francais: {niveauEquivalent, compteRendu},
     *   mathematiques: {niveauEquivalent, compteRendu}, transversal: {compteRendu} }
     */
    enregistrerEquivalenceScolaire(identifiantSynapses, equivalence) {
      const e = this.getEleve(identifiantSynapses);
      if (!e.equivalenceScolaire || typeof e.equivalenceScolaire !== 'object') {
        e.equivalenceScolaire = { francais: null, mathematiques: null, transversal: null, dateMaj: null, historique: [] };
      }
      if (!Array.isArray(e.equivalenceScolaire.historique)) e.equivalenceScolaire.historique = [];

      const francais = equivalence && equivalence.francais
        ? { niveauEquivalent: equivalence.francais.niveauEquivalent || '', compteRendu: equivalence.francais.compteRendu || '' }
        : null;
      const mathematiques = equivalence && equivalence.mathematiques
        ? { niveauEquivalent: equivalence.mathematiques.niveauEquivalent || '', compteRendu: equivalence.mathematiques.compteRendu || '' }
        : null;
      const transversal = equivalence && equivalence.transversal
        ? { compteRendu: equivalence.transversal.compteRendu || '' }
        : null;

      // Conserve la version précédente dans l'historique avant d'écraser.
      if (e.equivalenceScolaire.dateMaj) {
        e.equivalenceScolaire.historique.push({
          date: e.equivalenceScolaire.dateMaj,
          francais: e.equivalenceScolaire.francais,
          mathematiques: e.equivalenceScolaire.mathematiques,
          transversal: e.equivalenceScolaire.transversal
        });
      }

      e.equivalenceScolaire.francais = francais;
      e.equivalenceScolaire.mathematiques = mathematiques;
      e.equivalenceScolaire.transversal = transversal;
      e.equivalenceScolaire.dateMaj = nowIso();

      return e.equivalenceScolaire;
    }

    /**
     * Fige un instantané daté du "parcours de compétences proposé" (calculé par
     * grille-analyse.js) dans l'historique de l'élève. N'a aucun effet sur les
     * besoins/objectifs/adaptations réels : c'est une photo, prise à
     * l'initiative explicite de l'enseignant (bouton dédié dans l'onglet
     * Parcours), qui sert uniquement à observer l'évolution de la proposition
     * dans le temps.
     * @param {string} identifiantSynapses
     * @param {Array} etapes - le résultat de MoteurAnalyse.proposerParcours(eleve)
     *   au moment de l'appel (tableau d'étapes {ordre, domaineNom, objectif, ...}).
     */
    enregistrerParcoursPropose(identifiantSynapses, etapes) {
      const e = this.getEleve(identifiantSynapses);
      // Compat. ascendante : les coffres créés avant l'ajout de ce champ n'ont
      // pas encore cette clé.
      if (!Array.isArray(e.parcours.historiqueParcoursPropose)) {
        e.parcours.historiqueParcoursPropose = [];
      }
      const entree = { date: nowIso(), etapes: Array.isArray(etapes) ? etapes : [] };
      e.parcours.historiqueParcoursPropose.push(entree);
      return entree;
    }
  }

  global.SynapsesCoffre = { Coffre, eleveVide, coffreVide };
})(window);
