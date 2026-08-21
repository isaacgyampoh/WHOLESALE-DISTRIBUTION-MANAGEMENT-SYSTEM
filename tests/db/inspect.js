const { Client, CONN } = require('./lib');
const q = async (c, sql) => (await c.query(sql)).rows;

(async () => {
  const c = new Client(CONN); await c.connect();
  const line = s => console.log('\n== ' + s + ' ' + '='.repeat(Math.max(0, 58 - s.length)));

  line('TABLES / rows / RLS');
  for (const r of await q(c, `
    select c.relname, c.relrowsecurity as rls,
           (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
           c.reltuples::bigint as est
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`)) {
    const n = (await q(c, `select count(*)::int as n from public.${r.relname}`))[0].n;
    console.log(`  ${r.relname.padEnd(22)} rows=${String(n).padStart(4)}  RLS=${r.rls ? 'ON ' : 'OFF'}  policies=${r.policies}`);
  }

  line('VIEWS');
  for (const r of await q(c, `select table_name, (select count(*) from pg_class cc join pg_namespace nn on nn.oid=cc.relnamespace where nn.nspname='public' and cc.relname=table_name) as x from information_schema.views where table_schema='public' order by 1`))
    console.log('  ' + r.table_name);

  line('FUNCTIONS');
  for (const r of await q(c, `
    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as secdef
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' order by p.proname`))
    console.log(`  ${(r.proname + '(' + r.args + ')').padEnd(52)} ${r.secdef ? 'SECURITY DEFINER' : ''}`);

  line('TRIGGERS');
  for (const r of await q(c, `
    select c.relname as tbl, t.tgname, n.nspname
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','auth') order by 1,2`))
    console.log(`  ${(r.nspname + '.' + r.tbl).padEnd(26)} ${r.tgname}`);

  line('CONSTRAINT COUNTS');
  for (const r of await q(c, `
    select contype, count(*)::int as n from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' group by contype order by contype`)) {
    const names = { p: 'primary key', f: 'foreign key', u: 'unique', c: 'check' };
    console.log(`  ${(names[r.contype] || r.contype).padEnd(16)} ${r.n}`);
  }

  line('INDEXES');
  const idx = await q(c, `select count(*)::int as n from pg_indexes where schemaname='public'`);
  console.log('  total: ' + idx[0].n);

  line('GENERATED COLUMNS');
  for (const r of await q(c, `
    select table_name, column_name from information_schema.columns
    where table_schema='public' and is_generated='ALWAYS' order by 1,2`))
    console.log(`  ${r.table_name}.${r.column_name}`);

  line('ENUMS');
  for (const r of await q(c, `
    select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as vals
    from pg_type t join pg_enum e on e.enumtypid=t.oid
    join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
    group by t.typname order by 1`))
    console.log(`  ${r.typname}: ${r.vals}`);

  line('SEED DATA');
  for (const t of ['warehouses','categories','suppliers','customers','products','stock_movements','inventory']) {
    const n = (await q(c, `select count(*)::int as n from public.${t}`))[0].n;
    console.log(`  ${t.padEnd(18)} ${n}`);
  }
  console.log('\n  stock_summary sample:');
  for (const r of await q(c, `select sku, qty_on_hand, qty_available, needs_reorder from public.stock_summary order by sku limit 3`))
    console.log(`    ${r.sku}  on_hand=${r.qty_on_hand} avail=${r.qty_available} reorder=${r.needs_reorder}`);

  await c.end();
})();
