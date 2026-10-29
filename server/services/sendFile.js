// ส่งไฟล์ฟอร์มที่พิมพ์แล้ว: pdf เปิดใน browser (inline), xlsx/docx ดาวน์โหลด
const TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
function sendFile(res, fmt, name, body, ascii = 'file') {
  const file = name.replace(/[\\/:*?"<>|]/g, '_') + '.' + fmt;
  res.set('Content-Type', TYPES[fmt]);
  res.set('Content-Disposition', `${fmt === 'pdf' ? 'inline' : 'attachment'}; filename="${ascii}.${fmt}"; filename*=UTF-8''${encodeURIComponent(file)}`);
  res.send(body);
}
module.exports = { sendFile };
