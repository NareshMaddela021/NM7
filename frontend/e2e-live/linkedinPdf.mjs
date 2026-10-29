// A small PDF laid out like LinkedIn's "Save to PDF" profile (sidebar: Contact, Top Skills, Certifications; main:
// name, headline, location, Summary, Experience, Education), for the /linkedin upload tests.
import { PDFDocument, StandardFonts } from 'pdf-lib';

export async function linkedinPdf({ name = 'Ravi Kumar', headline = 'Student at JNTU Hyderabad', phone = '+91 98765 43210', mail = 'ravi@example.com' } = {}) {
  const doc = await PDFDocument.create();
  doc.setSubject('Resume generated from profile');
  doc.setAuthor('LinkedIn');
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const side = (text, size, f = font) => { page.drawText(text, { x: 30, y, size, font: f }); y -= size * 1.9; };
  side('Contact', 13, bold); side(mail, 10.5); side(phone, 10.5);
  y -= 10; side('Top Skills', 13, bold); side('SQL', 10.5); y -= 6; side('Python', 10.5); y -= 6; side('Communication', 10.5);
  y -= 10; side('Certifications', 13, bold); side('Google Data Analytics', 10.5);
  y = 800;
  const main = (text, size, f = font, gap = 1.8) => { page.drawText(text, { x: 220, y, size, font: f }); y -= size * gap; };
  main(name, 26, bold, 1.6); main(headline, 12); main('Hyderabad, Telangana, India', 10.5, font, 3);
  main('Summary', 15.75, bold); main('I am a final year student. I like computers.', 10.5, font, 3);
  main('Experience', 15.75, bold); main('Acme Analytics', 12, bold); main('Data Intern', 11.5);
  main('January 2024 - June 2024 (6 months)', 10.5); main('Hyderabad, Telangana, India', 10.5); main('Made weekly sales reports in Excel.', 10.5, font, 3);
  main('Education', 15.75, bold); main('JNTU Hyderabad', 12, bold); main('Bachelor of Technology - BTech, Computer Science · (2020 - 2024)', 10.5);
  page.drawText('Page 1 of 1', { x: 280, y: 20, size: 9, font });
  return Buffer.from(await doc.save());
}
