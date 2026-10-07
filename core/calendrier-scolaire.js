/**
 * Synapses 2.0 — core/calendrier-scolaire.js
 * ============================================================================
 * Portage fidèle (aucun changement de logique ni de valeur) des utilitaires
 * de date de planning-core.js : JOURS, dateISO, parseISO, addDays,
 * mondayOfWeek, estEnVacances, calculerSemaines.
 *
 * Extraits ici parce que genererGroupesBesoinULIS, repartirElevesAuto et
 * repartirElevesSemaineAuto en dépendent toutes les trois : les porter dans
 * chacune des trois classes aurait dupliqué le calcul du calendrier.
 *
 * Aucune dépendance : classe purement statique, testable hors navigateur.
 */
(function (global) {
  "use strict";

  const JOURS = [
    { n: 1, nom: "Lundi" },
    { n: 2, nom: "Mardi" },
    { n: 3, nom: "Mercredi" },
    { n: 4, nom: "Jeudi" },
    { n: 5, nom: "Vendredi" }
  ];

  const pad2 = n => String(n).padStart(2, "0");

  class CalendrierScolaire {
    static get JOURS() { return JOURS; }

    static dateISO(d) {
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    static parseISO(s) {
      const parts = String(s || "").split("-").map(Number);
      if (parts.length !== 3) return new Date(NaN);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    static addDays(d, n) {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r;
    }

    static mondayOfWeek(d) {
      const r = new Date(d);
      const dow = (r.getDay() + 6) % 7;
      return CalendrierScolaire.addDays(r, -dow);
    }

    /** Une semaine est « en vacances » dès qu'elle chevauche une période. */
    static estEnVacances(lundi, vendredi, vacances) {
      return (vacances || []).some(v => {
        const debut = CalendrierScolaire.parseISO(v.debut);
        const fin = CalendrierScolaire.parseISO(v.fin);
        return lundi <= fin && vendredi >= debut;
      });
    }

    /**
     * Calcule les semaines de classe à partir de la rentrée, du nombre de
     * semaines attendu et des périodes de vacances. Retour identique à
     * planning-core.js : [{ numero, lundi, vendredi }, ...].
     */
    static calculerSemaines(config) {
      const resultat = [];
      if (!config || !config.rentree) return resultat;

      let curseur = CalendrierScolaire.mondayOfWeek(CalendrierScolaire.parseISO(config.rentree));
      const nb = config.semaines || 36;
      let garde = 0;

      while (resultat.length < nb && garde < nb + 30) {
        garde++;
        const lundi = curseur;
        const vendredi = CalendrierScolaire.addDays(curseur, 4);
        if (!CalendrierScolaire.estEnVacances(lundi, vendredi, config.vacances)) {
          resultat.push({ numero: resultat.length + 1, lundi: lundi, vendredi: vendredi });
        }
        curseur = CalendrierScolaire.addDays(curseur, 7);
      }
      return resultat;
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.CalendrierScolaire = CalendrierScolaire;
})(typeof window !== "undefined" ? window : globalThis);
