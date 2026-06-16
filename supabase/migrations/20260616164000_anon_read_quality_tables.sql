drop policy if exists "anon read form_submissions" on public.form_submissions;
create policy "anon read form_submissions"
  on public.form_submissions for select to anon using (true);

drop policy if exists "anon read at_risk_activities" on public.at_risk_activities;
create policy "anon read at_risk_activities"
  on public.at_risk_activities for select to anon using (true);

drop policy if exists "anon read policy_attention_actions" on public.policy_attention_actions;
create policy "anon read policy_attention_actions"
  on public.policy_attention_actions for select to anon using (true);

drop policy if exists "anon read audit_issues" on public.audit_issues;
create policy "anon read audit_issues"
  on public.audit_issues for select to anon using (true);
