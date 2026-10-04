-- §5، §56، §106: سطوح shop/adminshop همان هسته؛ قیمت minor unit، رزرو تراکنشی.
create table app.shop_product(id uuid primary key default gen_random_uuid(),business_id uuid not null references app.business(id),sku text not null,title text not null check(length(title) between 2 and 200),description text,price_minor bigint not null check(price_minor between 0 and 1000000000000),currency text not null check(currency ~ '^[A-Z]{3}$'),stock_qty int not null default 0 check(stock_qty>=0),reserved_qty int not null default 0 check(reserved_qty>=0 and reserved_qty<=stock_qty),status text not null default 'draft' check(status in('draft','published','archived')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1,unique(business_id,sku));
create index shop_product_scope_idx on app.shop_product(business_id,status,id);
create trigger shop_product_touch before update on app.shop_product for each row execute function app.touch();
create table app.shop_cart(id uuid primary key default gen_random_uuid(),business_id uuid not null references app.business(id),user_id uuid not null references auth.app_user(id),status text not null default 'open' check(status in('open','checked_out','abandoned')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1);
create index shop_cart_scope_idx on app.shop_cart(business_id,user_id,id);
create unique index shop_cart_open_idx on app.shop_cart(business_id,user_id) where status='open';
create trigger shop_cart_touch before update on app.shop_cart for each row execute function app.touch();
create table app.shop_cart_line(cart_id uuid not null references app.shop_cart(id),product_id uuid not null references app.shop_product(id),business_id uuid not null references app.business(id),qty int not null check(qty between 1 and 100000),primary key(cart_id,product_id));
create index shop_cart_line_scope_idx on app.shop_cart_line(business_id,cart_id);
create table app.shop_order(id uuid primary key default gen_random_uuid(),business_id uuid not null references app.business(id),seller_business_id uuid not null references app.business(id),buyer_user_id uuid not null references auth.app_user(id),cart_id uuid not null references app.shop_cart(id),total_minor bigint not null check(total_minor>=0),currency text not null,status text not null default 'pending' check(status in('pending','confirmed','fulfilled','cancelled')),payment_status text not null default 'unconfigured' check(payment_status in('unconfigured','unpaid','paid')),idempotency_key uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version int not null default 1,unique(business_id,idempotency_key));
create index shop_order_scope_idx on app.shop_order(business_id,created_at desc,id);
create index shop_order_seller_idx on app.shop_order(seller_business_id,created_at desc,id);
create trigger shop_order_touch before update on app.shop_order for each row execute function app.touch();
create table app.shop_order_line(id uuid primary key default gen_random_uuid(),business_id uuid not null references app.business(id),order_id uuid not null references app.shop_order(id),product_id uuid not null references app.shop_product(id),sku text not null,title text not null,qty int not null,unit_price_minor bigint not null,currency text not null,unique(order_id,product_id));
create index shop_order_line_scope_idx on app.shop_order_line(business_id,order_id);
create table app.stock_movement(id uuid primary key default gen_random_uuid(),business_id uuid not null references app.business(id),product_id uuid not null references app.shop_product(id),order_id uuid references app.shop_order(id),kind text not null check(kind in('adjust','reserve','release','sold')),qty int not null,reason text,actor_id uuid references auth.app_user(id),created_at timestamptz not null default now());
create index stock_movement_scope_idx on app.stock_movement(business_id,product_id,created_at);
create trigger stock_movement_append before update or delete on app.stock_movement for each row execute function app.forbid_mutation();

alter table app.shop_product enable row level security;alter table app.shop_cart enable row level security;alter table app.shop_cart_line enable row level security;alter table app.shop_order enable row level security;alter table app.shop_order_line enable row level security;alter table app.stock_movement enable row level security;
create policy product_public on app.shop_product for select to pv_public using(status='published' and exists(select 1 from app.business b where b.id=business_id and b.status='active' and b.visibility='public' and b.deleted_at is null));
create policy product_app_read on app.shop_product for select to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'shop.manage')) or (status='published' and exists(select 1 from app.business b where b.id=business_id and b.status='active' and b.visibility='public' and b.deleted_at is null)));
create policy product_app_write on app.shop_product for all to pv_app using(business_id=app.current_business_id() and app.has_permission(business_id,'shop.manage')) with check(business_id=app.current_business_id() and app.has_permission(business_id,'shop.manage'));
create policy cart_app on app.shop_cart for all to pv_app using(business_id=app.current_business_id() and user_id=app.current_user_id() and app.has_permission(business_id,'shop.purchase')) with check(business_id=app.current_business_id() and user_id=app.current_user_id() and app.has_permission(business_id,'shop.purchase'));
create policy cart_line_app on app.shop_cart_line for all to pv_app using(business_id=app.current_business_id() and exists(select 1 from app.shop_cart c where c.id=cart_id and c.user_id=app.current_user_id())) with check(business_id=app.current_business_id() and exists(select 1 from app.shop_cart c where c.id=cart_id and c.user_id=app.current_user_id()));
create policy order_party on app.shop_order for select to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'shop.purchase')) or (seller_business_id=app.current_business_id() and app.has_permission(seller_business_id,'shop.manage')));
create policy order_line_party on app.shop_order_line for select to pv_app using(business_id=app.current_business_id() or exists(select 1 from app.shop_order o where o.id=order_id and o.seller_business_id=app.current_business_id() and app.has_permission(o.seller_business_id,'shop.manage')));
create policy stock_app on app.stock_movement for select to pv_app using(business_id=app.current_business_id() and app.has_permission(business_id,'shop.manage'));
create policy product_reader on app.shop_product for select to pv_reader using(true);create policy cart_reader on app.shop_cart for select to pv_reader using(true);create policy cart_line_reader on app.shop_cart_line for select to pv_reader using(true);create policy order_reader on app.shop_order for select to pv_reader using(true);create policy order_line_reader on app.shop_order_line for select to pv_reader using(true);create policy stock_reader on app.stock_movement for select to pv_reader using(true);
revoke all on app.shop_product,app.shop_cart,app.shop_cart_line,app.shop_order,app.shop_order_line,app.stock_movement from public,pv_app,pv_worker,pv_reader;
grant select on app.shop_product to pv_public;
grant select,insert,update on app.shop_product,app.shop_cart,app.shop_cart_line to pv_app;
grant select on app.shop_order,app.shop_order_line,app.stock_movement to pv_app;
grant select on app.shop_product,app.shop_cart,app.shop_cart_line,app.shop_order,app.shop_order_line,app.stock_movement to pv_reader;

