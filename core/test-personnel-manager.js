/**
 * Synapses 2.0 — core/test-personnel-manager.js
 * ============================================================================
 * Vérifie, sur le Coffre modifié et la chaîne DataManager -> PersonnelManager :
 *   1) le CRUD personnels du Coffre fonctionne (ajout, lecture, rattachement,
 *      suppression) et persiste dans le fichier chiffré (round-trip
 *      exporter/ouvrir avec synapses-crypto.js) ;
 *   2) listerPersonnels() et DataManager.getProtege("personnels") ne
 *      renvoient JAMAIS le nom — seule getPersonnel()/getProtege("personnel", id)
 *      le fait ;
 *   3) get("personnels") (domaine PUBLIC) est bien refusé ;
 *   4) PersonnelManager rattache plusieurs personnels à la fois à une classe
 *      et à un dispositif sans jamais voir de nom.
 *
 *   node core/test-personnel-manager.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const RACINE = path.join(__dirname, "..");

function creerEnvironnement() {
  const memoire = new Map();
  const localStorage = {
    getItem: c => (memoire.has(c) ? memoire.get(c) : null),
    setItem: (c, v) => memoire.set(c, String(v)),
    removeItem: c => memoire.delete(c),
    clear: () => memoire.clear()
  };
  const sandbox = {
    console, localStorage,
    fetch: () => Promise.reject(new Error("réseau coupé")),
    crypto: { subtle: crypto.webcrypto.subtle, getRandomValues: (a) => crypto.webcrypto.getRandomValues(a) },
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary")
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function charger(sandbox, relatif) {
  vm.runInContext(fs.readFileSync(path.join(RACINE, relatif), "utf8"), sandbox, { filename: relatif });
}

async function principal() {
  const env = creerEnvironnement();
  [
    "fata-morgana/synapses-crypto.js",
    "fata-morgana/synapses-coffre.js",
    "model/entite.js",
    "model/personnel.js",
    "core/adapters/local-adapter.js",
    "core/adapters/coffre-adapter.js",
    "core/adapters/storage-adapter.js",
    "core/data-manager.js",
    "core/personnel-manager.js"
  ].forEach(f => charger(env, f));

  let echecs = 0;
  const verifier = (nom, ok) => {
    console.log((ok ? "[OK] " : "[ÉCHEC] ") + nom);
    if (!ok) echecs++;
  };

  // --------------------------------------------------------------------
  // 1) CRUD Coffre + round-trip chiffré
  // --------------------------------------------------------------------
  const Coffre = env.window.SynapsesCoffre.Coffre;
  const coffre = new Coffre();
  coffre.creer("École de test", "ULIS");

  const pEnseignant = coffre.ajouterPersonnel("PERS-ENS1", "Dupont Camille", ["enseignant"]);
  const pAesh = coffre.ajouterPersonnel("PERS-AESH1", "Martin Ilyes", ["aesh"]);

  verifier("ajouterPersonnel renvoie la fiche avec le nom", pEnseignant.nom === "Dupont Camille");

  coffre.rattacherPersonnelClasse("PERS-ENS1", "CLS-CE1");
  coffre.rattacherPersonnelDispositif("PERS-ENS1", "DISP-ULIS");
  coffre.rattacherPersonnelDispositif("PERS-AESH1", "DISP-ULIS");

  verifier("rattachement classe idempotent (pas de doublon)", (() => {
    coffre.rattacherPersonnelClasse("PERS-ENS1", "CLS-CE1"); // 2e appel, même classe
    return coffre.getPersonnel("PERS-ENS1").classeIds.length === 1;
  })());

  let leve = false;
  try { coffre.ajouterPersonnel("PERS-ENS1", "Doublon", ["enseignant"]); }
  catch (e) { leve = true; }
  verifier("identifiant personnel dupliqué refusé", leve);

  const motDePasse = "test-passphrase-1234";
  const blob = await coffre.exporter(motDePasse);
  const buffer = await blob.arrayBuffer();

  const coffre2 = new Coffre();
  await coffre2.ouvrir(buffer, motDePasse);
  const relu = coffre2.getPersonnel("PERS-ENS1");
  verifier("round-trip chiffré : nom et rattachements préservés",
    relu.nom === "Dupont Camille" &&
    relu.classeIds.includes("CLS-CE1") &&
    relu.dispositifIds.includes("DISP-ULIS"));

  coffre.supprimerPersonnel("PERS-AESH1");
  verifier("suppression personnel", (() => {
    try { coffre.getPersonnel("PERS-AESH1"); return false; }
    catch (e) { return true; }
  })());
  coffre.ajouterPersonnel("PERS-AESH1", "Martin Ilyes", ["aesh"]); // on le recrée pour la suite
  coffre.rattacherPersonnelDispositif("PERS-AESH1", "DISP-ULIS");

  // --------------------------------------------------------------------
  // 2) Étanchéité : listerPersonnels() et le domaine protégé ne donnent jamais le nom
  // --------------------------------------------------------------------
  const vuePublique = coffre.listerPersonnels();
  const brutVuePublique = JSON.stringify(vuePublique);
  verifier("listerPersonnels() ne contient aucun nom",
    !brutVuePublique.includes("Dupont") && !brutVuePublique.includes("Martin") &&
    !vuePublique.some(p => "nom" in p));

  const DataManager = env.window.SynapsesCore.DataManager;
  const dm = new DataManager({ coffreAdapter: new env.window.SynapsesCore.CoffreAdapter(null) });
  // Injecte directement l'instance coffre déchiffrée (CoffreAdapter lit
  // SynapsesCoffre.instance en usage réel ; ici on le simule).
  env.window.SynapsesCoffre.instance = coffre;

  const protege = await dm.getProtege("personnels");
  const brutProtege = JSON.stringify(protege);
  verifier("DataManager.getProtege(\"personnels\") ne contient aucun nom",
    !brutProtege.includes("Dupont") && !brutProtege.includes("Martin"));
  verifier("DataManager.getProtege(\"personnels\") renvoie des instances Personnel",
    protege.every(p => p.constructor.name === "Personnel"));

  const fiche = await dm.getProtege("personnel", "PERS-ENS1");
  verifier("DataManager.getProtege(\"personnel\", id) donne bien le nom (usage coffre.html)",
    fiche.nom === "Dupont Camille");

  let refusParDomainePublic = false;
  try { await dm.get("personnels"); }
  catch (e) { refusParDomainePublic = /protégé/.test(e.message); }
  verifier("DataManager.get(\"personnels\") est refusé (domaine protégé)", refusParDomainePublic);

  // --------------------------------------------------------------------
  // 3) PersonnelManager — rattachement multiple, jamais de nom
  // --------------------------------------------------------------------
  const PersonnelManager = env.window.SynapsesCore.PersonnelManager;
  const pm = new PersonnelManager(dm);
  await pm.charger();

  verifier("PersonnelManager.charger() peuple le cache sans nom",
    pm.tous().length === 2 && !pm.tous().some(p => "nom" in p));

  const proposition = pm.proposerNouveauPersonnel(["aesh"], [], []);
  verifier("proposerNouveauPersonnel ne voit jamais le nom (absent de la proposition)",
    !("nom" in proposition) && Array.isArray(proposition.roleIds));

  coffre.ajouterPersonnel(proposition.id, "Ba Aminata", proposition.roleIds);
  pm.enregistrerLocal(proposition);

  const rattaches = pm.rattacherClasse(["PERS-ENS1", proposition.id], "CLS-CM2", coffre);
  verifier("rattacherClasse traite plusieurs personnels à la fois", rattaches.length === 2);
  verifier("rattachement reflété dans le Coffre (source de vérité)",
    coffre.getPersonnel("PERS-ENS1").classeIds.includes("CLS-CM2") &&
    coffre.getPersonnel(proposition.id).classeIds.includes("CLS-CM2"));
  verifier("rattachement reflété dans le cache local (modèle public)",
    pm.get("PERS-ENS1").classeIds.includes("CLS-CM2"));

  pm.rattacherDispositif([proposition.id], "DISP-ULIS", coffre);
  verifier("pourDispositif retrouve les personnels rattachés",
    pm.pourDispositif("DISP-ULIS").map(p => p.id).sort().join(",") ===
    ["PERS-ENS1", "PERS-AESH1", proposition.id].sort().join(","));

  verifier("parRole filtre correctement", pm.parRole("aesh").length === 2);

  pm.retirerClasse(["PERS-ENS1"], "CLS-CM2", coffre);
  verifier("retirerClasse fonctionne",
    !coffre.getPersonnel("PERS-ENS1").classeIds.includes("CLS-CM2") &&
    !pm.get("PERS-ENS1").classeIds.includes("CLS-CM2"));

  console.log("\n" + (echecs === 0
    ? "Gestion des personnels conforme (CRUD chiffré, étanchéité, rattachement multiple)."
    : echecs + " échec(s)."));
  process.exit(echecs === 0 ? 0 : 1);
}

principal().catch(e => { console.error(e); process.exit(1); });
