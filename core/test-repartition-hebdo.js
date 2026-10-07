/**
 * Synapses 2.0 — core/test-repartition-hebdo.js
 * ============================================================================
 * Non-régression : repartirElevesSemaineAuto (V1) vs RepartitionHebdoManager
 * (V2) sur les mêmes entrées, comparaison du cahier journal produit.
 *
 * Vérifie aussi que les données élèves restent protégées : le journal écrit
 * dans localStorage ne doit contenir aucun nom, prénom, date de naissance ni
 * champ nominatif — uniquement des identifiants ELEVE-xxxx.
 *
 *   node core/test-repartition-hebdo.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RACINE = path.join(__dirname, "..");
const CLE_JOURNAL = "synapses_planning_journal";

function creerEnvironnement() {
  const memoire = new Map();
  const localStorage = {
    getItem: c => (memoire.has(c) ? memoire.get(c) : null),
    setItem: (c, v) => memoire.set(c, String(v)),
    removeItem: c => memoire.delete(c),
    clear: () => memoire.clear()
  };
  const sandbox = { console, localStorage, fetch: () => Promise.reject(new Error("réseau coupé")) };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.document = { addEventListener() {}, createElement: () => ({ style: {} }) };
  vm.createContext(sandbox);
  return sandbox;
}

function charger(sandbox, relatif) {
  vm.runInContext(fs.readFileSync(path.join(RACINE, relatif), "utf8"), sandbox, { filename: relatif });
}

// ---------------------------------------------------------------------------
// Jeu d'essai
// ---------------------------------------------------------------------------
const CONFIG = {
  rentree: "2025-09-01",
  semaines: 2,
  vacances: [],
  joursTravailles: [1, 2, 4],
  classes: [
    { id: "CLS-CE1", nom: "CE1A", niveau: "CE1", dispositifs: ["DISP-ULIS"] },
    { id: "CLS-CM2", nom: "CM2A", niveau: "CM2", dispositifs: [] }
  ],
  dispositifs: [{ id: "DISP-ULIS", nom: "ULIS école", type: "ULIS" }],
  dispositifGroupes: {}
};

const GRILLES = {
  "CLS-CE1": [
    { id: "c1", jour: 1, debut: "08:30", fin: "10:00", type: "seance", domaineCle: "francais", titre: "Français" },
    { id: "c2", jour: 1, debut: "10:00", fin: "10:15", type: "recreation" },
    { id: "c3", jour: 1, debut: "10:15", fin: "11:45", type: "seance", domaineCle: "mathematiques", titre: "Mathématiques" },
    { id: "c4", jour: 1, debut: "13:30", fin: "14:00", type: "seance", domaineCle: "francais", titre: "Lecture" },
    { id: "c5", jour: 2, debut: "08:30", fin: "10:00", type: "seance", domaineCle: "mathematiques", titre: "Calcul" },
    { id: "c6", jour: 4, debut: "08:30", fin: "10:00", type: "seance", domaineCle: "francais", titre: "Écriture" },
    { id: "c7", jour: 4, debut: "15:30", fin: "17:00", type: "seance", domaineCle: "eps", titre: "EPS tardif" }
  ],
  "CLS-CM2": [
    { id: "d1", jour: 1, debut: "08:30", fin: "10:00", type: "seance", domaineCle: "francais", titre: "Français" },
    { id: "d2", jour: 1, debut: "10:15", fin: "11:45", type: "seance", domaineCle: "histoireGeographie", titre: "Histoire" },
    { id: "d3", jour: 2, debut: "08:30", fin: "10:00", type: "seance", domaineCle: "francais", titre: "Production d'écrit" },
    { id: "d4", jour: 4, debut: "08:30", fin: "10:00", type: "seance", domaineCle: "mathematiques", titre: "Géométrie" }
  ],
  "DISP-ULIS": [
    { id: "u1", jour: 1, debut: "10:15", fin: "11:45", type: "seance", domaineCle: "francais", titre: "Regroupement" }
  ]
};

// Données élèves volontairement « riches » : on vérifie ensuite qu'aucun de
// ces champs nominatifs ne ressort dans le journal.
const ELEVES = [
  {
    identifiantSynapses: "ELEVE-0001", nom: "Dupont", prenom: "Camille",
    dateNaissance: "2016-04-12", classe: "CE1A",
    equivalenceScolaire: { francais: { niveauEquivalent: "CP" } },
    besoins: [{ domaine: "lecture" }], objectifs: [{ libelle: "Décoder", statut: "actif" }],
    accompagnements: [{ type: "AESH mutualisée" }],
    planning: [{ jour: 1, debut: "08:30", fin: "10:00", classeId: "CLS-CE1", creneauId: "c1" }]
  },
  {
    identifiantSynapses: "ELEVE-0002", nom: "Martin", prenom: "Ilyes",
    dateNaissance: "2015-11-03", classe: "CE1A",
    equivalenceScolaire: { mathematiques: { niveauEquivalent: "CE1" } },
    besoins: ["calcul mental"], objectifs: [],
    accompagnements: [{ type: "Travail en autonomie" }],
    planning: []
  },
  {
    identifiantSynapses: "ELEVE-0003", nom: "Ba", prenom: "Aminata",
    dateNaissance: "2014-02-20", classe: "CM2A",
    equivalenceScolaire: { francais: { niveauEquivalent: "CE2" } },
    besoins: [{ domaine: "production d'écrit" }], objectifs: [],
    accompagnements: [], planning: []
  },
  {
    identifiantSynapses: "ELEVE-0004", nom: "Rossi", prenom: "Léo",
    dateNaissance: "2015-07-07", classe: "CM2A",
    equivalenceScolaire: {}, besoins: [], objectifs: [],
    accompagnements: [], planning: []
  },
  {
    identifiantSynapses: "ELEVE-0005", nom: "Nguyen", prenom: "Thi",
    dateNaissance: "2016-01-15", classe: "CE1A",
    equivalenceScolaire: { francais: { niveauEquivalent: "CP" } },
    besoins: ["geometrie"], objectifs: [], accompagnements: [], planning: []
  }
];

const AFFECTATIONS = {};

function faireCoffre() {
  return { ouvert: true, listerEleves: () => JSON.parse(JSON.stringify(ELEVES)) };
}

function neutraliser(journal) {
  const copie = JSON.parse(JSON.stringify(journal));
  Object.keys(copie).forEach(iso => {
    (copie[iso].groupes || []).forEach(g => {
      if (typeof g.id === "string" && /^grp_/.test(g.id)) g.id = "grp_ID";
    });
  });
  return copie;
}

function executerV1() {
  const env = creerEnvironnement();
  charger(env, "Programmation/planning-core.js");
  const PC = env.window.PlanningCore;
  if (!PC || typeof PC.repartirElevesSemaineAuto !== "function") {
    throw new Error("PlanningCore.repartirElevesSemaineAuto introuvable");
  }
  const bilan = PC.repartirElevesSemaineAuto(CONFIG, GRILLES, AFFECTATIONS, faireCoffre());
  return { bilan, journal: JSON.parse(env.localStorage.getItem(CLE_JOURNAL)) };
}

function executerV2() {
  const env = creerEnvironnement();
  [
    "core/referentiel-horaire.js",
    "core/calendrier-scolaire.js",
    "core/adapters/local-adapter.js",
    "core/adapters/journal-adapter.js",
    "core/cahier-journal-manager.js",
    "core/repartition-hebdo-manager.js"
  ].forEach(f => charger(env, f));

  const C = env.window.SynapsesCore;
  const manager = new C.RepartitionHebdoManager({
    journalAdapter: new C.JournalAdapter(new C.LocalAdapter())
  });
  const bilan = manager.repartirSemaine(CONFIG, GRILLES, AFFECTATIONS, faireCoffre());
  return { bilan, journal: JSON.parse(env.localStorage.getItem(CLE_JOURNAL)) };
}

// ---------------------------------------------------------------------------
// Contrôle d'étanchéité : aucune donnée nominative ne doit atteindre le journal
// ---------------------------------------------------------------------------
function controlerEtancheite(journal) {
  const brut = JSON.stringify(journal);
  const fuites = [];

  ELEVES.forEach(e => {
    [["nom", e.nom], ["prénom", e.prenom], ["date de naissance", e.dateNaissance]]
      .forEach(([libelle, valeur]) => {
        if (valeur && brut.includes(valeur)) {
          fuites.push(`${libelle} de ${e.identifiantSynapses} ("${valeur}")`);
        }
      });
  });

  // Toute valeur listée dans un champ `eleves` doit être un identifiant.
  Object.keys(journal).forEach(iso => {
    (journal[iso].groupes || []).forEach(g => {
      (g.eleves || []).forEach(v => {
        if (!/^ELEVE-\d+$/.test(String(v))) fuites.push(`valeur non-identifiant : ${JSON.stringify(v)}`);
      });
    });
  });

  return fuites;
}

function principal() {
  const v1 = executerV1();
  const v2 = executerV2();

  const jsonV1 = JSON.stringify(neutraliser(v1.journal), null, 1);
  const jsonV2 = JSON.stringify(neutraliser(v2.journal), null, 1);

  console.log("Bilan V1 :", JSON.stringify(v1.bilan));
  console.log("Bilan V2 :", JSON.stringify(v2.bilan));

  let echecs = 0;

  if (JSON.stringify(v1.bilan) !== JSON.stringify(v2.bilan)) {
    console.error("[ÉCHEC] Les bilans diffèrent."); echecs++;
  } else {
    console.log("[OK] Bilans identiques.");
  }

  if (jsonV1 !== jsonV2) {
    console.error("[ÉCHEC] Les cahiers journaux diffèrent.");
    const l1 = jsonV1.split("\n"), l2 = jsonV2.split("\n");
    for (let i = 0, vus = 0; i < Math.max(l1.length, l2.length) && vus < 20; i++) {
      if (l1[i] !== l2[i]) {
        console.error(`  ligne ${i + 1}\n    V1: ${l1[i]}\n    V2: ${l2[i]}`);
        vus++;
      }
    }
    echecs++;
  } else {
    console.log("[OK] Cahiers journaux strictement identiques.");
  }

  const fuites = controlerEtancheite(v2.journal);
  if (fuites.length) {
    console.error("[ÉCHEC] Fuite de données élèves dans le journal :");
    fuites.forEach(f => console.error("   - " + f));
    echecs++;
  } else {
    console.log("[OK] Aucune donnée nominative dans le journal (identifiants seuls).");
  }

  // Le journal ne dépasse pas 16h30 pour les groupes automatiques.
  const h = s => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
  const tardifs = Object.values(v2.journal).flatMap(j =>
    (j.groupes || []).filter(g => g.repartitionAuto && h(g.fin) > 16 * 60 + 30));
  if (tardifs.length) {
    console.error("[ÉCHEC] " + tardifs.length + " groupe(s) automatique(s) après 16h30."); echecs++;
  } else {
    console.log("[OK] Aucun groupe automatique au-delà de 16h30.");
  }

  // Jamais plus de 3 groupes automatiques sur une même plage.
  const trop = Object.values(v2.journal).some(j => {
    const parPlage = new Map();
    (j.groupes || []).filter(g => g.repartitionAuto && g.profilAuto).forEach(g => {
      const cle = g.debut + "|" + g.fin;
      parPlage.set(cle, (parPlage.get(cle) || 0) + 1);
    });
    return [...parPlage.values()].some(n => n > 3);
  });
  console.log((trop ? "[ÉCHEC]" : "[OK]") + " Maximum 3 groupes automatiques par plage.");
  if (trop) echecs++;

  console.log("\n" + (echecs === 0
    ? "Portage conforme : " + v2.bilan.groupes + " groupes, " + v2.bilan.ajouts + " affectations."
    : echecs + " échec(s)."));
  process.exit(echecs === 0 ? 0 : 1);
}

principal();
