/**
 * Is the hosted connection usable?
 *
 * Says which of the several things that can be wrong is wrong, rather
 * than passing a driver error through. Prints nothing from the URL.
 */
import { connectHosted, explainFailure } from "./hosted.mjs";

const { client, via, failures } = await connectHosted();

if (!client) {
  console.log("Cannot connect.\n");
  for (const f of failures) console.log(`  ${f}`);
  console.log(`\n  ${explainFailure(failures)}`);
  console.log("\nTo set the password without editing the file:  npm run db:set-password");
  process.exit(1);
}

const r = await client.query(`
  select version() as v,
         current_database() as db,
         (select count(*) from information_schema.tables
           where table_schema='public' and table_type='BASE TABLE') as tables`);

console.log(`Connected via ${via}.`);
console.log(`  ${r.rows[0].v.split(" on ")[0]}`);
console.log(`  database ${r.rows[0].db}, ${r.rows[0].tables} tables in public`);
await client.end();
