import "dotenv/config";
import { createSpreadsheet } from "../lib/sheets";

const ownerEmail =
  process.env.GOOGLE_SHEETS_OWNER_EMAIL ??
  "digitalproductionsquad@gmail.com";

async function run() {
  const id = await createSpreadsheet(ownerEmail);
  console.log("Spreadsheet created:", id);
  console.log("URL: https://docs.google.com/spreadsheets/d/" + id);
  console.log("Share this sheet with:", ownerEmail);
}

run().catch((error) => {
  console.error("Setup failed", error);
  process.exit(1);
});
