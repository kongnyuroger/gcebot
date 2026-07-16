import PDFDocument from 'pdfkit';

/**
 * Builds a small, realistic 2-page GCE-style PDF in memory: a repeating running
 * header, "Page N of 2" footers, and SECTION/Question topic markers - the same
 * structure the pdf-extractor and chunking services are designed to handle.
 */
export function buildGceBiologySamplePdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { width, height } = doc.page;
    const totalPages = 2;
    const leftMargin = 60;
    const contentWidth = width - 2 * leftMargin;

    const headerFooter = (pageNum: number) => {
      doc.fontSize(9).font('Helvetica-Bold').text('GCE ORDINARY LEVEL - BIOLOGY 2023', 0, 25, {
        width,
        align: 'center',
        lineBreak: false,
      });
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(`Page ${pageNum} of ${totalPages}`, 0, height - 30, {
          width,
          align: 'center',
          lineBreak: false,
        });
    };

    const body = (text: string, y: number): number => {
      doc.text(text, leftMargin, y, { width: contentWidth });
      return doc.y;
    };

    // Page 1
    headerFooter(1);
    let y = 80;
    doc.fontSize(13).font('Helvetica-Bold');
    y = body('SECTION A', y) + 10;
    doc.fontSize(11).font('Helvetica-Bold');
    y = body('Question 1', y) + 6;
    doc.fontSize(10).font('Helvetica');
    y =
      body(
        'The cell is the basic structural and functional unit of all living organisms. ' +
          'Every cell is bounded by a cell membrane that regulates the movement of substances ' +
          'into and out of the cell. Plant cells additionally possess a rigid cell wall made ' +
          'primarily of cellulose, which provides structural support and protection against ' +
          'osmotic lysis in hypotonic environments.',
        y,
      ) + 14;
    doc.fontSize(11).font('Helvetica-Bold');
    y = body('Question 2', y) + 6;
    doc.fontSize(10).font('Helvetica');
    body(
      'Photosynthesis occurs in two main stages: the light-dependent reactions, which take ' +
        'place in the thylakoid membranes, and the light-independent reactions (Calvin cycle), ' +
        'which occur in the stroma of the chloroplast.',
      y,
    );

    doc.addPage({ size: 'A4', margin: 0 });

    // Page 2
    headerFooter(2);
    y = 80;
    doc.fontSize(13).font('Helvetica-Bold');
    y = body('SECTION B', y) + 10;
    doc.fontSize(11).font('Helvetica-Bold');
    y = body('ORGANIC CHEMISTRY OF LIFE', y) + 6;
    doc.fontSize(10).font('Helvetica');
    y =
      body(
        'Carbohydrates, lipids, proteins, and nucleic acids are the four major classes of ' +
          'biological macromolecules. Carbohydrates serve primarily as energy sources and ' +
          'structural components, while proteins act as enzymes, structural elements, and ' +
          'signalling molecules within living systems.',
        y,
      ) + 14;
    doc.fontSize(11).font('Helvetica-Bold');
    y = body('Question 3', y) + 6;
    doc.fontSize(10).font('Helvetica');
    body(
      'Enzymes are biological catalysts that lower the activation energy of chemical ' +
        'reactions without being consumed in the process. Enzyme activity is influenced by ' +
        'temperature, pH, and substrate concentration.',
      y,
    );

    doc.end();
  });
}
