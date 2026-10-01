-- Role provisioning needs reviewed database-owner privileges. No LOGIN/password is created.
-- Separate deployment identities must be created out of band, with no SUPERUSER/BYPASSRLS.
BEGIN;
CREATE ROLE petavu_public NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE petavu_member NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE petavu_adminpanel NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE petavu_adminshop NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA network,content,commerce TO petavu_public;
GRANT USAGE ON SCHEMA identity,network,content,commerce,operations TO petavu_member;
GRANT USAGE ON SCHEMA identity,network,content,operations TO petavu_adminpanel;
GRANT USAGE ON SCHEMA identity,network,commerce,operations TO petavu_adminshop;
GRANT EXECUTE ON FUNCTION identity.current_actor_id(),network.is_member(uuid),network.can_manage(uuid) TO petavu_member,petavu_adminpanel,petavu_adminshop;

ALTER TABLE identity.actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.actors FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.provider_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.provider_links FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.staff_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE network.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE network.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE network.organization_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE network.organization_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE network.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE network.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE network.organization_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE network.organization_private FORCE ROW LEVEL SECURITY;
ALTER TABLE network.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE network.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE content.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE content.pages FORCE ROW LEVEL SECURITY;
ALTER TABLE commerce.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.products FORCE ROW LEVEL SECURITY;
ALTER TABLE operations.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE operations.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.outbox_events FORCE ROW LEVEL SECURITY;

GRANT SELECT ON network.business_categories TO petavu_public,petavu_member,petavu_adminpanel,petavu_adminshop;
GRANT SELECT ON network.organizations,network.organization_categories,content.pages,commerce.products TO petavu_public;
CREATE POLICY directory_read ON network.organizations FOR SELECT TO petavu_public USING(status='verified' AND directory_visible);
CREATE POLICY directory_categories ON network.organization_categories FOR SELECT TO petavu_public USING(EXISTS(SELECT 1 FROM network.organizations o WHERE o.id=organization_id));
CREATE POLICY published_content ON content.pages FOR SELECT TO petavu_public USING(status='published');
CREATE POLICY published_products ON commerce.products FOR SELECT TO petavu_public USING(status='published' AND EXISTS(SELECT 1 FROM network.organizations o WHERE o.id=organization_id));

GRANT SELECT ON identity.actors,identity.provider_links,network.organizations,network.memberships,network.organization_categories,network.organization_private,network.documents,content.pages,commerce.products TO petavu_member;
GRANT UPDATE(display_name,updated_at) ON identity.actors TO petavu_member;
GRANT UPDATE(name,city,bio,updated_at) ON network.organizations TO petavu_member;
-- Membership/verification/permissions cannot be edited by a general member role.
CREATE POLICY actor_self ON identity.actors TO petavu_member USING(id=identity.current_actor_id()) WITH CHECK(id=identity.current_actor_id());
CREATE POLICY own_provider_link ON identity.provider_links FOR SELECT TO petavu_member USING(actor_id=identity.current_actor_id());
CREATE POLICY org_member_read ON network.organizations FOR SELECT TO petavu_member USING(network.is_member(id) OR (status='verified' AND directory_visible));
CREATE POLICY org_member_update ON network.organizations FOR UPDATE TO petavu_member USING(network.can_manage(id) AND status IN ('pending','verified')) WITH CHECK(network.can_manage(id) AND status IN ('pending','verified'));
CREATE POLICY own_membership ON network.memberships FOR SELECT TO petavu_member USING(actor_id=identity.current_actor_id());
CREATE POLICY member_categories ON network.organization_categories FOR SELECT TO petavu_member USING(network.is_member(organization_id) OR EXISTS(SELECT 1 FROM network.organizations o WHERE o.id=organization_id AND o.status='verified' AND o.directory_visible));
CREATE POLICY private_org_contacts ON network.organization_private FOR SELECT TO petavu_member USING(network.can_manage(organization_id));
CREATE POLICY private_documents ON network.documents FOR SELECT TO petavu_member USING(network.can_manage(organization_id));
CREATE POLICY member_public_content ON content.pages FOR SELECT TO petavu_member USING(status='published');
CREATE POLICY member_product_read ON commerce.products FOR SELECT TO petavu_member USING(network.is_member(organization_id) OR (status='published' AND EXISTS(SELECT 1 FROM network.organizations o WHERE o.id=organization_id AND o.status='verified' AND o.directory_visible)));

-- Admin roles are held by independent trusted services, never by a browser or normal user.
-- The BFF must require a corresponding staff capability AND MFA before using these roles.
GRANT SELECT ON identity.actors,network.organizations,network.memberships,network.organization_categories,network.organization_private,network.documents,content.pages,operations.audit_events TO petavu_adminpanel;
GRANT UPDATE(status,updated_at) ON network.organizations TO petavu_adminpanel;
GRANT SELECT,INSERT,UPDATE ON content.pages TO petavu_adminpanel;
CREATE POLICY site_admin_actors ON identity.actors FOR SELECT TO petavu_adminpanel USING(true);
CREATE POLICY site_admin_orgs ON network.organizations TO petavu_adminpanel USING(true) WITH CHECK(true);
CREATE POLICY site_admin_members ON network.memberships FOR SELECT TO petavu_adminpanel USING(true);
CREATE POLICY site_admin_categories ON network.organization_categories FOR SELECT TO petavu_adminpanel USING(true);
CREATE POLICY site_admin_contacts ON network.organization_private FOR SELECT TO petavu_adminpanel USING(true);
CREATE POLICY site_admin_documents ON network.documents FOR SELECT TO petavu_adminpanel USING(true);
CREATE POLICY site_admin_content ON content.pages TO petavu_adminpanel USING(true) WITH CHECK(true);
CREATE POLICY site_admin_audit ON operations.audit_events FOR SELECT TO petavu_adminpanel USING(true);
-- No commerce-schema usage or product grants for the site administrator.

GRANT SELECT ON network.organizations,network.organization_categories TO petavu_adminshop;
GRANT SELECT,INSERT,UPDATE ON commerce.products TO petavu_adminshop;
CREATE POLICY shop_admin_orgs ON network.organizations FOR SELECT TO petavu_adminshop USING(true);
CREATE POLICY shop_admin_categories ON network.organization_categories FOR SELECT TO petavu_adminshop USING(true);
CREATE POLICY shop_admin_products ON commerce.products TO petavu_adminshop USING(true) WITH CHECK(true);
-- No provider-link, staff-assignment, or private-document grants for shop administrators.

GRANT INSERT ON operations.audit_events TO petavu_member,petavu_adminpanel,petavu_adminshop;
GRANT USAGE ON SEQUENCE operations.audit_events_id_seq TO petavu_member,petavu_adminpanel,petavu_adminshop;
CREATE POLICY audit_append ON operations.audit_events FOR INSERT TO petavu_member,petavu_adminpanel,petavu_adminshop WITH CHECK(actor_id=identity.current_actor_id());
-- No UPDATE/DELETE on audit, no general runtime grants on staff assignments or outbox.
COMMIT;
