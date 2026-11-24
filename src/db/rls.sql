-- Row-level security: a row is visible only when its tenant_id matches the app.tenant_id
-- setting, which withTenant() sets for each transaction. Applied after the Drizzle migrations
-- by src/scripts/migrate.ts, and safe to run again.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'people',
    'person_identities',
    'companies',
    'relationship_edges',
    'source_objects',
    'enrichment_calls',
    'tenant_profiles',
    'fit_scores',
    'search_briefs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      tbl
    );
  END LOOP;
END $$;
