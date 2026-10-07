/**
 * Synapses 2.0 — core/test-affectation-manager.js
 * ============================================================================
 * AffectationManager consolide une règle qui n'existait nulle part sous
 * cette forme en V1 (voir l'en-tête du fichier) : il n'y a donc rien à
 * comparer à l'identique. Ce test est un test de SPÉCIFICATION : chaque
 * branche de la règle PEC -> classe -> dispositif est vérifiée séparément,
 * plus une vérification croisée avec estEleveExcluCreneau/
 * definirPresenceEleveCreneau de la V1 pour la partie qui, elle, existait
 * déjà (le registre d'exclusions opt-out).
 *
 *   node core/test-affectation-manager.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RACINE = path.join(__dirname, "..");

function creerEnvironnement() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function charger(sandbox, relatif) {
  vm.runInContext(fs.readFileSync(path.join(RACINE, relatif), "utf8"), sandbox, { filename: relatif });
}

const env = creerEnvironnement();
["core/referentiel-horaire.js", "core/affectation-manager.js"].forEach(f => charger(env, f));
const { AffectationManager } = env.window.SynapsesCore;

const CONFIG = {
  classes: [{ id: "CLS-CE1", nom: "CE1A", niveau: "CE1" }]
};
const GRILLES = {
  "CLS-CE1": [
    { id: "c1", jour: 1, debut: "08:30", fin: "10:00" },
    // trou 10:00-10:15 (récréation, pas de créneau de classe)
    { id: "c2", jour: 1, debut: "10:15", fin: "11:45" }
  ]
};

let echecs = 0;
const verifier = (nom, ok) => { console.log((ok ? "[OK] " : "[ÉCHEC] ") + nom); if (!ok) echecs++; };

function eleveDeBase(overrides) {
  return Object.assign({
    identifiantSynapses: "ELEVE-0001",
    classe: "CE1A",
    priseEnChargeExterieure: []
  }, overrides);
}

// --------------------------------------------------------------------------
// 1) PEC prioritaire sur tout, y compris pendant un créneau de classe
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  const eleve = eleveDeBase({
    priseEnChargeExterieure: [{ jour: 1, debut: "08:30", fin: "09:00", actif: true, lieu: "Orthophoniste" }]
  });
  const r = am.resoudreCreneau(eleve, 1, "08:30", "09:00");
  verifier("PEC active pendant un créneau de classe -> \"pec\" (priorité absolue)", r.statut === "pec");
}

// --------------------------------------------------------------------------
// 2) PEC inactive (actif:false) ignorée -> bascule sur la classe
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  const eleve = eleveDeBase({
    priseEnChargeExterieure: [{ jour: 1, debut: "08:30", fin: "09:00", actif: false }]
  });
  const r = am.resoudreCreneau(eleve, 1, "08:30", "09:00");
  verifier("PEC désactivée (actif:false) ignorée -> \"classe\"", r.statut === "classe");
}

// --------------------------------------------------------------------------
// 3) Présent en classe par défaut (aucune exclusion enregistrée)
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  const r = am.resoudreCreneau(eleveDeBase(), 1, "08:30", "10:00");
  verifier("aucune PEC, classe présente, pas exclu -> \"classe\" (comportement par défaut)",
    r.statut === "classe" && r.detail.creneau.id === "c1");
}

// --------------------------------------------------------------------------
// 4) Décoché par l'enseignant sur CE créneau précis -> dispositif
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  am.definirPresence("CLS-CE1", "c1", "ELEVE-0001", false);
  const r = am.resoudreCreneau(eleveDeBase(), 1, "08:30", "10:00");
  verifier("décoché sur ce créneau -> \"dispositif\"", r.statut === "dispositif");

  // Sur l'AUTRE créneau du même jour, il reste présent : l'exclusion est
  // bien scopée au créneau, pas à l'élève entier.
  const r2 = am.resoudreCreneau(eleveDeBase(), 1, "10:15", "11:45");
  verifier("l'exclusion ne déborde pas sur un autre créneau -> \"classe\"", r2.statut === "classe");
}

// --------------------------------------------------------------------------
// 5) Recoché ensuite (present:true) -> redevient présent par défaut
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  am.definirPresence("CLS-CE1", "c1", "ELEVE-0001", false);
  am.definirPresence("CLS-CE1", "c1", "ELEVE-0001", true);
  const r = am.resoudreCreneau(eleveDeBase(), 1, "08:30", "10:00");
  verifier("recoché -> redevient \"classe\"", r.statut === "classe");
  verifier("le registre d'exclusions ne garde pas d'entrée vide résiduelle",
    !("CLS-CE1__c1" in am.exclusions));
}

// --------------------------------------------------------------------------
// 6) Aucun créneau de classe à ce moment (récréation, 10:00-10:15) -> dispositif
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  const r = am.resoudreCreneau(eleveDeBase(), 1, "10:00", "10:15");
  verifier("pas de créneau de classe à ce moment -> \"dispositif\"", r.statut === "dispositif");
}

// --------------------------------------------------------------------------
// 7) Aucune classe de référence connue (nom introuvable dans config.classes)
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  const eleve = eleveDeBase({ classe: "Classe externe (IME)" });
  const r = am.resoudreCreneau(eleve, 1, "08:30", "10:00");
  verifier("classe de référence introuvable -> \"dispositif\"", r.statut === "dispositif");
}

// --------------------------------------------------------------------------
// 8) eligiblesPourDispositif filtre correctement un groupe d'élèves
// --------------------------------------------------------------------------
{
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES });
  am.definirPresence("CLS-CE1", "c1", "ELEVE-0002", false); // décoché
  const eleves = [
    eleveDeBase({ identifiantSynapses: "ELEVE-0001" }),                    // présent en classe
    eleveDeBase({ identifiantSynapses: "ELEVE-0002" }),                    // décoché -> dispositif
    eleveDeBase({ identifiantSynapses: "ELEVE-0003", classe: "Externe" })  // pas de classe -> dispositif
  ];
  const eligibles = am.eligiblesPourDispositif(eleves, 1, "08:30", "10:00").map(e => e.identifiantSynapses);
  verifier("eligiblesPourDispositif renvoie exactement les 2 élèves attendus",
    eligibles.sort().join(",") === "ELEVE-0002,ELEVE-0003");
}

// --------------------------------------------------------------------------
// 9) Vérification croisée avec la sémantique opt-out de la V1
//    (estEleveExcluCreneau / definirPresenceEleveCreneau, planning-core.js)
// --------------------------------------------------------------------------
{
  function estEleveExcluCreneauV1(exclusions, classeId, creneauId, id) {
    const cle = classeId + "__" + creneauId;
    return ((exclusions || {})[cle] || []).includes(id);
  }
  function definirPresenceEleveCreneauV1(exclusions, classeId, creneauId, id, present) {
    const cle = classeId + "__" + creneauId;
    exclusions[cle] = exclusions[cle] || [];
    const idx = exclusions[cle].indexOf(id);
    if (present) {
      if (idx !== -1) exclusions[cle].splice(idx, 1);
      if (!exclusions[cle].length) delete exclusions[cle];
    } else if (idx === -1) exclusions[cle].push(id);
  }

  const exclusionsV1 = {};
  const exclusionsV2 = {};
  const sequence = [
    ["ELEVE-A", false], ["ELEVE-B", false], ["ELEVE-A", true], ["ELEVE-C", false]
  ];
  sequence.forEach(([id, present]) => {
    definirPresenceEleveCreneauV1(exclusionsV1, "CLS-CE1", "c1", id, present);
  });
  const am = new AffectationManager({ config: CONFIG, grilles: GRILLES, exclusions: exclusionsV2 });
  sequence.forEach(([id, present]) => am.definirPresence("CLS-CE1", "c1", id, present));

  verifier("le registre d'exclusions V2 est byte-à-byte identique à la V1 après la même séquence",
    JSON.stringify(exclusionsV1) === JSON.stringify(exclusionsV2));

  ["ELEVE-A", "ELEVE-B", "ELEVE-C"].forEach(id => {
    const v1 = estEleveExcluCreneauV1(exclusionsV1, "CLS-CE1", "c1", id);
    const v2 = am.estExclu("CLS-CE1", "c1", id);
    verifier(`estExclu(${id}) == estEleveExcluCreneau V1 (${v1})`, v1 === v2);
  });
}

console.log("\n" + (echecs === 0 ? "AffectationManager conforme à la spécification." : echecs + " échec(s)."));
process.exit(echecs === 0 ? 0 : 1);
