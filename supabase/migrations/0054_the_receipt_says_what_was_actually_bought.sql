-- ===================================================================
-- 0054  The receipt says what the customer actually bought
-- ===================================================================
--
-- A sale can now be two cartons and three singles, and the receipt for
-- it said "2". The line total was right - 0051 saw to that - so the
-- customer was being charged thirteen cedis against a quantity of two,
-- with nothing on the paper to explain the difference. That is an
-- argument at the next delivery, and the salesperson has nothing to
-- point at.
--
-- The unit comes along so the receipt can name it: "2 Cartons + 3
-- Pieces" rather than two of something and three of something else.
--
-- Nothing else about this function changes, and in particular nothing
-- new is exposed. Still no cost, no margin, no supplier, no internal
-- id - the receipt shape is deliberately the smallest thing that
-- answers a customer's question, and pieces are part of that question.

CREATE OR REPLACE FUNCTION public.resolve_receipt_token(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tok      public.receipt_tokens;
  doc      jsonb;
  org_name text;
begin
  select * into tok
    from public.receipt_tokens
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now();

  -- Null for unknown, expired and revoked alike. Telling the holder of
  -- a bad link which it was tells them how to make a better guess.
  if tok.id is null then
    return null;
  end if;

  update public.receipt_tokens
     set view_count = view_count + 1, last_viewed_at = now()
   where id = tok.id;

  select name into org_name from public.organizations where id = tok.org_id;

  if tok.subject_type = 'sale' then
    select jsonb_build_object(
      'kind',           'sale',
      'receiptNumber',  tok.receipt_number,
      'reference',      s.sale_number,
      'issuedAt',       s.sold_at,
      'organization',   org_name,
      'customerName',   c.name,
      'customerPhone',  tok.customer_phone,
      'servedBy',       coalesce(sp.full_name, dr.full_name),
      'saleType',       s.sale_type,
      'status',         s.status,
      'subtotal',       s.subtotal,
      'taxTotal',       s.tax_total,
      'total',          s.total,
      'amountPaid',     s.amount_paid,
      'balance',        s.balance,
      'dueDate',        s.due_date,
      'items',          coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name',       p.name,
                 'sku',        p.sku,
                 'quantity',   i.quantity,
                 -- The loose half, and what one of them cost. A customer
                 -- who bought two cartons and three singles is owed a
                 -- receipt that says so: "2" against a line they paid
                 -- thirteen cedis for is the kind of thing that gets
                 -- argued about at the next delivery.
                 'pieces',     coalesce(i.pieces, 0),
                 'piecePrice', coalesce(i.piece_price, 0),
                 'unit',       p.unit_of_measure,
                 'unitPrice',  i.unit_price,
                 'lineTotal',  i.line_total)
               order by p.name)
          from public.van_sale_items i
          join public.products p on p.id = i.product_id
         where i.sale_id = s.id), '[]'::jsonb),
      'payments',       coalesce((
        select jsonb_agg(jsonb_build_object(
                 'method',    pay.method,
                 'amount',    pay.amount,
                 'provider',  pay.provider,
                 'reference', pay.reference)
               order by pay.created_at)
          from public.van_sale_payments pay
         where pay.sale_id = s.id), '[]'::jsonb)
    )
    into doc
    from public.van_sales s
    join public.customers c on c.id = s.customer_id
    left join public.profiles sp on sp.id = s.salesperson_id
    left join public.profiles dr on dr.id = s.driver_id
   where s.id = tok.subject_id;

  else
    -- A credit payment. The two figures the customer wants are what
    -- they owed and what they owe now, so both are computed here rather
    -- than left to the caller to get right.
    select jsonb_build_object(
      'kind',            'credit_payment',
      'receiptNumber',   tok.receipt_number,
      'reference',       null,
      'issuedAt',        t.occurred_at,
      'organization',    org_name,
      'customerName',    c.name,
      'customerPhone',   tok.customer_phone,
      'servedBy',        col.full_name,
      'method',          t.reference_type,
      'amount',          abs(t.amount),
      'notes',           t.notes,
      -- The ledger is signed: charges positive, payments negative. The
      -- balance after this payment is everything up to and including it.
      'balanceAfter',    coalesce((
        select sum(x.amount) from public.credit_transactions x
         where x.customer_id = t.customer_id
           and (x.occurred_at < t.occurred_at
                or (x.occurred_at = t.occurred_at and x.id <= t.id))), 0),
      'balanceBefore',   coalesce((
        select sum(x.amount) from public.credit_transactions x
         where x.customer_id = t.customer_id
           and (x.occurred_at < t.occurred_at
                or (x.occurred_at = t.occurred_at and x.id < t.id))), 0)
    )
    into doc
    from public.credit_transactions t
    join public.customers c on c.id = t.customer_id
    left join public.profiles col on col.id = t.created_by
   where t.id = tok.subject_id;
  end if;

  return doc;
end;
$function$
;
