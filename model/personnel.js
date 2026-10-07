/**
 * Synapses 2.0 — model/personnel.js
 * ============================================================================
 * Contrat : identifiant technique + rôle(s) uniquement. AUCUNE donnée
 * nominative dans ce modèle — décision actée le 17/09/2026 (revirement par
 * rapport à la version précédente de ce fichier, qui exposait `nom` en
 * public) : le nom d'un personnel est une donnée personnelle et vit
 * exclusivement dans le Coffre, chiffré, au même titre que l'identité d'un
 * élève.
 *
 * Ce modèle est donc ce que voit le moteur de répartition (planning,
 * grilles, journal) : de quoi savoir QUI (id) fait QUOI (roleIds) sur QUELLE
 * classe/dispositif — jamais QUI en clair. L'affichage du nom, réservé aux
 * écrans du Coffre, passe par DataManager.getProtege("personnel", id).
 *
 * Cohérent avec model/entite.js et le style de model/classe.js /
 * model/dispositif.js.
 */
(function (global) {
  "use strict";
  const { Entite } = global.SynapsesModel;

  class Personnel extends Entite {
    constructor(donnees) {
      super(donnees, ["id", "roleIds"]);
      this.roleIds = donnees.roleIds || [];
      this.classeIds = donnees.classeIds || [];
      this.dispositifIds = donnees.dispositifIds || [];
    }

    static fromJSON(donnees) {
      return new Personnel(donnees);
    }

    /**
     * Construit un Personnel public depuis la vue non-nominative renvoyée
     * par Coffre.listerPersonnels() (identifiantPersonnel, roleIds,
     * classeIds, dispositifIds — jamais `nom`).
     */
    static depuisCoffre(entreeCoffre) {
      return new Personnel({
        id: entreeCoffre.identifiantPersonnel,
        roleIds: entreeCoffre.roleIds || [],
        classeIds: entreeCoffre.classeIds || [],
        dispositifIds: entreeCoffre.dispositifIds || []
      });
    }

    aleRole(roleId) {
      return this.roleIds.includes(roleId);
    }

    rattacherClasse(classeId) {
      if (!this.classeIds.includes(classeId)) this.classeIds.push(classeId);
      return this;
    }

    retirerClasse(classeId) {
      this.classeIds = this.classeIds.filter(id => id !== classeId);
      return this;
    }

    rattacherDispositif(dispositifId) {
      if (!this.dispositifIds.includes(dispositifId)) this.dispositifIds.push(dispositifId);
      return this;
    }

    retirerDispositif(dispositifId) {
      this.dispositifIds = this.dispositifIds.filter(id => id !== dispositifId);
      return this;
    }
  }

  global.SynapsesModel.Personnel = Personnel;
})(typeof window !== "undefined" ? window : globalThis);
