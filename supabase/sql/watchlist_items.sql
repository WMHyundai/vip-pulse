-- VIP Pulse: PB가 고객의 보유 상품(정기예금/ELS/펀드 등)을 개인적으로 관심종목으로 표시해두는 테이블
-- Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요.

create table if not exists watchlist_items (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null,
  customer_name text not null,
  product_name text not null,
  maturity_date text,
  amount numeric,
  created_at timestamptz not null default now(),
  unique (customer_id, product_name)
);

create index if not exists watchlist_items_customer_idx on watchlist_items(customer_id);

-- 데모용 공개 정책: 로그인 없이 anon key로 조회/저장 가능하게 함
alter table watchlist_items enable row level security;

drop policy if exists "anon full access" on watchlist_items;
create policy "anon full access" on watchlist_items
  for all
  using (true)
  with check (true);
