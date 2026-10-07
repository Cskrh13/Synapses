/**
 * Synapses 2.0 — core/personnel-manager.js
 * ============================================================================
 * Gestion des personnels (enseignants, AESH, ...) et de leurs rattachements
 * à une ou plusieurs classes/dispositifs (demande Vincent, 17/09/2026) :
 * création depuis planning-gestion.html au moment de la création d'une
 * classe ou d'un dispositif, données enregistrées et chiffrées.
 *
 * RGPD — même règle que ProgrammationManager pour les Occurrences (voir
 * l'en-tête de ce fichier) : PersonnelManager ne touche JAMAIS lui-même une
 * donnée nominative. Il ne connaît que des identifiants (P-xxxx) et des
 * rôles (roleIds), lus via DataManager.getProtege("personnels") — la vue du
 * Coffre qui ne renvoie jamais `nom`. Créer, renommer ou consulter le nom
 * d'un personnel reste l'affaire exclusive de l'appelant, qui a le Coffre
 * ouvert (coffre.ajouterPersonnel / coffre.getPersonnel), typiquement
 * coffre.html ou l'onglet Personnels de planning-gestion.html.
 *
 * Ce manager gère en revanche, sans jamais voir de nom :
 *   - la génération de l'identifiant technique d'un nouveau personnel ;
 *   - le rattachement classe/dispositif (plusieurs à la fois, comme demandé) ;
 *   - les requêtes utiles au moteur de répartition (qui intervient sur une
 *     classe/un dispositif donné, qui a tel rôle).
 *
 * Dépendances : model/personnel.js, core/data-manager.js (pour la lecture).
 * Les écritures passent par le Coffre, transmis en paramètre aux méthodes
 * qui en ont besoin — jamais stocké sur l'instance.
 */
(function (global) {
  "use strict";

  const M = global.SynapsesModel;

  function idAleatoire(prefixe) {
    return `${prefixe}-${Math.random().toString(36).slice(2, 11)}`;
  }

  function assertCoffreOuvert(coffre) {
    if (!coffre || !coffre.ouvert) {
      throw new Error("Ouvrez le coffre avant de gérer les personnels.");
    }
  }

  class PersonnelManager {
    /** @param {DataManager} dataManager */
    constructor(dataManager) {
      this.data = dataManager;
      this._personnels = new Map(); // id -> Personnel (public, sans nom)
    }

    /** Charge en mémoire la vue publique des personnels (jamais de nom). */
    async charger() {
      const liste = await this.data.getProtege("personnels");
      this._personnels = new Map(liste.map(p => [p.id, p]));
      return this;
    }

    // ------------------------------------------------------------------
    // Création
    // ------------------------------------------------------------------

    /**
     * Propose un identifiant technique et une fiche publique pour un
     * nouveau personnel. Ne touche PAS le Coffre : c'est à l'appelant de
     * persister le nom en clair, via
     *   coffre.ajouterPersonnel(proposition.id, nom, roleIds)
     * — ce manager ne voit jamais `nom`.
     *
     * @param {string[]} roleIds - ex. ["enseignant"], ["aesh"]
     * @param {string[]} [classeIds]
     * @param {string[]} [dispositifIds]
     * @returns {{id:string, roleIds:string[], classeIds:string[], dispositifIds:string[]}}
     */
    proposerNouveauPersonnel(roleIds, classeIds, dispositifIds) {
      if (!Array.isArray(roleIds) || !roleIds.length) {
        throw new Error("Un personnel doit avoir au moins un rôle (roleIds).");
      }
      return {
        id: idAleatoire("PERS"),
        roleIds: roleIds.slice(),
        classeIds: (classeIds || []).slice(),
        dispositifIds: (dispositifIds || []).slice()
      };
    }

    /**
     * Enregistre en mémoire (cache local) le Personnel public renvoyé une
     * fois que l'appelant a persisté le nom côté Coffre. À appeler juste
     * après coffre.ajouterPersonnel(...), avec la même proposition que
     * proposerNouveauPersonnel() a produite.
     */
    enregistrerLocal(proposition) {
      const p = M.Personnel.depuisCoffre({
        identifiantPersonnel: proposition.id,
        roleIds: proposition.roleIds,
        classeIds: proposition.classeIds,
        dispositifIds: proposition.dispositifIds
      });
      this._personnels.set(p.id, p);
      return p;
    }

    // ------------------------------------------------------------------
    // Rattachement classe / dispositif — peut en rattacher plusieurs à la
    // fois (demande explicite : "affecter un ou plusieurs personnels à une
    // classe/dispositif"). Écrit dans le Coffre (seule source de vérité
    // pour classeIds/dispositifIds d'un personnel), puis met à jour le
    // cache local pour que les lectures suivantes soient cohérentes sans
    // recharger.
    // ------------------------------------------------------------------

    /** @param {string[]} personnelIds */
    rattacherClasse(personnelIds, classeId, coffre) {
      assertCoffreOuvert(coffre);
      return this._appliquerRattachement(
        personnelIds, coffre,
        (id) => coffre.rattacherPersonnelClasse(id, classeId),
        (p) => p.rattacherClasse(classeId)
      );
    }

    retirerClasse(personnelIds, classeId, coffre) {
      assertCoffreOuvert(coffre);
      return this._appliquerRattachement(
        personnelIds, coffre,
        (id) => coffre.retirerPersonnelClasse(id, classeId),
        (p) => p.retirerClasse(classeId)
      );
    }

    /** @param {string[]} personnelIds */
    rattacherDispositif(personnelIds, dispositifId, coffre) {
      assertCoffreOuvert(coffre);
      return this._appliquerRattachement(
        personnelIds, coffre,
        (id) => coffre.rattacherPersonnelDispositif(id, dispositifId),
        (p) => p.rattacherDispositif(dispositifId)
      );
    }

    retirerDispositif(personnelIds, dispositifId, coffre) {
      assertCoffreOuvert(coffre);
      return this._appliquerRattachement(
        personnelIds, coffre,
        (id) => coffre.retirerPersonnelDispositif(id, dispositifId),
        (p) => p.retirerDispositif(dispositifId)
      );
    }

    _appliquerRattachement(personnelIds, coffre, ecrireCoffre, mettreAJourModele) {
      const ids = Array.isArray(personnelIds) ? personnelIds : [personnelIds];
      return ids.map(id => {
        ecrireCoffre(id); // le Coffre est la source de vérité, écrit en premier
        let p = this._personnels.get(id);
        if (!p) {
          // Cache pas encore chargé pour ce personnel : on part d'une
          // fiche minimale plutôt que de forcer un rechargement complet.
          p = new M.Personnel({ id, roleIds: [] });
          this._personnels.set(id, p);
        }
        mettreAJourModele(p);
        return p;
      });
    }

    // ------------------------------------------------------------------
    // Requêtes — utiles au moteur de répartition, sans jamais de nom.
    // ------------------------------------------------------------------

    tous() {
      return Array.from(this._personnels.values());
    }

    get(personnelId) {
      return this._personnels.get(personnelId) || null;
    }

    pourClasse(classeId) {
      return this.tous().filter(p => p.classeIds.includes(classeId));
    }

    pourDispositif(dispositifId) {
      return this.tous().filter(p => p.dispositifIds.includes(dispositifId));
    }

    parRole(roleId) {
      return this.tous().filter(p => p.aleRole(roleId));
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.PersonnelManager = PersonnelManager;
})(typeof window !== "undefined" ? window : globalThis);