create function app.shop_assert(p_action text) returns uuid language plpgsql stable security definer set search_path=pg_catalog,app as $$
declare b uuid:=app.current_business_id();begin if b is null or app.current_user_id() is null or not app.has_permission(b,p_action) then raise exception 'permission denied' using errcode='42501';end if;return b;end $$;
create function app.cart_add(p_product uuid,p_qty int,p_version int) returns jsonb language plpgsql security definer set search_path=pg_catalog,app as $$
declare b uuid;cart app.shop_cart;product app.shop_product;
begin b:=app.shop_assert('shop.purchase');if p_qty not between 1 and 100000 then raise exception 'quantity' using errcode='22023';end if;
 select * into product from app.shop_product where id=p_product and status='published' and exists(select 1 from app.business where id=business_id and status='active' and visibility='public' and deleted_at is null);if not found then raise exception 'not found' using errcode='P0002';end if;
 select * into cart from app.shop_cart where business_id=b and user_id=app.current_user_id() and status='open' for update;
 if not found then if p_version<>0 then raise exception 'version conflict' using errcode='P0409';end if;insert into app.shop_cart(business_id,user_id) values(b,app.current_user_id()) returning * into cart;elsif cart.version<>p_version then raise exception 'version conflict' using errcode='P0409';end if;
 if exists(select 1 from app.shop_cart_line l join app.shop_product p on p.id=l.product_id where l.cart_id=cart.id and (p.business_id<>product.business_id or p.currency<>product.currency)) then raise exception 'one seller/currency per cart' using errcode='55000';end if;
 insert into app.shop_cart_line(cart_id,product_id,business_id,qty) values(cart.id,p_product,b,p_qty) on conflict(cart_id,product_id) do update set qty=excluded.qty;
 update app.shop_cart set updated_at=now() where id=cart.id returning * into cart;perform app.record_audit('cart.updated','cart',cart.id::text,b);return to_jsonb(cart);
