/**
 * Turning a migration into SQL that is safe to run twice.
 *
 * This exists because the first upgrade script was produced by patching
 * substrings of a migration, and the patch landed in the middle of an
 * enum declaration. The result was
 *
 *     create type public.sync_status as enum (
 *       'applied', 'failed', 'applied', 'failed', 'conflict');
 *
 * which PostgreSQL rejects on a unique index over (enumtypid, enumlabel)
 * - and which nothing caught, because the file was written by hand once
 * and never checked.
 *
 * So nothing here works on substrings. SQL is split into whole
 * statements first, respecting dollar-quoted function bodies, and each
 * statement is rewritten as a unit. A `create trigger` that happens to
 * appear inside a function body is left alone, because it is not a
 * statement at this level.
 */

/**
 * Split SQL into top-level statements.
 *
 * Aware of line comments, block comments, single-quoted strings and
 * dollar-quoted blocks (`$$`, `$guard$`), which is what makes it safe to
 * run over a file full of plpgsql.
 */
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (sql[i] === "$") {
      // A dollar quote opens with $tag$ where tag is empty or an
      // identifier. Anything else beginning with $ is not a quote.
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? sql.length : close + tag[0].length;
        continue;
      }
    }
    if (sql[i] === ";") {
      const text = sql.slice(start, i + 1);
      if (text.trim()) statements.push(text);
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }

  const tail = sql.slice(start);
  if (tail.trim()) statements.push(tail);
  return statements;
}

/** The statement with comments and whitespace stripped, for matching. */
function bare(statement) {
  return statement
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rewrite `create type ... as enum (...)` so it can meet a database that
 * already has the type.
 *
 * The labels are read out of the statement rather than supplied
 * separately, so they cannot drift from the migration. An existing type
 * with the same labels in the same order is accepted; one with different
 * labels stops the script with a message naming both, because silently
 * continuing would leave the schema and the code disagreeing about what
 * a column can hold.
 */
function guardEnum(statement) {
  const match = /create\s+type\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/i
    .exec(statement);
  if (!match) return null;

  const [, name, body] = match;
  // Labels only: the body carries trailing comments explaining each one.
  const labels = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
  if (!labels.length) return null;

  const duplicates = labels.filter((l, index) => labels.indexOf(l) !== index);
  if (duplicates.length) {
    throw new Error(
      `create type public.${name} declares '${duplicates[0]}' more than once. ` +
      `PostgreSQL refuses duplicate enum labels; fix the migration.`,
    );
  }

  const list = labels.map((l) => `'${l}'`).join(", ");
  return `do $enum$
declare
  found text[];
  wanted text[] := array[${list}];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = '${name}'
  ) then
    create type public.${name} as enum (${list});
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = '${name}';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.${name} already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;`;
}

/**
 * Make one statement safe to run a second time.
 *
 * Only the forms this schema actually uses are handled. Anything else is
 * returned untouched rather than guessed at - a transformation that
 * half-understands a statement is worse than none.
 */
export function makeIdempotent(statement) {
  const text = bare(statement);

  const enumGuard = guardEnum(statement);
  if (enumGuard) return enumGuard;

  if (/^create table (?!if not exists)/i.test(text)) {
    return statement.replace(/create\s+table\s+/i, "create table if not exists ");
  }

  if (/^create (unique )?index (?!if not exists)/i.test(text)) {
    return statement.replace(/create\s+(unique\s+)?index\s+/i,
      (_, unique) => `create ${unique ?? ""}index if not exists `);
  }

  // A policy cannot be replaced, only dropped and recreated. Dropping
  // one that is about to be recreated identically is safe; the table is
  // still protected by row level security throughout, because dropping
  // a policy never disables it.
  const policy = /^create policy ([a-z_][a-z0-9_]*) on ([a-z_.]+)/i.exec(text);
  if (policy) {
    return `drop policy if exists ${policy[1]} on ${policy[2]};\n${statement.trimStart()}`;
  }

  const trigger = /^create trigger ([a-z_][a-z0-9_]*)[\s\S]*? on ([a-z_.]+)/i.exec(text);
  if (trigger) {
    return `drop trigger if exists ${trigger[1]} on ${trigger[2]};\n${statement.trimStart()}`;
  }

  if (/^create (or replace )?view /i.test(text) && !/or replace/i.test(text)) {
    return statement.replace(/create\s+view\s+/i, "create or replace view ");
  }

  // create or replace function, alter table, grant, revoke, comment on,
  // insert ... on conflict: already safe as written.
  return statement;
}

/** Whole file, statement by statement. */
export function idempotentSql(sql) {
  return splitStatements(sql)
    .map((statement) => {
      const rewritten = makeIdempotent(statement);
      // A rewritten statement loses whatever blank line followed the
      // original, so consecutive guards would run together on one line.
      // The file is meant to be read and pasted by a person.
      return rewritten === statement || /\n\s*$/.test(rewritten)
        ? rewritten
        : `${rewritten}\n`;
    })
    .join("");
}
