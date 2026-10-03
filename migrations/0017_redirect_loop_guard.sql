-- ---------------------------------------------------------------------------
-- 0017 — پیش‌بینی حلقهٔ تغییر مسیر، پیش از نوشتن (Addendum §45)
--
-- ماجرا: `seo.redirect_chain_issue` به پرسش «آیا زنجیرهٔ *موجودِ* این مسیر
-- مشکل دارد؟» پاسخ می‌دهد. ولی هنگام افزودن یک قاعدهٔ تازه، پرسش درست این
-- نیست؛ پرسش این است: «اگر یالِ تازه را اضافه کنم، آیا حلقه بسته می‌شود؟»
--
-- نمونهٔ واقعی که آزمون گرفت: `/old-vaccine → /service/vaccine` ثبت شده بود.
-- بعد کسی خواست `/service/vaccine → /old-vaccine` را ثبت کند. زنجیرهٔ موجودِ
-- `/service/vaccine` خالی است (هیچ ردیفی با آن مبدأ نیست)، پس بررسی قدیمی
-- چیزی نمی‌دید و قاعده ثبت می‌شد — و از آن لحظه، هر بازدیدکنندهٔ آن دو مسیر
-- در حلقه می‌افتاد. حلقه‌ای که *پیش از نوشتن* قابل دانستن بود.
--
-- قاعدهٔ درست: یال `S → T` حلقه می‌سازد اگر و تنها اگر `T` با زنجیرهٔ
-- موجود به `S` برسد (یا `T = S`). یعنی یک پیمایش از مقصد به عقب.
--
-- این تابع، همان پیمایش است با سه محافظ: سقف گام، دیدنِ حلقهٔ ازپیش‌موجود،
-- و در نظر گرفتن دامنهٔ کسب‌وکار (قاعدهٔ سراسری و قاعدهٔ همان کسب‌وکار).
-- ---------------------------------------------------------------------------

create or replace function seo.would_create_loop(
  p_source_path text,
  p_target_path text,
  p_business_id uuid default null,
  p_max_hops integer default 10
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, seo, app
as $$
declare
  v_current text := p_target_path;
  v_next text;
  v_seen text[] := array[p_source_path];
  v_hops integer := 0;
begin
  if p_source_path is null or p_target_path is null then
    return false;
  end if;

  -- خودارجاعی: مقصد، همان مبدأ است.
  if p_source_path = p_target_path then
    return true;
  end if;

  loop
    v_hops := v_hops + 1;
    if v_hops > greatest(1, least(p_max_hops, 25)) then
      /*
       * از سقف گام گذشتیم. اینجا «بله» می‌گوییم، نه «نه»: زنجیره‌ای که
       * پایانش در ده گام دیده نمی‌شود، یا حلقه است یا آن‌قدر بلند که
       * نگه‌داشتنش به‌خودی‌خود بد است. در هر دو حالت، نوشتن نباید انجام شود.
       */
      return true;
    end if;

    select r.target_path into v_next
    from seo.redirect r
    where r.is_active
      and r.source_path = v_current
      and r.status_code <> 410
      and (r.business_id is not distinct from p_business_id or r.business_id is null)
    order by (r.business_id is not null) desc, r.created_at
    limit 1;

    if v_next is null then
      return false;
    end if;

    if v_next = v_seen[1] or v_next = any (v_seen) then
      -- به مبدأ تازه رسیدیم ⇒ یال تازه، حلقه می‌بندد.
      return true;
    end if;

    v_seen := v_seen || v_next;
    v_current := v_next;
  end loop;
end
$$;

comment on function seo.would_create_loop is
  'آیا افزودن یال source→target حلقهٔ تغییر مسیر می‌سازد؟ پیش از نوشتن (Addendum §45)';

revoke all on function seo.would_create_loop(text, text, uuid, integer) from public;
grant execute on function seo.would_create_loop(text, text, uuid, integer) to pv_app, pv_worker;
