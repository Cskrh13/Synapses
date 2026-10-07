/**
 * Synapses 2.0 — core/cahier-journal-manager.js
 * ============================================================================
 * Portage fidèle de genererJournalDepuisGrille, regrouperParBloc, cleBloc,
 * cleCreneau et TYPES_CRENEAU (planning-core.js).
 *
 * Extrait en classe propre parce que repartirElevesSemaineAuto en dépend
 * directement : le cahier journal d'une journée est reconstruit à partir des
 * grilles avant toute répartition.
 *
 * RGPD — ce manager ne lit JAMAIS le coffre de lui-même. Le paramètre
 * `coffre` est optionnel ; s'il est absent (cas de la répartition
 * hebdomadaire, qui ne le passe pas), aucune liste d'élèves n'est construite
 * et les groupes sortent vides. Quand il est fourni, seuls des
 * identifiants Synapses (ELEVE-xxxx) sont écrits dans le journal.
 *
 * Dépendances : core/referentiel-horaire.js, core/calendrier-scolaire.js,
 *               core/adapters/local-adapter.js, core/adapters/journal-adapter.js
 */
(function (global) {
  "use strict";

  const { ReferentielHoraire, CalendrierScolaire, JournalAdapter } = global.SynapsesCore;

  const TYPES_CRENEAU = {
    seance: { label: "Séance", couleur: "#2E5EAA" },
    recreation: { label: "Récréation", couleur: "#B5871E" },
    pause: { label: "Pause méridienne", couleur: "#9A9689" },
    autre: { label: "Autre / rituel", couleur: "#5B5F6B" }
  };

  const PROFILS_DISPOSITIF = {
    enseignant: { suffixe: "Enseignant", adulte: { type: "enseignant", nom: "" } },
    aesh: { suffixe: "AESH", adulte: { type: "aesh", nom: "" } },
    autonomie: { suffixe: "Autonome", adulte: null }
  };

  const hm = h => ReferentielHoraire.heureVersMin(h);
  const chevaucheMin = (aD, aF, bD, bF) => aD < bF && bD < aF;

  class CahierJournalManager {
    constructor(options) {
      options = options || {};
      this.journalAdapter = options.journalAdapter || new JournalAdapter();
      this.uid = options.uid || CahierJournalManager.uidParDefaut;
    }

    static get TYPES_CRENEAU() { return TYPES_CRENEAU; }

    static uidParDefaut(prefixe) {
      return prefixe + "_" + Date.now().toString(36) + "_" +
        Math.random().toString(36).slice(2, 8);
    }

    static cleBloc(debut, fin) { return debut + "|" + fin; }

    static cleCreneau(dateStr, creneauId) { return dateStr + "__" + creneauId; }

    /** Regroupe les groupes d'un jour par plage horaire, triés par heure. */
    static regrouperParBloc(jourJournal) {
      const parCle = new Map();
      jourJournal.groupes.forEach(g => {
        const cle = CahierJournalManager.cleBloc(g.debut, g.fin);
        if (!parCle.has(cle)) parCle.set(cle, { debut: g.debut, fin: g.fin, cle: cle, groupes: [] });
        parCle.get(cle).groupes.push(g);
      });
      return Array.from(parCle.values()).sort((a, b) => hm(a.debut) - hm(b.debut));
    }

    /**
     * Reconstruit la journée `iso` du cahier journal à partir des grilles
     * horaires des classes puis des dispositifs. Sauvegarde et retourne la
     * journée. Comportement identique à la V1, priorité cahier journal
     * comprise (un groupe modifie:true n'est jamais recalculé).
     */
    genererDepuisGrille(iso, config, grilles, affectations, banque, coffre) {
      const journal = this.journalAdapter.charger();
      const jour = this.journalAdapter.pourDate(iso, journal);
      const jourDate = CalendrierScolaire.parseISO(iso);
      const jourSemaine = (jourDate.getDay() + 6) % 7 + 1; // 1 = lundi

      const classes = (config.classes && config.classes.length) ? config.classes : [];
      const parOrigine = new Map();
      jour.groupes.forEach(g => { if (g.origine) parOrigine.set(g.origine, g); });
      const originesVues = new Set();

      this._appliquerClasses({
        jour, classes, grilles, affectations, banque, coffre,
        iso, jourSemaine, parOrigine, originesVues
      });

      this._appliquerDispositifs({
        jour, config, classes, grilles, coffre,
        jourSemaine, parOrigine, originesVues
      });

      // Un groupe synchronisé dont le créneau de grille a disparu, et qui n'a
      // jamais été retouché, est retiré.
      jour.groupes = jour.groupes.filter(
        g => !g.origine || originesVues.has(g.origine) || g.modifie
      );

      this.journalAdapter.sauver(journal);
      return jour;
    }

    /** Identifiants des élèves dont le planning individuel couvre ce créneau de classe. */
    _idsPlanningClasse(coffre, classeId, creneauId) {
      if (!coffre || !coffre.ouvert || typeof coffre.listerEleves !== "function") return [];
      return coffre.listerEleves()
        .filter(e => Array.isArray(e.planning) &&
          e.planning.some(p => p.classeId === classeId && p.creneauId === creneauId))
        .map(e => e.identifiantSynapses)
        .filter(Boolean);
    }

    _appliquerClasses(ctx) {
      const { jour, classes, grilles, affectations, banque, coffre,
        iso, jourSemaine, parOrigine, originesVues } = ctx;

      classes.forEach(classe => {
        const classeId = classe.id;
        const grille = (grilles[classeId] || []).filter(c => c.jour === jourSemaine);

        grille.forEach(c => {
          const origine = classeId + "__" + c.id;
          if (jour.exclusions.indexOf(origine) !== -1) return; // retiré à la main
          originesVues.add(origine);

          const existant = parOrigine.get(origine);
          if (existant && existant.modifie) return; // priorité au cahier journal

          if (c.type !== "seance") {
            const titre = (c.libelle && c.libelle.trim())
              ? c.libelle.trim() : TYPES_CRENEAU[c.type].label;
            if (existant) {
              existant.debut = c.debut; existant.fin = c.fin; existant.titre = titre;
            } else {
              jour.groupes.push({
                id: this.uid("grp"), debut: c.debut, fin: c.fin, origine: origine, modifie: false,
                adulte: null, titre: titre, domaineCle: "", niveau: classe.nom,
                classeId: classeId, seanceRef: null, eleves: [], remarque: "", fixe: true
              });
            }
            return;
          }

          const aff = (affectations[classeId] || {})[CahierJournalManager.cleCreneau(iso, c.id)];
          const bucket = (banque[classe.niveau] && banque[classe.niveau][c.domaineCle]) || null;
          const item = (aff && aff.seanceId && bucket)
            ? bucket.items.find(it => it.id === aff.seanceId) : null;

          // Le nom de la grille est un libellé général, jamais une affectation
          // directe à une séance précise.
          const titre = (item && (item.titre || item.type)) ||
            ((c.titre && c.titre.trim()) ? c.titre.trim() : null) ||
            (bucket ? bucket.label : c.domaineCle);

          const idsPlanning = this._idsPlanningClasse(coffre, classeId, c.id);
          const seanceRef = item
            ? { id: item.id, source: item.source, fichier: item.fichier || null } : null;

          if (existant) {
            existant.debut = c.debut; existant.fin = c.fin; existant.titre = titre;
            existant.domaineCle = c.domaineCle; existant.niveau = classe.nom;
            existant.classeId = classeId; existant.seanceRef = seanceRef;
            existant.eleves = idsPlanning.slice();
          } else {
            jour.groupes.push({
              id: this.uid("grp"), debut: c.debut, fin: c.fin, origine: origine, modifie: false,
              adulte: { type: "enseignant", nom: "" }, titre: titre,
              domaineCle: c.domaineCle, niveau: classe.nom, classeId: classeId,
              seanceRef: seanceRef, eleves: idsPlanning.slice(), remarque: "", fixe: false
            });
          }
        });
      });
    }

    /** Élèves d'un dispositif disponibles sur un créneau (planning individuel). */
    _idsPlanningDispositif(coffre, classesLiees, grilles, jourSemaine, debut, fin) {
      if (!coffre || !coffre.ouvert || typeof coffre.listerEleves !== "function") return [];
      const norm = v => String(v).trim().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();

      return coffre.listerEleves().filter(e => {
        const valeurClasse = e.classe || (e.identite && e.identite.classe) || "";
        const classeRef = classesLiees.find(cl =>
          norm(cl.nom) === norm(valeurClasse) ||
          (cl.niveau && norm(cl.niveau) === norm(valeurClasse)));
        if (!classeRef) return false;

        const plan = Array.isArray(e.planning) ? e.planning : [];
        const planClasse = plan.filter(p => p.classeId === classeRef.id);
        if (planClasse.length) {
          return !planClasse.some(p => Number(p.jour) === Number(jourSemaine) &&
            chevaucheMin(hm(p.debut), hm(p.fin), debut, fin));
        }
        return !(grilles[classeRef.id] || []).some(cx => cx.jour === jourSemaine &&
          chevaucheMin(hm(cx.debut), hm(cx.fin), debut, fin));
      }).map(e => e.identifiantSynapses).filter(Boolean);
    }

    _appliquerDispositifs(ctx) {
      const { jour, config, classes, grilles, coffre,
        jourSemaine, parOrigine, originesVues } = ctx;

      (config.dispositifs || []).forEach(disp => {
        const classesLiees = classes.filter(cl => (cl.dispositifs || []).includes(disp.id));
        if (!classesLiees.length) return;
        const grille = (grilles[disp.id] || []).filter(c => c && c.jour === jourSemaine);

        grille.forEach(c => {
          const origine = disp.id + "__" + c.id;
          if (jour.exclusions.indexOf(origine) !== -1) return;
          originesVues.add(origine);
          const existant = parOrigine.get(origine);
          if (existant && existant.modifie) return;

          // Un créneau déjà réparti en groupes de besoin fait foi : on ne
          // recrée jamais le groupe fusionné par-dessus.
          if (jour.groupes.some(g => g.origine === origine && g.groupeBesoin)) return;

          const debut = hm(c.debut), fin = hm(c.fin);
          const idsPlanning = this._idsPlanningDispositif(
            coffre, classesLiees, grilles, jourSemaine, debut, fin
          );

          const estFixe = c.type !== "seance";
          const titre = estFixe
            ? ((c.libelle && c.libelle.trim()) ? c.libelle.trim()
              : ((TYPES_CRENEAU[c.type] || {}).label || c.type))
            : ((c.titre && c.titre.trim()) ? c.titre.trim() : disp.nom);

          const cleRepartition = disp.id + "::" + jourSemaine + "::" + c.id;
          const repartition = !estFixe ? (config.dispositifGroupes || {})[cleRepartition] : null;
          const profilsRepartis = repartition
            ? Object.keys(PROFILS_DISPOSITIF)
              .filter(k => Array.isArray(repartition[k]) && repartition[k].length)
            : [];

          if (profilsRepartis.length) {
            if (this._appliquerRepartitionDispositif({
              jour, disp, c, origine, titre, repartition, idsPlanning
            })) return;
            return;
          }

          // Aucune répartition enregistrée : on retire les groupes de
          // répartition obsolètes jamais retouchés, puis groupe fusionné.
          jour.groupes = jour.groupes.filter(
            g => !(g.origine === origine && g.profilRepartitionDisp && !g.modifie)
          );
          const groupeFusion = jour.groupes.find(g => g.origine === origine);

          if (groupeFusion) {
            groupeFusion.debut = c.debut; groupeFusion.fin = c.fin; groupeFusion.titre = titre;
            groupeFusion.domaineCle = c.domaineCle || ""; groupeFusion.niveau = "";
            groupeFusion.classeId = ""; groupeFusion.dispositifId = disp.id;
            groupeFusion.dispositifType = disp.type || "ULIS";
            groupeFusion.eleves = idsPlanning.slice(); groupeFusion.fixe = estFixe;
          } else {
            jour.groupes.push({
              id: this.uid("grp"), debut: c.debut, fin: c.fin, origine, modifie: false,
              adulte: estFixe ? null : { type: "enseignant", nom: "" },
              titre, domaineCle: c.domaineCle || "", niveau: "", classeId: "",
              dispositifId: disp.id, dispositifType: disp.type || "ULIS", seanceRef: null,
              eleves: idsPlanning.slice(), remarque: "", fixe: estFixe
            });
          }
        });
      });
    }

    /**
     * Applique la répartition Enseignant / AESH / Autonomie enregistrée pour
     * un créneau de dispositif. Retourne toujours true : la répartition fait
     * foi, aucun groupe fusionné n'est ajouté en plus.
     */
    _appliquerRepartitionDispositif(ctx) {
      const { jour, disp, c, origine, titre, repartition, idsPlanning } = ctx;

      // L'ancien groupe fusionné ne doit jamais coexister avec les groupes de
      // répartition — sauf s'il a été retouché à la main : ce choix prime.
      const groupeFusion = jour.groupes.find(
        g => g.origine === origine && !g.profilRepartitionDisp && !g.groupeBesoin
      );
      if (groupeFusion) {
        if (groupeFusion.modifie) return true;
        jour.groupes = jour.groupes.filter(g => g !== groupeFusion);
      }

      const dispoIds = new Set(idsPlanning);

      Object.keys(PROFILS_DISPOSITIF).forEach(profil => {
        const ids = (Array.isArray(repartition[profil]) ? repartition[profil] : [])
          .filter(id => dispoIds.has(id));
        const groupeExistant = jour.groupes.find(
          g => g.origine === origine && g.profilRepartitionDisp === profil
        );
        if (groupeExistant && groupeExistant.modifie) return; // retouché à la main

        if (!ids.length) {
          if (groupeExistant) jour.groupes = jour.groupes.filter(g => g !== groupeExistant);
          return;
        }

        if (groupeExistant) {
          groupeExistant.debut = c.debut; groupeExistant.fin = c.fin;
          groupeExistant.titre = titre + " — " + PROFILS_DISPOSITIF[profil].suffixe;
          groupeExistant.domaineCle = c.domaineCle || "";
          groupeExistant.eleves = ids;
        } else {
          jour.groupes.push({
            id: this.uid("grp"), debut: c.debut, fin: c.fin, origine, modifie: false,
            adulte: PROFILS_DISPOSITIF[profil].adulte,
            titre: titre + " — " + PROFILS_DISPOSITIF[profil].suffixe,
            domaineCle: c.domaineCle || "", niveau: "", classeId: "",
            dispositifId: disp.id, dispositifType: disp.type || "ULIS", seanceRef: null,
            eleves: ids, remarque: "", fixe: false,
            repartitionAuto: true, profilRepartitionDisp: profil
          });
        }
      });

      return true;
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.CahierJournalManager = CahierJournalManager;
})(typeof window !== "undefined" ? window : globalThis);
