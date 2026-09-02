/**
 * synapses-export-pdf.js
 * ---------------------------------------------------------------------------
 * Génère, pour un élève (ou pour tous les élèves du coffre), une fiche PDF
 * lisible et ergonomique reprenant la DA du site (bandeau navy, accent bleu,
 * typographies Fraunces/Inter approchées avec les polices PDF standard).
 *
 * Règles de confidentialité (voir synapses-coffre.js) :
 *  - Tout se passe EN MÉMOIRE, dans le navigateur. jsPDF construit le fichier
 *    localement puis déclenche un téléchargement natif : aucune donnée élève
 *    ne transite par un serveur, ni par le réseau.
 *  - Ce module ne lit que ce que le Coffre lui fournit explicitement (mêmes
 *    garanties que suivi-individuel.js) ; il n'écrit jamais dans
 *    localStorage/URL/logs.
 *
 * Dépend de :
 *  - jsPDF + plugin jspdf-autotable (chargés en <script> avant ce fichier,
 *    voir coffre.html) ;
 *  - synapses-coffre.js (structure des données élève) ;
 *  - éventuellement suivi-individuel.js (pour les libellés de domaines) et
 *    grille-analyse.js (pour le parcours de compétences proposé), de façon
 *    optionnelle et non bloquante : si l'un des deux manque, la fiche PDF
 *    se génère quand même, simplement sans cette section.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // Palette reprise de :root dans coffre.html (couleurs converties en RGB 0-255)
  const C = {
    navy: [30, 42, 74],
    navyDeep: [20, 29, 51],
    accent: [46, 94, 170],
    ink: [32, 36, 46],
    inkSoft: [91, 95, 107],
    line: [222, 219, 210],
    bg: [246, 245, 241],
    danger: [181, 80, 46],
    ok: [42, 127, 114],
    white: [255, 255, 255]
  };

  const MARGIN = 36;

  function jsPDFCtor() {
    const ns = global.jspdf;
    if (!ns || !ns.jsPDF) {
      throw new Error(
        'jsPDF n\'est pas chargé. Ajoutez les scripts jsPDF et jspdf-autotable avant synapses-export-pdf.js.'
      );
    }
    return ns.jsPDF;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('fr-FR');
    } catch (e) {
      return '';
    }
  }

  function nomComplet(eleve) {
    const identite = eleve.identite || {};
    return [identite.prenom, identite.nom].filter(Boolean).join(' ') || '(identité non renseignée)';
  }

  /**
   * Traduit une valeur numérique (typiquement 1-3, mais tolérant à d'autres échelles)
   * en un mot compréhensible sans jargon, tout en gardant le chiffre entre parenthèses
   * pour ne perdre aucune information à celles et ceux habitué·es à l'échelle numérique.
   */
  function niveauLisible(valeur, mots) {
    if (valeur == null || valeur === '') return '—';
    const n = Number(valeur);
    if (!Number.isFinite(n)) return String(valeur);
    const mot = mots[n];
    return mot ? (mot + ' (' + n + ')') : ('Niveau ' + n);
  }

  const MOTS_PRIORITE = { 1: 'Faible', 2: 'Moyenne', 3: 'Élevée' };
  const MOTS_EFFICACITE = { 1: 'Peu efficace', 2: 'Assez efficace', 3: 'Très efficace' };

  function capitaliser(txt) {
    if (!txt) return '';
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  class ExportFichePDF {
    /**
     * @param {SynapsesCoffre.Coffre} coffre
     * @param {SynapsesSuiviIndividuel.SuiviIndividuel} [suivi] - optionnel, pour libeller
     *   les domaines avec leur nom lisible (BARRY/S4C) plutôt que leur identifiant brut.
     */
    constructor(coffre, suivi) {
      this.coffre = coffre;
      this.suivi = suivi || null;
    }

    _labelDomaine(id) {
      if (!id) return '—';
      if (this.suivi && typeof this.suivi._labelDomaine === 'function') {
        return this.suivi._labelDomaine(id);
      }
      return id;
    }

    /**
     * Renvoie les étapes du "parcours de compétences proposé" (même calcul que
     * l'onglet Parcours de l'appli, voir grille-analyse.js), en réutilisant le
     * moteur d'analyse déjà instancié par suivi-individuel.js — jamais recalculé
     * indépendamment, pour ne jamais désynchroniser la fiche PDF de l'écran.
     * Renvoie null si le moteur d'analyse n'est pas disponible (grille-analyse.js
     * non chargé, ou export PDF utilisé sans passer suivi au constructeur) :
     * dans ce cas, la fiche PDF omet simplement cette section plutôt que d'échouer.
     */
    _etapesParcoursProposees(eleve) {
      if (!this.suivi || typeof this.suivi._obtenirGrilleAnalyseUI !== 'function') return null;
      try {
        const ui = this.suivi._obtenirGrilleAnalyseUI();
        if (!ui || !ui.moteur || typeof ui.moteur.proposerParcours !== 'function') return null;
        return ui.moteur.proposerParcours(eleve);
      } catch (e) {
        return null;
      }
    }

    // ------------------------------------------------------------------
    // Mise en page commune
    // ------------------------------------------------------------------

    _nouveauDocument() {
      const JsPDF = jsPDFCtor();
      // Format paysage : les tableaux (observations notamment, jusqu'à 6 colonnes)
      // gagnent en largeur, donc en lisibilité, plutôt que d'entasser du texte
      // dans des colonnes étroites en portrait.
      const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      doc.setProperties({
        title: 'Fiche Synapses',
        subject: 'Coffre confidentiel Synapses',
        creator: 'Synapses'
      });
      return doc;
    }

    _largeurPage(doc) {
      return doc.internal.pageSize.getWidth();
    }
    _hauteurPage(doc) {
      return doc.internal.pageSize.getHeight();
    }

    /** Bandeau d'en-tête navy, identique en esprit au header du site. Renvoie le y de reprise. */
    _dessinerEntete(doc, eleve) {
      const w = this._largeurPage(doc);
      const infos = this.coffre.donnees || {};

      doc.setFillColor.apply(doc, C.navy);
      doc.rect(0, 0, w, 92, 'F');
      doc.setFillColor.apply(doc, C.accent);
      doc.rect(0, 89, w, 3, 'F');

      // Wordmark
      doc.setTextColor.apply(doc, C.white);
      doc.setFont('times', 'bold');
      doc.setFontSize(9);
      doc.text('SYNAPSES', MARGIN, 26);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(185, 198, 229);
      doc.text('COFFRE CONFIDENTIEL — FICHE INDIVIDUELLE', MARGIN, 38);

      // Nom / identifiant
      doc.setFont('times', 'bold');
      doc.setFontSize(18);
      doc.setTextColor.apply(doc, C.white);
      doc.text(nomComplet(eleve), MARGIN, 62);

      doc.setFont('courier', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(185, 198, 229);
      const age = eleve.age != null ? (' · ' + eleve.age + ' an' + (eleve.age > 1 ? 's' : '')) : '';
      const classe = eleve.classe != null ? (' · ' + eleve.classe) : '';
      doc.text(eleve.identifiantSynapses + age + classe, MARGIN, 76);

      // Établissement / dispositif, aligné à droite
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(185, 198, 229);
      const droite = [infos.dispositif, infos.etablissement].filter(Boolean).join(' — ') || '';
      if (droite) doc.text(droite, w - MARGIN, 62, { align: 'right' });
      doc.setFontSize(8);
      doc.text('Généré le ' + new Date().toLocaleDateString('fr-FR'), w - MARGIN, 76, { align: 'right' });

      return 118;
    }

    /** Bandeau de rappel de confidentialité, discret, en haut de chaque fiche. */
    _dessinerBandeauConfidentialite(doc, y) {
      const w = this._largeurPage(doc);
      const texte =
        'Document confidentiel : contient des données individuelles concernant un élève en situation de handicap ' +
        'ou de besoin éducatif particulier. À ne diffuser qu\'aux personnes habilitées, à conserver sur un support sûr.';
      doc.setFillColor(255, 247, 237);
      doc.setDrawColor(239, 217, 184);
      const hauteurTexte = doc.splitTextToSize(texte, w - 2 * MARGIN - 16);
      const h = 14 + hauteurTexte.length * 11;
      doc.roundedRect(MARGIN, y, w - 2 * MARGIN, h, 4, 4, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(122, 74, 18);
      doc.text(hauteurTexte, MARGIN + 8, y + 15);
      return y + h + 18;
    }

    /** Encadré "mode d'emploi", pensé pour un∙e collègue qui découvre ce document :
     *  rappelle en une phrase ce que contient chaque section, sans jargon. */
    _dessinerModeEmploi(doc, y) {
      const w = this._largeurPage(doc);
      const texte =
        'Comment lire cette fiche : "Observations" = ce qui a été remarqué en classe, dans quel contexte, et ce qui ' +
        'a été essayé sur le moment. "Besoins identifiés" = ce dont l\'élève semble avoir besoin pour progresser, avec ' +
        'un niveau de priorité. "Adaptations" = les aménagements testés et leur efficacité observée. "Objectifs" = ce ' +
        'qui est visé actuellement. "Équivalence scolaire" = une estimation d\'un niveau moyen en français et en ' +
        'mathématiques, comparée aux compétences du programme, plus une description transversale à tous les domaines ' +
        '— toujours une suggestion à valider, jamais un diagnostic. "Parcours de compétences proposé" = une suite ' +
        'd\'objectifs suggérée par l\'application, à valider ou ajuster. "Historique des parcours proposés" = des ' +
        'photos datées de cette suggestion, prises volontairement pour suivre son évolution. "Journal de parcours" = ' +
        'une chronologie libre des étapes marquantes.';
      doc.setFillColor.apply(doc, C.bg);
      doc.setDrawColor.apply(doc, C.line);
      const lignes = doc.splitTextToSize(texte, w - 2 * MARGIN - 16);
      const h = 12 + lignes.length * 11;
      doc.roundedRect(MARGIN, y, w - 2 * MARGIN, h, 4, 4, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor.apply(doc, C.inkSoft);
      doc.text(lignes, MARGIN + 8, y + 14);
      return y + h + 18;
    }

    _titreSection(doc, y, titre, sousTitre) {
      doc.setFont('times', 'bold');
      doc.setFontSize(13);
      doc.setTextColor.apply(doc, C.ink);
      doc.text(titre, MARGIN, y);
      doc.setDrawColor.apply(doc, C.line);
      doc.setLineWidth(1);
      doc.line(MARGIN, y + 5, this._largeurPage(doc) - MARGIN, y + 5);
      y += 22;
      if (sousTitre) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor.apply(doc, C.inkSoft);
        doc.text(sousTitre, MARGIN, y - 8);
        y += 6;
      }
      return y;
    }

    _texteVide(doc, y, texte) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9.5);
      doc.setTextColor.apply(doc, C.inkSoft);
      doc.text(texte, MARGIN, y);
      return y + 20;
    }

    /** Paragraphe de texte libre avec un petit sous-titre en gras au-dessus,
     *  pour du contenu trop long/variable pour tenir dans une cellule de tableau
     *  (ex. le compte rendu transversal de l'équivalence scolaire). */
    _paragrapheAvecSousTitre(doc, y, sousTitre, texte) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor.apply(doc, C.ink);
      doc.text(sousTitre, MARGIN, y);
      y += 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, C.ink);
      const lignes = doc.splitTextToSize(texte, this._largeurPage(doc) - 2 * MARGIN);
      doc.text(lignes, MARGIN, y);
      return y + lignes.length * 12 + 18;
    }

    /** Table ergonomique via autoTable, stylée pour coller à la DA (bandeau accent, lignes fines). */
    _table(doc, y, head, rows, colStyles) {
      doc.autoTable({
        startY: y,
        margin: { left: MARGIN, right: MARGIN },
        head: [head],
        body: rows,
        theme: 'plain',
        styles: {
          font: 'helvetica',
          fontSize: 9,
          textColor: C.ink,
          lineColor: C.line,
          lineWidth: 0.5,
          cellPadding: { top: 5, bottom: 5, left: 4, right: 4 },
          overflow: 'linebreak',
          valign: 'top'
        },
        headStyles: {
          fillColor: C.navy,
          textColor: C.white,
          fontStyle: 'bold',
          fontSize: 8.5
        },
        alternateRowStyles: { fillColor: [250, 250, 247] },
        columnStyles: colStyles || {}
      });
      return doc.lastAutoTable.finalY + 24;
    }

    _sauteDePageSiNecessaire(doc, y, marge) {
      const hMax = this._hauteurPage(doc) - (marge || 50);
      if (y > hMax) {
        doc.addPage();
        return 50;
      }
      return y;
    }

    _piedDePage(doc) {
      const total = doc.internal.getNumberOfPages();
      for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        const w = this._largeurPage(doc);
        const h = this._hauteurPage(doc);
        doc.setDrawColor.apply(doc, C.line);
        doc.setLineWidth(0.5);
        doc.line(MARGIN, h - 34, w - MARGIN, h - 34);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor.apply(doc, C.inkSoft);
        doc.text('Synapses — Coffre confidentiel · document généré localement, non destiné à être diffusé sans précaution', MARGIN, h - 20);
        doc.text('Page ' + i + ' / ' + total, w - MARGIN, h - 20, { align: 'right' });
      }
    }

    // ------------------------------------------------------------------
    // Construction du contenu d'une fiche élève
    // ------------------------------------------------------------------

    /** Ajoute la fiche complète de `eleve` au document, sur une ou plusieurs pages.
     *  Si `nouvellePage` est vrai, commence sur une nouvelle page (utile pour l'export groupé). */
    _construireFiche(doc, eleve, nouvellePage) {
      if (nouvellePage) doc.addPage();
      let y = this._dessinerEntete(doc, eleve);
      y = this._dessinerBandeauConfidentialite(doc, y);
      y = this._dessinerModeEmploi(doc, y);

      // ---- Observations ----
      y = this._titreSection(doc, y, 'Observations (' + eleve.observations.length + ')',
        'Ce qui a été remarqué en classe, dans quel contexte, et ce qui a été mis en place sur le moment.');
      if (!eleve.observations.length) {
        y = this._texteVide(doc, y, 'Aucune observation enregistrée pour cet élève.');
      } else {
        const rows = eleve.observations.slice().reverse().map((o) => [
          fmtDate(o.date),
          this._labelDomaine(o.domaine),
          o.situation || '',
          o.difficulte || '',
          o.besoin || '',
          o.adaptationUtilisee || o.adaptationProposee || ''
        ]);
        y = this._table(doc, y, ['Date', 'Domaine', 'Situation', 'Difficulté', 'Besoin', 'Adaptation'], rows, {
          0: { cellWidth: 60 }, 1: { cellWidth: 75 }
        });
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Besoins ----
      y = this._titreSection(doc, y, 'Besoins identifiés (' + eleve.besoins.length + ')',
        'Ce dont l\'élève semble avoir besoin pour progresser, avec un niveau de priorité.');
      if (!eleve.besoins.length) {
        y = this._texteVide(doc, y, 'Aucun besoin enregistré pour cet élève.');
      } else {
        const rows = eleve.besoins.map((b) => [b.hypothese || '', niveauLisible(b.priorite, MOTS_PRIORITE)]);
        y = this._table(doc, y, ['Hypothèse de besoin', 'Priorité'], rows, { 1: { cellWidth: 110 } });
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Adaptations ----
      y = this._titreSection(doc, y, 'Adaptations (' + eleve.adaptations.length + ')',
        'Les aménagements testés avec cet élève, et l\'efficacité observée sur le terrain.');
      if (!eleve.adaptations.length) {
        y = this._texteVide(doc, y, 'Aucune adaptation enregistrée pour cet élève.');
      } else {
        const rows = eleve.adaptations.map((a) => [
          a.libelle || '',
          a.utilisee ? 'Oui' : 'Non',
          niveauLisible(a.efficacite, MOTS_EFFICACITE)
        ]);
        y = this._table(doc, y, ['Adaptation', 'Utilisée', 'Efficacité'], rows, { 1: { cellWidth: 60 }, 2: { cellWidth: 110 } });
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Objectifs ----
      y = this._titreSection(doc, y, 'Objectifs (' + eleve.objectifs.length + ')',
        'Ce qui est visé actuellement pour cet élève, et où cela en est.');
      if (!eleve.objectifs.length) {
        y = this._texteVide(doc, y, 'Aucun objectif enregistré pour cet élève.');
      } else {
        const rows = eleve.objectifs.map((o) => [o.libelle || '', o.statut || '']);
        y = this._table(doc, y, ['Objectif', 'Statut'], rows, { 1: { cellWidth: 100 } });
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Équivalence scolaire (voir grille-analyse.js / synapses-coffre.js) ----
      const eq = eleve.equivalenceScolaire || {};
      y = this._titreSection(doc, y, 'Équivalence scolaire',
        'Estimation d\'un niveau moyen en français et en mathématiques, comparée aux compétences du programme, et une description transversale à tous les domaines — toujours une suggestion à valider, jamais un diagnostic.');
      if (!eq.francais && !eq.mathematiques && !eq.transversal) {
        y = this._texteVide(doc, y, 'Aucune équivalence scolaire enregistrée pour cet élève.');
      } else {
        if (eq.dateMaj) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8.5);
          doc.setTextColor.apply(doc, C.inkSoft);
          doc.text('Dernière mise à jour : ' + fmtDate(eq.dateMaj), MARGIN, y);
          y += 16;
        }
        const rows = [
          ['Français', (eq.francais && eq.francais.niveauEquivalent) || '—', (eq.francais && eq.francais.compteRendu) || '—'],
          ['Mathématiques', (eq.mathematiques && eq.mathematiques.niveauEquivalent) || '—', (eq.mathematiques && eq.mathematiques.compteRendu) || '—']
        ];
        y = this._table(doc, y, ['Discipline', 'Niveau équivalent', 'Compte rendu'], rows, {
          0: { cellWidth: 90 }, 1: { cellWidth: 110 }
        });
        if (eq.transversal && eq.transversal.compteRendu) {
          y = this._paragrapheAvecSousTitre(doc, y, 'Description transversale (tous domaines)', eq.transversal.compteRendu);
        }
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Historique des équivalences scolaires précédentes ----
      const historiqueEquivalence = (eq.historique || [])
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date)); // plus récent en premier
      if (historiqueEquivalence.length) {
        y = this._titreSection(doc, y, 'Historique des équivalences scolaires (' + historiqueEquivalence.length + ')',
          'Versions précédentes conservées automatiquement à chaque nouvelle mise à jour, pour suivre l\'évolution de l\'estimation.');
        const rows = historiqueEquivalence.map((h) => [
          fmtDate(h.date),
          (h.francais && h.francais.niveauEquivalent) || '—',
          (h.mathematiques && h.mathematiques.niveauEquivalent) || '—'
        ]);
        y = this._table(doc, y, ['Date', 'Français', 'Mathématiques'], rows, {
          0: { cellWidth: 90 }
        });
        y = this._sauteDePageSiNecessaire(doc, y);
      }

      // ---- Parcours de compétences proposé (calculé, voir grille-analyse.js) ----
      const etapesParcours = this._etapesParcoursProposees(eleve);
      y = this._titreSection(doc, y,
        'Parcours de compétences proposé' + (etapesParcours ? ' (' + etapesParcours.length + ')' : ''),
        'Suite d\'objectifs suggérée automatiquement à partir des besoins et compétences observés — toujours à valider par l\'enseignant, jamais une prescription.');
      if (etapesParcours === null) {
        y = this._texteVide(doc, y,
          'Section non disponible pour cette fiche (moteur d\'analyse non chargé au moment de la génération du PDF).');
      } else if (!etapesParcours.length) {
        y = this._texteVide(doc, y,
          'Aucune étape proposée pour le moment : pas encore assez de besoins ou d\'objectifs enregistrés pour cet élève.');
      } else {
        const rows = etapesParcours.map((e) => [
          String(e.ordre),
          e.domaineNom || '—',
          e.objectif || '',
          capitaliser(e.statut),
          e.origine || '',
          (e.adaptationsAssociees && e.adaptationsAssociees.length) ? e.adaptationsAssociees.join(', ') : '—'
        ]);
        y = this._table(doc, y, ['#', 'Domaine', 'Objectif proposé', 'Statut', 'Origine', 'Adaptations associées'], rows, {
          0: { cellWidth: 22 }, 1: { cellWidth: 85 }, 3: { cellWidth: 60 }
        });
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Historique des instantanés du parcours proposé (voir suivi-individuel.js) ----
      const historiqueParcours = (eleve.parcours.historiqueParcoursPropose || [])
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date)); // plus récent en premier
      y = this._titreSection(doc, y, 'Historique des parcours proposés (' + historiqueParcours.length + ')',
        'Instantanés datés, enregistrés à la demande de l\'enseignant, du parcours proposé à un moment donné — pour voir comment la proposition a évolué.');
      if (!historiqueParcours.length) {
        y = this._texteVide(doc, y, 'Aucun instantané enregistré pour cet élève.');
      } else {
        const rows = historiqueParcours.map((h) => {
          const etapes = h.etapes || [];
          const resume = etapes.map((e) => e.objectif).filter(Boolean).join(' → ') || '—';
          return [fmtDate(h.date), String(etapes.length), resume];
        });
        y = this._table(doc, y, ['Date de l\'instantané', 'Nb. étapes', 'Étapes proposées à cette date'], rows, {
          0: { cellWidth: 90 }, 1: { cellWidth: 55 }
        });
      }
      y = this._sauteDePageSiNecessaire(doc, y);

      // ---- Journal de parcours (manuel) ----
      const evenements = []
        .concat((eleve.parcours.seances || []).map((e) => ({ ...e, type: 'Séance' })))
        .concat((eleve.parcours.observations || []).map((e) => ({ ...e, type: 'Observation' })))
        .concat((eleve.parcours.progres || []).map((e) => ({ ...e, type: 'Progrès' })))
        .concat((eleve.parcours.bilans || []).map((e) => ({ ...e, type: 'Bilan' })))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      y = this._titreSection(doc, y, 'Journal de parcours (' + evenements.length + ')',
        'Une chronologie libre des étapes marquantes : séances, observations ponctuelles, progrès, bilans.');
      if (!evenements.length) {
        y = this._texteVide(doc, y, 'Aucun événement de parcours manuel enregistré pour cet élève.');
      } else {
        const rows = evenements.map((e) => [fmtDate(e.date), e.type, e.libelle || e.resume || '']);
        y = this._table(doc, y, ['Date', 'Type', 'Libellé'], rows, { 0: { cellWidth: 65 }, 1: { cellWidth: 85 } });
      }

      return y;
    }

    // ------------------------------------------------------------------
    // Points d'entrée publics
    // ------------------------------------------------------------------

    /** Génère et télécharge la fiche PDF d'un seul élève. */
    telechargerFicheEleve(identifiantSynapses) {
      const eleve = this.coffre.getEleve(identifiantSynapses);
      const doc = this._nouveauDocument();
      this._construireFiche(doc, eleve, false);
      this._piedDePage(doc);
      doc.save(this._nomFichier(eleve));
    }

    /** Génère et télécharge un seul PDF regroupant la fiche de chaque élève du coffre
     *  (une fiche = une ou plusieurs pages, séparées par un saut de page). */
    telechargerToutesLesFiches() {
      const eleves = this.coffre.donnees.eleves;
      if (!eleves.length) throw new Error('Aucun élève dans ce coffre.');
      const doc = this._nouveauDocument();
      eleves.forEach((eleve, i) => this._construireFiche(doc, eleve, i > 0));
      this._piedDePage(doc);
      const infos = this.coffre.donnees || {};
      const base = (infos.etablissement || infos.dispositif || 'coffre').trim();
      doc.save(this._nomFichierSlug(base) + '_fiches-eleves_' + this._horodatage() + '.pdf');
    }

    _nomFichier(eleve) {
      const nom = nomComplet(eleve) === '(identité non renseignée)' ? eleve.identifiantSynapses : nomComplet(eleve);
      return this._nomFichierSlug(nom) + '_' + this._horodatage() + '.pdf';
    }

    _nomFichierSlug(txt) {
      return (txt || 'fiche')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'fiche';
    }

    _horodatage() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
  }

  global.SynapsesExportPDF = { ExportFichePDF };
})(window);
