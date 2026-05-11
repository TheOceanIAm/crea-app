-- Repair job_freelancer_visibility for any crew/lead already on marketplace projects (e.g. booking RPC
-- ran before visibility trigger, or visibility insert was missing).

insert into public.job_freelancer_visibility (job_id, freelancer_id)
select p.job_id, pm.profile_id
from public.project_members pm
inner join public.projects p on p.id = pm.project_id
where p.job_id is not null
  and pm.profile_id is distinct from p.company_id
on conflict (job_id, freelancer_id) do nothing;
