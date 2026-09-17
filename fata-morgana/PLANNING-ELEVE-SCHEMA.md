# Architecture des données du planning élève (v2)

Ce document décrit le schéma de données que **Planning — Gestion**
(`planning-gestion.html` / `planning-core.js`) doit produire lorsqu'il
affecte un élève à un créneau, afin que l'emploi du temps individuel de
`coffre.html` puisse afficher correctement, pour chaque case :

1. **OÙ** l'élève doit être (classe / dispositif / prise en charge extérieure) ;
2. **QUOI** — le nom de l'activité travaillée ;
3. **AVEC QUI** — l'adulte de référence sur ce créneau.

Il fait suite à l'implémentation déjà réalisée côté coffre
(`synapses-coffre.js` et `coffre.html`), livrée avec ce document.

---

## 1. Principe général

Une case d'emploi du temps répond toujours aux mêmes 4 questions,
qu'elle vienne d'une affectation classe/dispositif ou d'une prise en
charge extérieure :

| Question    | Champ                                    |
|-------------|-------------------------------------------|
| Quand ?     | `jour`, `debut`, `fin`                     |
| Où ?        | `classeNom` + `typeLieu` (ou `lieu` pour le type externe) |
| Quoi ?      | `activite.nom` (+ `activite.domaineCle` optionnel) |
| Avec qui ?  | `adulteReference.nom` + `adulteReference.role` |

Ce document ne concerne que les affectations **classe/dispositif**
(`eleve.planning[]`), écrites par Planning — Gestion. Les prises en
charge extérieures (`eleve.priseEnChargeExterieure[]`) restent saisies
et gérées uniquement dans `coffre.html` (elles ont déjà été étendues
avec un champ `activite`, voir §4).

---

## 2. Forme canonique d'une entrée `eleve.planning[]`

```jsonc
{
  "id": "AFF-mty2x2aputjs9",     // généré par le Coffre, ne pas fournir en écriture initiale
  "classeId": "CM1A",            // identifiant technique du lieu (classe OU dispositif)
  "classeNom": "CM1 A",          // nom affiché du lieu
  "typeLieu": "classe",          // "classe" | "dispositif"
  "creneauId": "CM1A-lun-9h",    // identifiant technique du créneau dans la grille horaire
  "jour": 1,                     // 1 = lundi … 5 = vendredi
  "debut": "09:00",
  "fin": "10:00",
  "activite": {
    "nom": "Lecture",            // OBLIGATOIRE pour un affichage utile : nom lisible de l'activité
    "domaineCle": "francais::lecture"  // optionnel, clé technique interne (jamais affichée telle quelle)
  },
  "adulteReference": {
    "nom": "Mme Dupont",         // OBLIGATOIRE pour un affichage utile : nom de l'adulte responsable
    "role": "Enseignante titulaire"  // libre : "Enseignante titulaire", "AESH", "Enseignante ULIS"…
  },
  "remarque": "",                // texte libre optionnel, affiché seulement s'il diffère de l'activité
  "dateAffectation": "2026-09-12T07:44:09.698Z"  // généré par le Coffre
}
```

### Champs obligatoires à l'appel de `affecterCreneau`

- `classeId`, `creneauId` — sans eux, l'affectation est refusée (comme
  aujourd'hui).
- `classeNom`, `typeLieu`, `jour`, `debut`, `fin` — recopiés tels quels
  au moment de l'affectation, pour rester lisibles même si la grille de
  la classe change ensuite.
- `activite.nom` et `adulteReference.nom` — **fortement recommandés**.
  Sans eux, la case s'affiche avec « (activité non renseignée) » et
  sans ligne "adulte de référence" dans `coffre.html`. Ce n'est pas
  bloquant techniquement, mais cela vide l'emploi du temps de son
  intérêt principal pour l'enseignant.

---

## 3. API du Coffre à utiliser

Ces méthodes existent déjà dans `synapses-coffre.js` (fichier fourni,
à copier tel quel) :

### `coffre.affecterCreneau(identifiantSynapses, affectation)`

```js
coffre.affecterCreneau('ELEVE-0001', {
  classeId: 'CM1A',
  classeNom: 'CM1 A',
  typeLieu: 'classe',           // ou 'dispositif' pour un dispositif type ULIS
  creneauId: 'CM1A-lun-9h',
  jour: 1,
  debut: '09:00',
  fin: '10:00',
  activite: { nom: 'Lecture', domaineCle: 'francais::lecture' },
  adulteReference: { nom: 'Mme Dupont', role: 'Enseignante titulaire' }
});
```

Renvoie l'entrée créée (avec son `id`), ou `false` si l'élève est déjà
affecté à ce couple `classeId`/`creneauId` (aucun doublon n'est jamais
créé — comportement inchangé).

**Rétrocompatibilité** : l'ancienne forme d'appel (avec `type`,
`titre`, `libelle`, `domaineCle` à plat) reste acceptée et convertie
automatiquement en `activite`/`adulteReference`. Il n'y a donc pas
d'urgence à migrer tout le code de Planning — Gestion d'un coup ; le
plus important est que les **nouveaux** appels utilisent la forme v2
ci-dessus.

### `coffre.modifierAffectationCreneau(identifiantSynapses, id, patch)`

