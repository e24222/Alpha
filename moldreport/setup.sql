-- 模具通報管理：在 Supabase SQL Editor 執行一次
create table if not exists mold_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  vendor text not null,
  report_date date not null,
  mold text not null,
  repair_date date not null,
  reason text,
  status text not null default '待處理'
);

create table if not exists mold_progress (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references mold_reports(id) on delete cascade,
  progress_date date not null default current_date,
  author text,
  note text not null,
  status text
);

alter table mold_reports enable row level security;
alter table mold_progress enable row level security;

-- 與首件檢驗系統相同：前端以 anon key 存取（權限控管在前端密碼）
create policy "anon all" on mold_reports for all to anon using (true) with check (true);
create policy "anon all" on mold_progress for all to anon using (true) with check (true);
