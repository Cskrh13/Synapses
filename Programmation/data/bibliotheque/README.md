# Bibliothèque pédagogique Synapses

`indexbibliotheque.json` est l'index de navigation et de chargement.

Chaque fiche de pédagogue se trouve dans `fiches/` et suit le même schéma : métadonnées, courants, concepts, pratiques, influences, ouvrages, `travail`, `culture_recherche`, relations et paramètres de veille.

Les informations de veille sont volontairement séparées du contenu stable. La page `veillepedagogie.html` lit des sources web au chargement ; la validation humaine reste nécessaire avant intégration durable dans les fiches.

## Évolution v1.1

La frise de l'interface a été remplacée par un arbre de filiations pédagogiques, plus lisible. La chronologie reste accessible en déplié. La veille ajoute Réseau Canopé et Cairn.info sur le thème de l'école inclusive, avec une sélection documentaire de repères lorsque les flux automatiques ne sont pas disponibles.


## Extension v1.2

Ajout de 15 fiches, dont 6 femmes : Ellen Key, Pauline Kergomard, Alice Descoeudres, Helen Parkhurst, Élise Freinet et Germaine Tortel. Les nouvelles fiches sont reliées à l’arbre des filiations et distinguent systématiquement travail, culture/recherche et points de vigilance.

## Extension v2 — présentation enrichie, concepts/pratiques définis, podcasts

Chaque fiche (`_schema_version: 2`) ajoute trois éléments par rapport à v1, **sans supprimer aucun champ existant** (rétro-compatible avec tout code qui lit encore `concepts`, `pratiques`, `description`, etc.) :

### 1. `presentation` — portrait enrichi de la personne

```json
"presentation": {
  "chapo": "Phrase de résumé (reprend description_courte).",
  "texte": ["Paragraphe 1…", "Paragraphe 2 (courants)…", "Paragraphe 3 (ouvrages)…", "Paragraphe de mise en garde méthodologique…"],
  "role": "pédagogue | philosophe de l'éducation | psychologue du développement",
  "periode": "1896–1966",
  "reperes": { "periode": "…", "courants": ["…"], "ouvrages_reference": ["…"] }
}
```

Ce texte est généré à partir des données déjà présentes dans la fiche (description, courants, ouvrages) : aucun fait biographique non vérifié n'est ajouté. Pour enrichir davantage un portrait avec des faits précis (dates, événements, citations exactes), modifier directement `presentation.texte` **et sourcer l'ajout** dans `culture_recherche.sources`.

### 2. `concepts_detailles` / `pratiques_detaillees` — définitions

Les champs historiques `concepts` et `pratiques` (listes de chaînes, utilisées pour la recherche/les tags) sont conservés tels quels. Deux nouveaux champs leur associent une définition lisible :

```json
"concepts_detailles": [
  { "id": "tâtonnement-experimental", "terme": "Tâtonnement expérimental", "definition": "…" }
],
"pratiques_detaillees": [
  { "id": "texte-libre", "terme": "Texte libre", "definition": "…" }
]
```

Le dictionnaire de définitions (~90 notions communes à l'ensemble des fiches) vit dans `/home/claude/work/terms.py` au moment de la génération (script `enrich.py`, non versionné dans le dépôt) ; pour corriger ou préciser une définition fiche par fiche, éditer directement `concepts_detailles`/`pratiques_detaillees` dans le JSON concerné.

### 3. `podcasts` — épisodes NotebookLM associés à la fiche

```json
"podcasts": [
  {
    "titre": "Freinet, la pédagogie du travail",
    "description": "2-3 phrases de présentation de l'épisode.",
    "url": "https://notebooklm.google.com/notebook/…",
    "audio_url": "https://…/episode.mp3",
    "duree": "12 min",
    "source": "NotebookLM",
    "date_ajout": "2026-09-08"
  }
]
```

- `url` : lien de partage de l'« Audio Overview » généré dans NotebookLM à partir des sources de la fiche (ouvrages, notes de veille). Affiché comme bouton « Écouter sur NotebookLM ».
- `audio_url` (facultatif) : lien direct vers un fichier audio exporté, pour bénéficier d'un lecteur intégré dans la page.
- La liste est vide par défaut : aucun épisode n'est inventé.

**Flux de travail recommandé pour créer un podcast NotebookLM par pédagogue :**
1. Créer un notebook NotebookLM et y importer les sources de la fiche (ouvrages cités dans `ouvrages`, extraits, notes de `culture_recherche`).
2. Générer un « Audio Overview » (podcast à deux voix).
3. Copier le lien de partage dans `url` (et exporter l'audio vers `audio_url` si un hébergement est disponible).
4. Ajouter l'entrée dans `podcasts` du fichier `fiches/<id>.json`.

**Prévisualisation sans toucher au JSON :** dans `bibliotheque.html`, chaque fiche affiche un formulaire « + Associer un podcast NotebookLM » qui enregistre l'épisode en local (`localStorage`) pour prévisualisation immédiate dans le navigateur, et génère le bloc JSON correspondant à copier dans le fichier de la fiche pour le rendre permanent et visible par tous les utilisateurs.