end $$;
create function app.shop_checkout(p_cart uuid,p_version int,p_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,app as $$
declare b uuid;cart app.shop_cart;p app.shop_product;l record;o app.shop_order;total bigint:=0;seller uuid;currency_new text;
begin
 b:=app.shop_assert('shop.purchase');perform app.require_recent_auth();select * into o from app.shop_order where business_id=b and idempotency_key=p_key;if found then if o.cart_id<>p_cart then raise exception 'idempotency mismatch' using errcode='P0409';end if;return to_jsonb(o)||jsonb_build_object('total_minor',o.total_minor::text);end if;
 select * into cart from app.shop_cart where id=p_cart and business_id=b and user_id=app.current_user_id() and status='open' for update;if not found then raise exception 'not found' using errcode='P0002';end if;if cart.version<>p_version then raise exception 'version conflict' using errcode='P0409';end if;
 for l in select product_id,qty from app.shop_cart_line where cart_id=p_cart order by product_id loop
  select * into p from app.shop_product where id=l.product_id for update;
  if p.status<>'published' or p.stock_qty-p.reserved_qty<l.qty or not exists(select 1 from app.business where id=p.business_id and status='active' and visibility='public' and deleted_at is null) then raise exception 'stock/publication changed' using errcode='55000';end if;
  if seller is not null and (seller<>p.business_id or currency_new<>p.currency) then raise exception 'mixed cart' using errcode='55000';end if;seller:=p.business_id;currency_new:=p.currency;total:=total+p.price_minor*l.qty;
 end loop;
 if seller is null then raise exception 'empty cart' using errcode='55000';end if;
 insert into app.shop_order(business_id,seller_business_id,buyer_user_id,cart_id,total_minor,currency,idempotency_key) values(b,seller,app.current_user_id(),p_cart,total,currency_new,p_key) returning * into o;
 for l in select product_id,qty from app.shop_cart_line where cart_id=p_cart order by product_id loop
  select * into p from app.shop_product where id=l.product_id;update app.shop_product set reserved_qty=reserved_qty+l.qty where id=p.id;
  insert into app.shop_order_line(business_id,order_id,product_id,sku,title,qty,unit_price_minor,currency) values(b,o.id,p.id,p.sku,p.title,l.qty,p.price_minor,p.currency);
  insert into app.stock_movement(business_id,product_id,order_id,kind,qty,actor_id) values(p.business_id,p.id,o.id,'reserve',l.qty,app.current_user_id());
 end loop;
 update app.shop_cart set status='checked_out' where id=p_cart;perform app.record_audit('shop.order_created','shop_order',o.id::text,b,null,jsonb_build_object('total_minor',total,'payment','unconfigured'));perform app.emit_event('shop.order_created','shop_order',o.id::text,seller,jsonb_build_object('order_id',o.id,'buyer_business_id',b));return to_jsonb(o)||jsonb_build_object('total_minor',o.total_minor::text);
end $$;
create function app.shop_order_state(p_id uuid,p_version int,p_to text,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app as $$
declare b uuid:=app.current_business_id();o app.shop_order;l record;
begin
 perform app.require_recent_auth();select * into o from app.shop_order where id=p_id for update;if not found or b not in(o.business_id,o.seller_business_id) then raise exception 'not found' using errcode='P0002';end if;
 if o.version<>p_version then raise exception 'version conflict' using errcode='P0409';end if;
 if p_to='cancelled' then if o.status not in('pending','confirmed') or not ((b=o.business_id and app.has_permission(b,'shop.purchase')) or (b=o.seller_business_id and app.has_permission(b,'shop.manage'))) then raise exception 'invalid edge' using errcode='55000';end if;
 elsif b<>o.seller_business_id or not app.has_permission(b,'shop.manage') or not ((o.status='pending' and p_to='confirmed') or (o.status='confirmed' and p_to='fulfilled')) then raise exception 'invalid edge' using errcode='55000';end if;
 if p_to in('cancelled','fulfilled') then for l in select product_id,qty from app.shop_order_line where order_id=p_id order by product_id loop
  perform 1 from app.shop_product where id=l.product_id for update;update app.shop_product set reserved_qty=reserved_qty-l.qty,stock_qty=stock_qty-case when p_to='fulfilled' then l.qty else 0 end where id=l.product_id;
  insert into app.stock_movement(business_id,product_id,order_id,kind,qty,reason,actor_id) values(o.seller_business_id,l.product_id,p_id,case when p_to='fulfilled' then 'sold' else 'release' end,l.qty,p_reason,app.current_user_id());end loop;end if;
 update app.shop_order set status=p_to where id=p_id returning * into o;perform app.record_audit('shop.order_'||p_to,'shop_order',p_id::text,b,null,jsonb_build_object('reason',p_reason));perform app.emit_event('shop.order_'||p_to,'shop_order',p_id::text,o.seller_business_id,jsonb_build_object('order_id',p_id));return to_jsonb(o)||jsonb_build_object('total_minor',o.total_minor::text);
end $$;
create function app.shop_adjust_stock(p_id uuid,p_version int,p_qty int,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app as $$
declare b uuid;p app.shop_product;delta int;
begin b:=app.shop_assert('shop.manage');perform app.require_recent_auth();select * into p from app.shop_product where id=p_id and business_id=b for update;if not found then raise exception 'not found' using errcode='P0002';end if;if p.version<>p_version then raise exception 'version conflict' using errcode='P0409';end if;if p_qty<p.reserved_qty then raise exception 'cannot consume reserved stock' using errcode='55000';end if;delta:=p_qty-p.stock_qty;update app.shop_product set stock_qty=p_qty where id=p_id returning * into p;insert into app.stock_movement(business_id,product_id,kind,qty,reason,actor_id) values(b,p_id,'adjust',delta,p_reason,app.current_user_id());perform app.record_audit('shop.stock_adjusted','shop_product',p_id::text,b,null,jsonb_build_object('qty',p_qty,'reason',p_reason));return to_jsonb(p);end $$;
revoke all on function app.shop_assert(text),app.cart_add(uuid,int,int),app.shop_checkout(uuid,int,uuid),app.shop_order_state(uuid,int,text,text),app.shop_adjust_stock(uuid,int,int,text) from public;
grant execute on function app.shop_assert(text),app.cart_add(uuid,int,int),app.shop_checkout(uuid,int,uuid),app.shop_order_state(uuid,int,text,text),app.shop_adjust_stock(uuid,int,int,text) to pv_app;
create function app.shop_inventory_guard() returns trigger language plpgsql as $$
begin if current_user in('pv_app','pv_worker') and (new.stock_qty<>old.stock_qty or new.reserved_qty<>old.reserved_qty) then raise exception 'transactional inventory functions required' using errcode='55000';end if;return new;end $$;
create trigger shop_inventory_guard before update on app.shop_product for each row execute function app.shop_inventory_guard();
revoke all on function app.shop_inventory_guard() from public;
create function app.shop_public_seller(p_business uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$ select exists(select 1 from app.business b where b.id=p_business and b.status='active' and b.visibility='public' and b.deleted_at is null) $$;
drop policy product_app_read on app.shop_product;
create policy product_app_read on app.shop_product for select to pv_app using((business_id=app.current_business_id() and app.has_permission(business_id,'shop.manage')) or (status='published' and app.shop_public_seller(business_id)));
revoke all on function app.shop_public_seller(uuid) from public;
grant execute on function app.shop_public_seller(uuid) to pv_public,pv_app;
