-- PETAVU domain schema. Portable PostgreSQL >=17; no provider-specific extension required.
-- Apply only to a reviewed staging database first. This migration creates no login credentials.
BEGIN;
CREATE SCHEMA identity;
CREATE SCHEMA network;
CREATE SCHEMA content;
CREATE SCHEMA commerce;
CREATE SCHEMA operations;
REVOKE ALL ON SCHEMA identity, network, content, commerce, operations FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE identity.actors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- External auth identities are mappings, not owners of domain data.
CREATE TABLE identity.provider_links (
 actor_id uuid NOT NULL REFERENCES identity.actors(id) ON DELETE RESTRICT,
 provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 60),
 provider_subject text NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 255),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (provider,provider_subject),
 UNIQUE(actor_id,provider)
);
CREATE TABLE identity.staff_assignments (
 actor_id uuid NOT NULL REFERENCES identity.actors(id) ON DELETE RESTRICT,
 capability text NOT NULL CHECK (capability IN ('site.manage','members.review','shop.manage','security.review')),
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,capability)
);
CREATE TABLE network.business_categories (
 code text PRIMARY KEY,
 title_fa text NOT NULL,
 sort_order smallint NOT NULL UNIQUE
);
INSERT INTO network.business_categories VALUES
 ('petshop','پت‌شاپ و فروشگاه تخصصی',1),('veterinary','دامپزشک و مرکز درمانی',2),
 ('equine','اسطبل و مراکز اسب',3),('supplier','تأمین‌کننده و پخش‌کننده',4),
 ('wholesale','عمده‌فروش',5),('manufacturer','شرکت تولیدکننده',6),
 ('importer','شرکت واردکننده',7),('services','آموزش و خدمات تخصصی',8);
CREATE TABLE network.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 150),
 city text CHECK (char_length(city)<=100),
 bio text NOT NULL DEFAULT '' CHECK (char_length(bio)<=2000),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended','archived')),
 directory_visible boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_directory ON network.organizations(city,id) WHERE status='verified' AND directory_visible;
CREATE TABLE network.organization_categories (
 organization_id uuid NOT NULL REFERENCES network.organizations(id) ON DELETE RESTRICT,
 category_code text NOT NULL REFERENCES network.business_categories(code) ON DELETE RESTRICT,
 PRIMARY KEY(organization_id,category_code)
);
CREATE INDEX organization_category_lookup ON network.organization_categories(category_code,organization_id);
CREATE TABLE network.memberships (
 organization_id uuid NOT NULL REFERENCES network.organizations(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES identity.actors(id) ON DELETE RESTRICT,
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','manager','member')),
 status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','removed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,actor_id)
);
CREATE INDEX memberships_actor ON network.memberships(actor_id,status,organization_id);
CREATE TABLE network.organization_private (
 organization_id uuid PRIMARY KEY REFERENCES network.organizations(id) ON DELETE RESTRICT,
 contact_email text CHECK (char_length(contact_email)<=254),
 contact_phone text CHECK (char_length(contact_phone)<=40),
 registry_reference text CHECK (char_length(registry_reference)<=120),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE network.documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES network.organizations(id) ON DELETE RESTRICT,
 object_key text NOT NULL UNIQUE CHECK (char_length(object_key)<=1024),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 bytes bigint NOT NULL CHECK (bytes>0 AND bytes<=20971520),
 content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 scan_status text NOT NULL DEFAULT 'quarantined' CHECK (scan_status IN ('quarantined','clean','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_organization ON network.documents(organization_id,created_at DESC,id);
CREATE TABLE content.pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 page_key text NOT NULL,locale text NOT NULL CHECK (locale IN ('fa','en')),
 version integer NOT NULL CHECK (version>0),
 body jsonb NOT NULL CHECK (jsonb_typeof(body)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
 created_by uuid REFERENCES identity.actors(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(page_key,locale,version)
);
CREATE UNIQUE INDEX one_published_page ON content.pages(page_key,locale) WHERE status='published';
CREATE TABLE commerce.products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES network.organizations(id) ON DELETE RESTRICT,
 sku text NOT NULL CHECK (char_length(sku) BETWEEN 1 AND 80),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
 summary text NOT NULL DEFAULT '' CHECK (char_length(summary)<=3000),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
 listing_scope text NOT NULL DEFAULT 'b2b' CHECK (listing_scope='b2b'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,sku)
);
CREATE INDEX products_by_org ON commerce.products(organization_id,status,created_at DESC,id);
CREATE INDEX products_published ON commerce.products(created_at DESC,id) WHERE status='published';
-- No order/payment/medical prescribing schema is invented before requirements are agreed.
CREATE TABLE operations.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid REFERENCES identity.actors(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
 resource_type text NOT NULL,resource_id text,
 request_id uuid NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object')
);
CREATE INDEX audit_actor_time ON operations.audit_events(actor_id,occurred_at DESC,id);
CREATE INDEX audit_request ON operations.audit_events(request_id);
CREATE TABLE operations.outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),aggregate_id uuid NOT NULL,
 event_type text NOT NULL,payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0)
);
CREATE INDEX pending_outbox ON operations.outbox_events(created_at,id) WHERE processed_at IS NULL;

-- This setting is supplied ONLY by a trusted API after verifying the user session.
-- Never grant end-users SQL connections; a caller-controlled setting is not authentication.
CREATE FUNCTION identity.current_actor_id() RETURNS uuid LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$SELECT nullif(current_setting('petavu.actor_id',true),'')::uuid$$;
-- Membership/actor policies are nonrecursive; these lookups stay SECURITY INVOKER.
-- They never rely on a migration-owner SUPERUSER/BYPASSRLS exemption.
CREATE FUNCTION network.is_member(org uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM network.memberships m JOIN identity.actors a ON a.id=m.actor_id WHERE m.organization_id=org AND m.actor_id=identity.current_actor_id() AND m.status='active' AND a.status='active')$$;
CREATE FUNCTION network.can_manage(org uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM network.memberships m JOIN identity.actors a ON a.id=m.actor_id WHERE m.organization_id=org AND m.actor_id=identity.current_actor_id() AND m.status='active' AND m.role IN ('owner','manager') AND a.status='active')$$;
REVOKE ALL ON FUNCTION identity.current_actor_id(),network.is_member(uuid),network.can_manage(uuid) FROM PUBLIC;
COMMIT;
