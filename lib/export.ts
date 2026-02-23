import * as XLSX from "xlsx";

export function buildWorkbookFromRecords(
  name: string,
  records: Array<{ fields: Record<string, unknown> }>
) {
  const rows = records.map((record) => record.fields);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
