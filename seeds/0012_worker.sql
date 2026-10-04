insert into ops.schedule(key,kind,every_seconds) values('performance.hourly','performance.rollup',3600),('operations.maintenance','ops.maintenance',300) on conflict(key) do nothing;
