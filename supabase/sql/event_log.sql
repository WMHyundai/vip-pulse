-- VIP Pulse: 고객별 이벤트 발생 이력을 영속적으로 남기는 테이블
-- event_actions(현재 상태/메모)와 별개로, 감지된 이벤트가 "언제 발생했는지"를 append-only로 기록한다.
-- 조건이 해소되어 이벤트가 목록에서 사라져도 이 테이블의 기록은 남아 고객 상세의 타임라인에 표시된다.
-- Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요.

create table if not exists event_log (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,       -- 고객ID_이벤트유형 (예: C1_asset_drop)
  customer_id text not null,
  customer_name text not null,
  type text not null,
  label text not null,
  detail text not null,          -- 발생 당시 상세 문구 (동일 문구가 이미 있으면 같은 발생으로 간주해 중복 기록하지 않음)
  detected_at timestamptz not null default now()
);

create index if not exists event_log_customer_idx on event_log(customer_id);

-- 데모용 공개 정책: 로그인 없이 anon key로 조회/저장 가능하게 함
alter table event_log enable row level security;

drop policy if exists "anon full access" on event_log;
create policy "anon full access" on event_log
  for all
  using (true)
  with check (true);
