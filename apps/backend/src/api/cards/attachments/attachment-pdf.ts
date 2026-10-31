import { fileError } from './attachment-file-policy';

/** Strict classic-xref PDF profile, not repair, rendering or malware scanning. */
export function verifyAttachmentPdf(body: Buffer): void {
  const invalid = (): never => {
    throw fileError(
      422,
      'ATTACHMENT_PDF_INVALID',
      'PDF structure is invalid or unsupported',
    );
  };
  const text = body.toString('latin1');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(text)) invalid();
  const names = text.replace(/#([0-9a-f]{2})/gi, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  if (
    /\/(?:JavaScript|JS|Launch|AA|OpenAction|EmbeddedFiles|RichMedia|XFA|Encrypt|ObjStm|GoToR|SubmitForm|ImportData)\b/i.test(
      names,
    )
  )
    throw fileError(
      415,
      'ATTACHMENT_PDF_UNSUPPORTED',
      'Encrypted, active-content and object-stream PDFs are unsupported',
    );
  const end = /startxref\s+(\d+)\s+%%EOF[\t\r\n ]*$/.exec(text);
  if (!end) invalid();
  const xref = Number(end![1]);
  if (
    !Number.isSafeInteger(xref) ||
    xref < 9 ||
    text.slice(xref, xref + 4) !== 'xref'
  )
    invalid();
  const trailerAt = text.indexOf('trailer', xref);
  if (trailerAt < xref) invalid();
  const lines = text
    .slice(xref + 4, trailerAt)
    .trim()
    .split(/\r\n|\r|\n/);
  const entries = new Map<number, { offset: number; generation: number }>();
  let index = 0,
    count = 0;
  while (index < lines.length) {
    const section = /^(\d+)\s+(\d+)$/.exec(lines[index++].trim());
    if (!section) invalid();
    const first = Number(section![1]),
      length = Number(section![2]);
    count += length;
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      count > 10000 ||
      first + length > 10001
    )
      invalid();
    for (let n = 0; n < length; n++) {
      const entry = /^(\d{10})\s(\d{5})\s([nf])\s?$/.exec(lines[index++] ?? '');
      if (!entry) invalid();
      if (entry![3] === 'n') {
        const offset = Number(entry![1]),
          id = first + n;
        if (!id || entries.has(id) || offset < 9 || offset >= xref) invalid();
        entries.set(id, { offset, generation: Number(entry![2]) });
      }
    }
  }
  const trailer = text.slice(trailerAt, text.lastIndexOf('startxref'));
  if (
    !/^trailer\s*<<[\s\S]*>>\s*$/.test(trailer) ||
    /\/Prev\b|\/XRefStm\b/.test(trailer)
  )
    invalid();
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R\b/.exec(trailer),
    size = /\/Size\s+(\d+)\b/.exec(trailer);
  if (
    !root ||
    !size ||
    Number(size[1]) <= Math.max(...entries.keys()) ||
    Number(size[1]) > 10001
  )
    invalid();
  const ordered = [...entries.entries()].sort(
    (a, b) => a[1].offset - b[1].offset,
  );
  const objects = new Map<number, string>();
  for (let n = 0; n < ordered.length; n++) {
    const [id, entry] = ordered[n],
      next = ordered[n + 1]?.[1].offset ?? xref;
    if (next === entry.offset) invalid();
    const object = text.slice(entry.offset, next).trim();
    if (
      !new RegExp(`^${id}\\s+${entry.generation}\\s+obj\\b`).test(object) ||
      !/endobj$/.test(object)
    )
      invalid();
    objects.set(id, object);
  }
  if (entries.get(Number(root![1]))?.generation !== Number(root![2])) invalid();
  const catalog = objects.get(Number(root![1]));
  if (
    !catalog ||
    !/^\d+\s+\d+\s+obj\s*<<[\s\S]*>>\s*endobj$/.test(catalog) ||
    !/\/Type\s*\/Catalog\b/.test(catalog)
  )
    invalid();
  const pages = /\/Pages\s+(\d+)\s+\d+\s+R\b/.exec(catalog!);
  if (!pages) invalid();
  const walk = (id: number, parents: Set<number>): number => {
    const object = objects.get(id);
    if (
      !object ||
      parents.has(id) ||
      parents.size > 16 ||
      !/^\d+\s+\d+\s+obj\s*<<[\s\S]*>>\s*endobj$/.test(object)
    )
      return invalid();
    if (/\/Type\s*\/Page\b/.test(object)) return 1;
    if (!/\/Type\s*\/Pages\b/.test(object)) return invalid();
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object),
      expected = /\/Count\s+(\d+)\b/.exec(object);
    if (!kids || !expected) return invalid();
    const refs = [...kids[1].matchAll(/(\d+)\s+(\d+)\s+R\b/g)];
    if (!refs.length || refs.length > 1000) return invalid();
    let leaves = 0;
    for (const ref of refs) {
      if (entries.get(Number(ref[1]))?.generation !== Number(ref[2]))
        return invalid();
      leaves += walk(Number(ref[1]), new Set([...parents, id]));
      if (leaves > 1000) return invalid();
    }
    if (leaves !== Number(expected[1])) return invalid();
    return leaves;
  };
  walk(Number(pages![1]), new Set());
  for (const object of objects.values()) {
    const stream = /\bstream(\r\n|\r|\n)/.exec(object);
    if (!stream) continue;
    const header = object.slice(0, stream.index),
      length = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?\b/.exec(header);
    if (!length) invalid();
    const declared =
      length![2] === undefined
        ? Number(length![1])
        : Number(
            objects
              .get(Number(length![1]))
              ?.replace(/^\d+\s+\d+\s+obj\s*|\s*endobj$/g, ''),
          );
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > body.length
    )
      invalid();
    const tail = object.slice(stream.index + stream[0].length + declared);
    if (!/^(?:\r\n|\r|\n)?endstream\s+endobj$/.test(tail)) invalid();
  }
}
