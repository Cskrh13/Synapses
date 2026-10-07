/**
 * Synapses 2.0 — core/test-repartition-ulis.js
 * ============================================================================
 * Test de non-régression : exécute genererGroupesBesoinULIS (V1,
 * Programmation/planning-core.js) et RepartitionUlisManager (V2) sur les
 * MÊMES entrées, puis compare octet à octet le cahier journal produit.
 *
 * Les identifiants de groupe (uid) sont neutralisés des deux côtés : ils
 * contiennent Date.now() + Math.random() et ne peuvent pas coïncider.
 *
 *   node core/test-repartition-ulis.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RACINE = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// Faux environnement navigateur (localStorage en mémoire)
// ---------------------------------------------------------------------------
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
  const code = fs.readFileSync(path.join(RACINE, relatif), "utf8");
  vm.runInContext(code, sandbox, { filename: relatif });
}

// ---------------------------------------------------------------------------
// Jeu d'essai — une école à deux classes, cinq élèves ULIS, deux semaines
// ---------------------------------------------------------------------------
const CONFIG = {
  rentree: "2025-09-01",
  semaines: 2,
  vacances: [],
  joursTravailles: [1, 2, 4, 5],
  classes: [
    { id: "CLS-CE1", nom: "CE1A", niveau: "CE1" },
    { id: "CLS-CM2", nom: "CM2A", niveau: "CM2" }
  ],
  dispositifs: []
};

const GRILLES = {
  "CLS-CE1": [
    { jour: 1, debut: "08:30", fin: "10:00" },
    { jour: 1, debut: "10:15", fin: "11:45" },
    { jour: 2, debut: "08:30", fin: "11:45" },
    { jour: 4, debut: "08:30", fin: "10:00" },
    { jour: 5, debut: "13:30", fin: "16:00" }
  ],
  "CLS-CM2": [
    { jour: 1, debut: "08:30", fin: "11:45" },
    { jour: 2, debut: "10:15", fin: "11:45" },
    { jour: 4, debut: "10:15", fin: "11:45" },
    { jour: 5, debut: "08:30", fin: "11:45" }
  ]
};

const ELEVES = [
  {
    identifiantSynapses: "ELEVE-0001", classe: "CE1A",
    equivalenceScolaire: { francais: { niveauEquivalent: "CP" }, mathematiques: { niveauEquivalent: "CP" } },
    besoins: [{ hypothese: "Décodage et fluence en lecture" }],
    objectifs: [{ libelle: "Lire un texte court", statut: "actif" }],
    planning: [{ jour: 1, debut: "08:30", fin: "10:00", classeId: "CLS-CE1" }]
  },
  {
    identifiantSynapses: "ELEVE-0002", classe: "CE1A",
    equivalenceScolaire: { mathematiques: { niveauEquivalent: "CE1" } },
    besoins: ["numération et calcul"],
    objectifs: [{ libelle: "Ancienne cible", statut: "atteint" }],
    planning: []
  },
  {
    identifiantSynapses: "ELEVE-0003", classe: "CM2A",
    equivalenceScolaire: { francais: { niveauEquivalent: "CE2" } },
    besoins: [{ domaine: "Histoire-géographie" }],
    objectifs: [],
    planning: [{ jour: 5, debut: "08:30", fin: "11:45", classeId: "CLS-CM2" }]
  },
  {
    identifiantSynapses: "ELEVE-0004", classe: "Classe externe (IME)",
    equivalenceScolaire: { francais: { niveauEquivalent: "GS" } },
    besoins: [], objectifs: [], planning: []
  },
  {
    identifiantSynapses: "ELEVE-0005", classe: "CM2A",
    equivalenceScolaire: { francais: { niveauEquivalent: "CM1" }, mathematiques: { niveauEquivalent: "CM1" } },
    besoins: ["motricité, EPS"], objectifs: [],
    planning: [{ jour: 4, debut: "13:30", fin: "15:00" }]
  }
];

// Journal préexistant : un groupe fixe (à ne pas écraser), un ancien groupe
// ULIS auto (à écraser), un groupe ULIS auto personnalisé (à conserver).
const JOURNAL_INITIAL = {
  "2025-09-01": {
    date: "2025-09-01", remarque: "", devoirs: "", libellesBlocs: {}, exclusions: [],
    groupes: [
      { id: "grp_fixe", debut: "13:30", fin: "14:30", titre: "Réunion ESS", fixe: true, eleves: [] },
      { id: "grp_vieux", debut: "10:00", fin: "10:15", titre: "ULIS — vieux", profilUlis: true, repartitionAuto: true, personnalise: false, eleves: ["ELEVE-0002"] },
      { id: "grp_perso", debut: "11:45", fin: "12:15", titre: "ULIS — retouché", profilUlis: true, repartitionAuto: true, personnalise: true, eleves: ["ELEVE-0001"] }
    ]
  }
};

const CLE_JOURNAL = "synapses_planning_journal";

function faireCoffre() {
  return {
    ouvert: true,
    listerEleves: () => JSON.parse(JSON.stringify(ELEVES))
  };
}

// Les ids de groupe sont aléatoires : on les neutralise avant comparaison.
function neutraliser(journal) {
  const copie = JSON.parse(JSON.stringify(journal));
  Object.keys(copie).forEach(iso => {
    (copie[iso].groupes || []).forEach(g => {
      if (typeof g.id === "string" && /^grp_/.test(g.id) && g.repartitionAuto) g.id = "grp_ID";
    });
  });
  return copie;
}

// ---------------------------------------------------------------------------
// Exécution V1
// ---------------------------------------------------------------------------
function executerV1() {
  const env = creerEnvironnement();
  env.localStorage.setItem(CLE_JOURNAL, JSON.stringify(JOURNAL_INITIAL));
  charger(env, "Programmation/planning-core.js");
  const PC = env.window.PlanningCore;
  if (!PC || typeof PC.genererGroupesBesoinULIS !== "function") {
    throw new Error("PlanningCore.genererGroupesBesoinULIS introuvable dans planning-core.js");
  }
  const bilan = PC.genererGroupesBesoinULIS(CONFIG, GRILLES, faireCoffre());
  return { bilan, journal: JSON.parse(env.localStorage.getItem(CLE_JOURNAL)) };
}

// ---------------------------------------------------------------------------
// Exécution V2
// ---------------------------------------------------------------------------
function executerV2() {
  const env = creerEnvironnement();
  env.localStorage.setItem(CLE_JOURNAL, JSON.stringify(JOURNAL_INITIAL));
  [
    "core/referentiel-horaire.js",
    "core/calendrier-scolaire.js",
    "core/adapters/local-adapter.js",
    "core/adapters/journal-adapter.js",
    "core/repartition-ulis-manager.js"
  ].forEach(f => charger(env, f));

  const C = env.window.SynapsesCore;
  const manager = new C.RepartitionUlisManager({
    journalAdapter: new C.JournalAdapter(new C.LocalAdapter())
  });
  const bilan = manager.genererGroupesBesoin(CONFIG, GRILLES, faireCoffre());
  return { bilan, journal: JSON.parse(env.localStorage.getItem(CLE_JOURNAL)) };
}

// ---------------------------------------------------------------------------
// Comparaison
// ---------------------------------------------------------------------------
function principal() {
  const v1 = executerV1();
  const v2 = executerV2();

  const jsonV1 = JSON.stringify(neutraliser(v1.journal), null, 1);
  const jsonV2 = JSON.stringify(neutraliser(v2.journal), null, 1);

  const bilanV1 = JSON.stringify(v1.bilan);
  const bilanV2 = JSON.stringify(v2.bilan);

  console.log("Bilan V1 :", bilanV1);
  console.log("Bilan V2 :", bilanV2);

  let echecs = 0;

  if (bilanV1 !== bilanV2) {
    console.error("\n[ÉCHEC] Les bilans diffèrent.");
    echecs++;
  } else {
    console.log("[OK] Bilans identiques (jours, groupes, ajouts, élèves, référentiel).");
  }

  if (jsonV1 !== jsonV2) {
    console.error("\n[ÉCHEC] Les cahiers journaux produits diffèrent.");
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

  // Vérifications de fond, indépendantes de la V1.
  const j0 = v2.journal["2025-09-01"] || { groupes: [] };
  const verifs = [
    ["groupe fixe préservé", j0.groupes.some(g => g.id === "grp_fixe")],
    ["groupe ULIS personnalisé préservé", j0.groupes.some(g => g.id === "grp_perso")],
    ["ancien groupe ULIS auto écrasé", !j0.groupes.some(g => g.id === "grp_vieux")],
    ["au moins un groupe généré", v2.bilan.groupes > 0],
    ["aucun nom d'élève dans le journal",
      !/[A-Za-zÀ-ÿ]+/.test(JSON.stringify(j0.groupes.flatMap(g => g.eleves || []))
        .replace(/ELEVE-\d+/g, ""))],
    ["jamais plus de 3 groupes auto simultanés", (() => {
      const autos = j0.groupes.filter(g => g.repartitionAuto && g.profilUlis);
      const h = s => Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
      return autos.every(a =>
        autos.filter(b => h(b.debut) < h(a.fin) && h(b.fin) > h(a.debut)).length <= 3);
    })()]
  ];

  verifs.forEach(([nom, ok]) => {
    console.log(`${ok ? "[OK]" : "[ÉCHEC]"} ${nom}`);
    if (!ok) echecs++;
  });

  console.log("\n" + (echecs === 0
    ? "Portage conforme : " + v2.bilan.groupes + " groupes sur " + v2.bilan.jours + " jours."
    : echecs + " échec(s)."));
  process.exit(echecs === 0 ? 0 : 1);
}

principal();
