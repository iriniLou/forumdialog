import type { Board } from "./model";
import { exportRows } from "./model";
export async function exportXlsx(board: Board, filename = "event.xlsx") {
  const module = await import("exceljs");
  const { Workbook } = module.default || module;
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Итоги сессии");
  for (const row of exportRows(board)) sheet.addRow(row.map((v) => v ?? ""));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((c, i) => {
    c.width = [38, 60, 18, 30, 18, 18, 70, 12, 25, 22][i] || 24;
  });
  const data = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([data as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
