/**
 * Synapses 2.0 — core/planning-paquet-manager.js
 * ============================================================================
 * Export / import SÉCURISÉ du planning complet (fichier .synapses chiffré) :
 * configuration + grilles + affectations + cahier journal.
 *
 * Portage fidèle de exporterPlanningJSON, chiffrerPlanningJSON,
 * dechiffrerPlanningJSON, telechargerPlanningJSON, appliquerPaquetPlanning
 * et lireFichierJSON (planning-core.js). Mêmes paramètres cryptographiques
 * (AES-256-GCM, PBKDF2-SHA-256, 310 000 itérations, sel 16 octets, IV 12
 * octets) : les fichiers déjà exportés restent lisibles, et inversement.
 *
 * RGPD — le paquet peut contenir des identifiants Synapses (ELEVE-xxxx)
 * dans le cahier journal ; jamais d'identité. Le mot de passe n'est ni
 * stocké dans le paquet, ni en localStorage, ni conservé par ce manager.
 *
 * ⚠ Différence volontaire avec la V1 : appliquer() lève une erreur si une
 * écriture locale échoue (stockage plein), au lieu de laisser une
 * importation à moitié appliquée passer pour réussie.
 *
 * Dépendances : ConfigPlanningManager, GrilleManager,
 * AffectationSeanceManager, JournalAdapter, CalendrierScolaire, LocalAdapter.
 */
(function (global) {
  "use strict";

  const ITERATIONS = 310000;

  function b64FromBytes(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  function bytesFromB64(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriverCle(motDePasse, salt) {
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error("Le chiffrement sécurisé n'est pas disponible dans ce navigateur.");
    }
    const enc = new TextEncoder();
    const baseKey = await global.crypto.subtle.importKey(
      "raw", enc.encode(String(motDePasse)), "PBKDF2", false, ["deriveKey"]
    );
    return global.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  class PlanningPaquetManager {
    /**
     * @param {object} [options]
     * @param {LocalAdapter} [options.localAdapter]
     * @param {ConfigPlanningManager} [options.configManager]
     * @param {GrilleManager} [options.grilleManager]
     * @param {AffectationSeanceManager} [options.affectationManager]
     * @param {JournalAdapter} [options.journalAdapter]
     */
    constructor(options) {
      options = options || {};
      const C = global.SynapsesCore;
      this.local = options.localAdapter || new C.LocalAdapter();
      this.config = options.configManager || new C.ConfigPlanningManager({ localAdapter: this.local });
      this.grilles = options.grilleManager || new C.GrilleManager({ localAdapter: this.local });
      this.affectations = options.affectationManager || new C.AffectationSeanceManager({ localAdapter: this.local });
      this.journal = options.journalAdapter || new C.JournalAdapter(this.local);
    }

    /** Lit un fichier choisi par l'utilisateur et le parse en JSON. */
    static lireFichierJSON(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try { resolve(JSON.parse(reader.result)); }
          catch (e) { reject(new Error("Fichier JSON invalide.")); }
        };
        reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
        reader.readAsText(file);
      });
    }

    /** Paquet en clair (version 5). */
    exporter(config, grilles, affectations, journal) {
      return {
        format: "synapses-planning",
        version: 5,
        maj: new Date().toISOString(),
        config: config || {},
        grilles: grilles || {},
        affectations: affectations || {},
        journal: journal || {}
      };
    }

    async chiffrer(paquet, motDePasse) {
      if (!motDePasse) throw new Error("Saisissez un mot de passe pour protéger le planning.");
      const enc = new TextEncoder();
      const salt = global.crypto.getRandomValues(new Uint8Array(16));
      const iv = global.crypto.getRandomValues(new Uint8Array(12));
      const key = await deriverCle(motDePasse, salt);
      const clair = enc.encode(JSON.stringify(paquet));
      const chiffre = await global.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, clair);
      return {
        format: "synapses-planning-secure",
        version: 1,
        algorithme: "AES-256-GCM",
        derivation: "PBKDF2-SHA-256",
        iterations: ITERATIONS,
        salt: b64FromBytes(salt),
        iv: b64FromBytes(iv),
        data: b64FromBytes(new Uint8Array(chiffre))
      };
    }

    async dechiffrer(enveloppe, motDePasse) {
      if (!enveloppe || enveloppe.format !== "synapses-planning-secure") {
        throw new Error("Ce fichier n'est pas un export sécurisé de planning Synapses.");
      }
      if (!motDePasse) throw new Error("Saisissez le mot de passe du planning.");
      try {
        const salt = bytesFromB64(enveloppe.salt);
        const iv = bytesFromB64(enveloppe.iv);
        const chiffre = bytesFromB64(enveloppe.data);
        const key = await deriverCle(motDePasse, salt);
        const clair = await global.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, chiffre);
        const paquet = JSON.parse(new TextDecoder().decode(clair));
        if (!paquet || paquet.format !== "synapses-planning") throw new Error("Contenu de planning invalide.");
        return paquet;
      } catch (e) {
        throw new Error("Mot de passe incorrect ou fichier de planning endommagé.");
      }
    }

    /** Chiffre puis déclenche le téléchargement de synapses-planning-<date>.synapses. */
    async telecharger(config, grilles, affectations, journal, motDePasse) {
      const { CalendrierScolaire } = global.SynapsesCore;
      const paquet = this.exporter(config, grilles, affectations, journal);
      const securise = await this.chiffrer(paquet, motDePasse);
      const blob = new Blob([JSON.stringify(securise, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "synapses-planning-" + CalendrierScolaire.dateISO(new Date()) + ".synapses";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return securise;
    }

    /**
     * Applique un paquet déjà déchiffré au stockage local courant.
     * @returns {string[]} libellés de ce qui a été appliqué
     */
    appliquer(paquet) {
      if (!paquet || paquet.format !== "synapses-planning") {
        throw new Error("Ce fichier ne semble pas être un export de planning Synapses.");
      }
      const applique = [];
      const ecrit = (ok, nom) => {
        if (!ok) throw new Error("Import incomplet : impossible d'enregistrer " + nom + " (stockage local plein ou indisponible).");
      };
      if (paquet.config) { this.config.sauver(paquet.config); applique.push("configuration"); }
      if (paquet.grilles) { this.grilles.sauver(paquet.grilles); applique.push("grilles horaires"); }
      if (paquet.affectations) { ecrit(this.affectations.remplacer(paquet.affectations), "les affectations"); applique.push("affectations"); }
      if (paquet.journal) { ecrit(this.journal.sauver(paquet.journal), "le cahier journal"); applique.push("cahier journal"); }
      return applique;
    }
  }

  global.SynapsesCore = global.SynapsesCore || {};
  global.SynapsesCore.PlanningPaquetManager = PlanningPaquetManager;
})(typeof window !== "undefined" ? window : globalThis);
