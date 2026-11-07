import { embeddedDb } from "../../apps/api/src/index.ts";

const db = embeddedDb(process.argv[2]);
await db.exec("create table marks (n int); insert into marks values (7)");
process.stdout.write("open\n");
setInterval(() => undefined, 60_000);
