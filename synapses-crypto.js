/**
 * synapses-crypto.js
 * ---------------------------------------------------------------------------
 * Chiffrement / déchiffrement du coffre Synapses (.synapses).
 *
 * Principes (voir synthèse projet Synapses, §1-2) :
 *  - Utilise EXCLUSIVEMENT la Web Crypto API native du navigateur
 *    (aucune dépendance externe, aucun code crypto "maison").
 *  - PBKDF2-SHA256 pour dériver une clé à partir du mot de passe.
 *  - AES-256-GCM pour le chiffrement authentifié du contenu.
 *  - Ce module ne connaît rien de la structure des données du coffre :
 *    il chiffre/déchiffre un objet JS quelconque (JSON-sérialisable) et
 *    ne conserve jamais rien en dehors de la portée de ses fonctions.
 *
 * Format binaire du fichier .synapses :
 *   [4 octets] "SYNF" (magic)
 *   [1 octet]  version
 *   [4 octets] nombre d'itérations PBKDF2 (uint32 big-endian)
 *   [16 octets] sel PBKDF2
 *   [12 octets] IV AES-GCM
 *   [N octets]  ciphertext (inclut le tag d'authentification GCM)
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const MAGIC = new Uint8Array([0x53, 0x59, 0x4e, 0x46]); // "SYNF"
  const VERSION = 1;
  const PBKDF2_ITERATIONS = 250000;
  const SALT_LEN = 16;
  const IV_LEN = 12;

  function concatBytes(...arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      out.set(a, offset);
      offset += a.length;
    }
    return out;
  }

  function u32ToBytes(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, false);
    return b;
  }

  function bytesToU32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
  }

  async function deriveKey(password, salt, iterations) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Chiffre un objet JS et renvoie les octets complets d'un fichier .synapses.
   * @param {string} password
   * @param {object} data - contenu du coffre (JSON-sérialisable)
   * @param {object} [options] - { iterations }
   * @returns {Promise<Uint8Array>}
   */
  async function encryptCoffre(password, data, options) {
    options = options || {};
    const iterations = options.iterations || PBKDF2_ITERATIONS;
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(password, salt, iterations);

    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const ciphertext = new Uint8Array(ciphertextBuf);

    return concatBytes(MAGIC, new Uint8Array([VERSION]), u32ToBytes(iterations), salt, iv, ciphertext);
  }

  /**
   * Déchiffre les octets d'un fichier .synapses.
   * @param {string} password
   * @param {Uint8Array|ArrayBuffer} fileBytes
   * @returns {Promise<object>} l'objet JS du coffre
   */
  async function decryptCoffre(password, fileBytes) {
    const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
    const headerLen = MAGIC.length + 1 + 4 + SALT_LEN + IV_LEN;

    if (bytes.length < headerLen) {
      throw new Error('Fichier .synapses invalide ou corrompu.');
    }
    for (let i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) {
        throw new Error("Ce fichier n'est pas un coffre Synapses valide.");
      }
    }

    let offset = MAGIC.length;
    const version = bytes[offset]; offset += 1;
    if (version !== VERSION) {
      throw new Error('Version de coffre .synapses non prise en charge : ' + version);
    }
    const iterations = bytesToU32(bytes, offset); offset += 4;
    const salt = bytes.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
    const iv = bytes.slice(offset, offset + IV_LEN); offset += IV_LEN;
    const ciphertext = bytes.slice(offset);

    const key = await deriveKey(password, salt, iterations);

    let plaintextBuf;
    try {
      plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    } catch (e) {
      throw new Error('Mot de passe incorrect ou fichier corrompu.');
    }

    const json = new TextDecoder().decode(plaintextBuf);
    return JSON.parse(json);
  }

  global.SynapsesCrypto = {
    encryptCoffre,
    decryptCoffre,
    PBKDF2_ITERATIONS
  };
})(window);
