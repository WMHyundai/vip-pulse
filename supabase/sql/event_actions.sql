-- VIP Pulse: PB의 이벤트 확인/대응 상태·메모를 저장하는 테이블
-- Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요.

create table if not exists event_actions (
  id uuid primary key default gen_random_uuid(),
  event_key text unique not null,       -- 고객ID_이벤트유형 조합의 결정적 키 (예: C1_asset_drop)
  status text not null default '미확인' check (status in ('미확인', '확인함', '대응완료')),
  memo text,
  updated_at timestamptz not null default now()
);

-- 데모용 공개 정책: 로그인 없이 anon key로 조회/저장 가능하게 함
-- (Claude-실습 프로젝트의 todos/meetings 테이블과 동일한 수준의 개방 정책 — 프로덕션에는 부적합)
alter table event_actions enable row level security;

drop policy if exists "anon full access" on event_actions;
create policy "anon full access" on event_actions
  for all
  using (true)
  with check (true);