Permet de corriger l'activité, l'adulte de référence ou la remarque
d'une affectation déjà enregistrée, sans la supprimer/recréer :

```js
coffre.modifierAffectationCreneau('ELEVE-0001', aff.id, {
  activite: { nom: 'Numération' },              // fusion partielle : ne touche pas domaineCle
  adulteReference: { role: 'PE remplaçante' }   // fusion partielle : ne touche pas nom
});
```

`id` peut aussi être remplacé par `{ classeId, creneauId }` pour les
entrées héritées qui n'ont pas encore d'`id` (migration douce
automatique à la première modification).

### `coffre.retirerAffectationParId(identifiantSynapses, id)`

Nouvelle méthode, à préférer à `retirerCreneau(classeId, creneauId)`
une fois que Planning — Gestion manipule des `id` d'affectation.
`retirerCreneau` reste disponible et fonctionne à l'identique.

### `SynapsesCoffre.formatCasePourAffichage(entree, origine)`

Fonction utilitaire exportée, qui normalise **n'importe quelle** case
(v1 héritée, v2, ou prise en charge extérieure) en un objet
d'affichage unique :

```js
{ lieuNom, typeLieu, activiteNom, domaineCle, adulteNom, adulteRole, remarque, jour, debut, fin }
```

- `origine` vaut `'externe'` pour une entrée de
  `priseEnChargeExterieure[]`, ou est omis/`'planning'` pour une entrée
  de `planning[]`.
- **Recommandation** : Planning — Gestion devrait utiliser cette même
  fonction partout où il a besoin d'afficher une case (aperçu de
  grille, impression, etc.), plutôt que de réinventer sa propre logique
  de lecture des champs — cela garantit que les deux pages restent
  cohortes visuellement, y compris sur les entrées héritées.

---

## 4. Ce qui NE change PAS

- `eleve.priseEnChargeExterieure[]` garde sa structure actuelle
  (`id`, `jour`, `debut`, `fin`, `intervenant`, `lieu`, `remarque`,
  `actif`), avec un seul ajout : un champ `activite` (string, optionnel)
  pour préciser ce qui est travaillé pendant la prise en charge. Ce
  tableau reste saisi exclusivement dans `coffre.html` — Planning —
  Gestion n'a rien à en faire, sinon exclure ces créneaux des
  affectations automatiques (comportement déjà existant via
  `coffre.priseEnChargeExterieureSurCreneau`).
- Les règles de confidentialité ne changent pas : `planning[]` reste
  écrit **uniquement** dans le coffre de l'élève (jamais dans le
  localStorage du planning, qui ne doit contenir que des données non
  nominatives — classes, grilles horaires génériques).
- Le fait de ne pas fournir `activite`/`adulteReference` ne casse rien
  : l'ancien comportement (case affichée avec juste le nom de la
  classe) reste possible, simplement moins informatif.

---

## 5. Ce qui change côté `planning-gestion.html`

1. Quand une affectation classe/dispositif est créée pour un élève,
   proposer (idéalement dans le même formulaire) deux champs
   supplémentaires :
   - **Activité travaillée** → `activite.nom`
   - **Adulte de référence** (nom + rôle) → `adulteReference.nom` /
     `adulteReference.role`
   Ces deux champs peuvent être pré-remplis intelligemment si
   Planning — Gestion connaît déjà, par exemple, l'enseignant titulaire
   d'une classe ou l'intitulé générique d'un créneau de grille horaire
   — mais ils doivent rester modifiables au moment de l'affectation
   individuelle, car ils peuvent varier d'un élève à l'autre sur un
   même créneau (ex. AESH présente seulement pour certains élèves).
2. Utiliser `typeLieu: 'dispositif'` plutôt que `typeLieu: 'classe'`
   lorsque le lieu affecté est le dispositif ULIS lui-même (et non une
   classe ordinaire) — cela permet à `coffre.html` de distinguer
   visuellement les deux.
3. Réutiliser `SynapsesCoffre.formatCasePourAffichage()` pour tout
   affichage de créneau côté Planning — Gestion (aperçu par classe,
   impression, etc.), plutôt que de lire `libelle`/`titre` directement.

---

## 6. Exemple complet (aller-retour)

```js
// Écriture depuis Planning — Gestion
const aff = coffre.affecterCreneau('ELEVE-0001', {
  classeId: 'ULIS', classeNom: 'ULIS école', typeLieu: 'dispositif',
  creneauId: 'ULIS-mar-10h', jour: 2, debut: '10:00', fin: '11:00',
  activite: { nom: 'Numération', domaineCle: 'mathematiques::numeration' },
  adulteReference: { nom: 'M. Bernard', role: 'Enseignant ULIS' }
});

// Lecture depuis coffre.html (déjà implémenté)
const f = SynapsesCoffre.formatCasePourAffichage(aff);
// f.lieuNom === 'ULIS école'
// f.typeLieu === 'dispositif'
// f.activiteNom === 'Numération'
// f.adulteNom === 'M. Bernard', f.adulteRole === 'Enseignant ULIS'
```

L'emploi du temps individuel de `coffre.html` affiche alors, pour cette
case : le lieu (« ULIS école »), l'activité (« Numération »), l'adulte
de référence (« 👤 M. Bernard — Enseignant ULIS ») et l'horaire
(« 10:00 – 11:00 »).
