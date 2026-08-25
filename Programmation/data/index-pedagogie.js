/* SYNAPSES — Programmation/data/index-pedagogie.js
 *
 * Base de concepts et d'idées issue des références pédagogiques.
 * Ce fichier est destiné à être LU PAR UNE IA.
 * Il ne contient pas les prerequis_competences définitifs.
 * Il ne doit pas être chargé par la cartographie.
 */
(function (root) {
  "use strict";

  var INDEX_PEDAGOGIE = {
    "meta": {
      "id": "index-pedagogie",
      "version": "1.0",
      "statut": "enrichissement",
      "objectif": "Conserver les concepts, idées, analyses et pistes pédagogiques extraits des références afin qu'une IA puisse ensuite les confronter aux compétences et aux séquences de Synapses.",
      "regle": "Ce fichier est une base de réflexion pédagogique. Il ne contient pas directement les prerequis_competences et ne remplace pas index.json ou competences.json."
    },

    "sources": [
      {
        "id": "guide-lecture-ecriture-cp-2019",
        "type": "guide_officiel",
        "titre": "Pour enseigner la lecture et l’écriture au CP",
        "sous_titre": "Un guide fondé sur l’état de la recherche",
        "institution": "Ministère de l'Éducation nationale et de la Jeunesse",
        "edition": "Seconde édition",
        "annee": 2019,
        "fichier": "guide-pour-enseigner-la-lecture-et-l-ecriture-au-cp-67854.pdf",
        "portee": [
          "CP",
          "lecture",
          "écriture",
          "compréhension",
          "code",
          "orthographe"
        ],
        "statut": "source_principale"
      }
    ],

    "concepts": [
      {
        "id": "code-alphabetique",
        "nom": "Code alphabétique",
        "definition": "Système de correspondances entre les graphèmes et les sons élémentaires du langage oral.",
        "idee_centrale": "La connaissance des graphèmes et de leur fonctionnement constitue une condition nécessaire des apprentissages de lecture et d'écriture au CP.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "7"
            ]
          }
        ]
      },

      {
        "id": "enseignement-explicite-progressif",
        "nom": "Enseignement explicite, ordonné et progressif",
        "definition": "Les signes de l'écriture doivent être présentés selon une progression organisée, avec mémorisation et consolidation.",
        "idee_centrale": "La progression des apprentissages doit être pensée comme une construction explicite et cumulative.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "15-16"
            ]
          }
        ]
      },

      {
        "id": "tempo-apprentissage-code",
        "nom": "Tempo d'étude du code",
        "definition": "La vitesse d'introduction des correspondances graphème-phonème constitue une variable pédagogique importante.",
        "idee_centrale": "Le guide met en garde contre une progression trop lente qui peut pénaliser les élèves, notamment les plus fragiles.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "25",
              "28"
            ]
          }
        ]
      },

      {
        "id": "progression-graphèmes-phonèmes",
        "nom": "Progression des correspondances graphème-phonème",
        "definition": "Étude organisée et progressive des correspondances permettant progressivement de décoder davantage de syllabes, mots et phrases.",
        "idee_centrale": "Les correspondances doivent être introduites de façon explicite et réutilisées dans des combinaisons de plus en plus riches.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "25-28",
              "67-73"
            ]
          }
        ]
      },

      {
        "id": "lecture-ecriture-articulees",
        "nom": "Articulation lecture-écriture",
        "definition": "Lecture et écriture sont deux dimensions complémentaires des premiers apprentissages.",
        "idee_centrale": "Dès l'étude du premier graphème, l'élève peut copier puis écrire sous la dictée ; les activités se complètent et se complexifient.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "44-47",
              "74-77"
            ]
          }
        ]
      },

      {
        "id": "decodage-comprehension",
        "nom": "Décodage et compréhension",
        "definition": "Le décodage et la compréhension constituent des composantes distinctes mais articulées de l'activité de lecture.",
        "idee_centrale": "Le décodage est nécessaire à l'accès autonome au texte mais ne suffit pas à lui seul à assurer la compréhension.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "7-10",
              "39-43",
              "48-55"
            ]
          }
        ]
      },

      {
        "id": "comprehension-langage-oral",
        "nom": "Compréhension et langage oral",
        "definition": "La compréhension écrite s'appuie notamment sur les compétences langagières et les connaissances construites à l'oral.",
        "idee_centrale": "Les activités de compréhension peuvent être engagées avant que tous les textes soient accessibles par décodage autonome.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "48-55"
            ]
          }
        ]
      },

      {
        "id": "fluence",
        "nom": "Fluence",
        "definition": "Lecture suffisamment rapide, précise et automatisée pour permettre de consacrer davantage de ressources à la compréhension.",
        "idee_centrale": "La fluence est construite par entraînement et automatisation, notamment à partir de correspondances déjà étudiées.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "29-31",
              "39-44"
            ]
          }
        ]
      },

      {
        "id": "consolidation",
        "nom": "Mémorisation et consolidation",
        "definition": "Réutilisation régulière d'un apprentissage afin de stabiliser sa maîtrise.",
        "idee_centrale": "Une progression ne doit pas seulement introduire de nouveaux éléments ; elle doit prévoir leur consolidation.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "15-16",
              "26-28"
            ]
          }
        ]
      },

      {
        "id": "dechiffrabilite",
        "nom": "Déchiffrabilité des supports",
        "definition": "Adéquation entre les éléments du code déjà étudiés et les textes proposés aux élèves.",
        "idee_centrale": "Les supports doivent permettre aux élèves de mobiliser réellement les correspondances qu'ils ont apprises.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "27-28",
              "64-67"
            ]
          }
        ]
      },

      {
        "id": "encodage",
        "nom": "Encodage",
        "definition": "Production écrite reposant notamment sur l'analyse des sons et leur transcription graphique.",
        "idee_centrale": "L'encodage peut accompagner l'étude des graphèmes et contribue à renforcer les apprentissages du code.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "44-47",
              "74-77"
            ]
          }
        ]
      },

      {
        "id": "orthographe-lexicale",
        "nom": "Construction des représentations orthographiques",
        "definition": "Stabilisation progressive de la forme écrite des mots et des régularités orthographiques.",
        "idee_centrale": "Les correspondances étudiées peuvent ensuite être reprises dans un travail morphologique et orthographique.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "25",
              "93-106"
            ]
          }
        ]
      }
    ],

    "idees_cles": [
      {
        "id": "idee-001",
        "titre": "La lecture et l'écriture sont méthodiquement construites",
        "idee": "Contrairement à l'acquisition spontanée du langage oral, les apprentissages de lecture et d'écriture relèvent d'un enseignement explicite et organisé.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "15-16"
            ]
          }
        ]
      },

      {
        "id": "idee-002",
        "titre": "Le code constitue une condition nécessaire mais non suffisante",
        "idee": "La connaissance des correspondances graphème-phonème est indispensable, mais l'activité de lecture mobilise également d'autres composantes.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "7-10"
            ]
          }
        ]
      },

      {
        "id": "idee-003",
        "titre": "Le premier graphème peut déjà être réinvesti en écriture",
        "idee": "Le guide donne l'exemple d'une articulation immédiate entre étude du graphème, copie et dictée dès le premier graphème étudié.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "44-47"
            ]
          }
        ]
      },

      {
        "id": "idee-004",
        "titre": "Les apprentissages se renforcent par réinvestissement",
        "idee": "Les nouveaux éléments doivent être repris dans des activités qui mobilisent les éléments précédemment étudiés.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "25-28",
              "44-47"
            ]
          }
        ]
      },

      {
        "id": "idee-005",
        "titre": "La compréhension ne doit pas être repoussée",
        "idee": "La compréhension peut être travaillée avec des textes entendus et progressivement avec des textes décodables ; elle ne constitue pas simplement une étape située après l'apprentissage du code.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "48-55"
            ]
          }
        ]
      },

      {
        "id": "idee-006",
        "titre": "Le rythme de progression compte",
        "idee": "Le guide souligne qu'une progression trop lente peut limiter les possibilités de décodage et l'auto-apprentissage.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "28"
            ]
          }
        ]
      }
    ],

    "pistes_d_analyse": [
      {
        "id": "piste-001",
        "question": "Quelles compétences de competences.json correspondent aux composantes du code alphabétique ?",
        "but": "Permettre à l'IA de rechercher des correspondances sans inventer de nouveaux identifiants."
      },

      {
        "id": "piste-002",
        "question": "Quelles compétences sont mobilisées ensemble lors de l'étude d'un nouveau graphème ?",
        "but": "Identifier les apprentissages susceptibles d'être construits conjointement."
      },

      {
        "id": "piste-003",
        "question": "Quels apprentissages doivent être suffisamment construits avant qu'une nouvelle correspondance puisse être réinvestie ?",
        "but": "Fournir ultérieurement des éléments permettant d'établir des prérequis justifiés."
      },

      {
        "id": "piste-004",
        "question": "Quelles compétences doivent être consolidées après leur première introduction ?",
        "but": "Identifier des relations de consolidation plutôt que de simples relations chronologiques."
      },

      {
        "id": "piste-005",
        "question": "Quelles séquences de index.json peuvent être interprétées comme des étapes d'une même progression pédagogique ?",
        "but": "Aider l'IA à analyser les séquences sans modifier directement index.json."
      }
    ],

    "observations_a_ne_pas_transformer_automatiquement_en_prerequis": [
      {
        "id": "observation-001",
        "texte": "Le code alphabétique est présenté comme une condition nécessaire de la lecture et de l'écriture.",
        "raison": "Le guide indique également que cette condition n'est pas suffisante pour penser l'ensemble des apprentissages.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "7-10"
            ]
          }
        ]
      },

      {
        "id": "observation-002",
        "texte": "Lecture et écriture sont explicitement articulées dès l'étude du premier graphème.",
        "raison": "Cela indique une articulation forte, mais ne signifie pas automatiquement que toutes les compétences d'écriture doivent être déclarées comme prérequis des compétences de lecture.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "44-47"
            ]
          }
        ]
      },

      {
        "id": "observation-003",
        "texte": "La compréhension peut être travaillée avant la maîtrise complète du code.",
        "raison": "Il faut donc éviter de construire une chaîne unique dans laquelle toute compréhension serait postérieure au décodage.",
        "source": [
          {
            "source_id": "guide-lecture-ecriture-cp-2019",
            "pages": [
              "48-55"
            ]
          }
        ]
      }
    ],

    "a_approfondir": [
      "Progression précise des correspondances graphème-phonème.",
      "Conditions de déchiffrabilité des textes à chaque étape.",
      "Relations entre phonologie, décodage et encodage.",
      "Construction de la fluence.",
      "Rôle du vocabulaire, de la syntaxe et des connaissances dans la compréhension.",
      "Construction progressive de l'orthographe.",
      "Relations entre compétences de CP et prolongements dans les niveaux suivants."
    ]
  };

  root.INDEX_PEDAGOGIE = INDEX_PEDAGOGIE;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = INDEX_PEDAGOGIE;
  }

})(typeof window !== "undefined" ? window : globalThis);
